// Juntar las piezas: de un EventoConfianza a la evaluación completa del partido, y su
// registro append-only.
//
// El registro (prediction_assessments) guarda TAMBIÉN las abstenciones: es lo que
// permite medir después si abstenerse fue buena idea (trust/evaluation.ts). Como las
// instantáneas, una fila nueva solo cuando algo cambia, nunca después del inicio, y la
// base no deja reescribirla ni borrarla.

import { getDb } from '../db.ts';
import { readCalibration } from '../staking/calibration.ts';
import { versionsFor } from '../versions.ts';
import type { SportId } from '../sports.ts';
import { puntuar, type CalidadDatos } from './dataQuality.ts';
import { calidadMercado, type CalidadMercado } from './market.ts';
import {
  incertidumbre, estabilidad, desacuerdo, sensibilidad, edgeDesaparece,
  type Incertidumbre, type Estabilidad, type Desacuerdo, type Sensibilidad, type BandaCalibracion,
} from './perturbation.ts';
import { confianza, decidir, type Confianza, type Decision } from './decision.ts';
import { derivaReciente } from './drift.ts';
import { DEFAULT_CONFIG } from '../staking/policy.ts';
import type { EventoConfianza } from './types.ts';
import { registrarSombras } from '../shadow/shadows.ts';

export { ASSESSMENT_SCHEMA } from './schema.ts';

export interface Evaluacion {
  sport: SportId;
  matchKey: string;
  outcomes: string[];
  probs: number[];
  calidadDatos: CalidadDatos;
  incertidumbre: Incertidumbre;
  estabilidad: Estabilidad;
  desacuerdo: Desacuerdo;
  sensibilidad: Sensibilidad;
  mercado: CalidadMercado;
  ood: EventoConfianza['ood'];
  regimen: EventoConfianza['regimen'];
  confianza: Confianza;
  decision: Decision;
  deriva: string;
  /** Por qué no hay un «Trust Score» único: ver trust/README en docs/CONFIANZA.md. */
  nota: string;
}

/** Deriva por deporte, recalculada cada 15 minutos como mucho. */
const cacheDeriva = new Map<SportId, { t: number; v: ReturnType<typeof derivaReciente> }>();
function deriva(sport: SportId) {
  const c = cacheDeriva.get(sport);
  if (c && Date.now() - c.t < 15 * 60_000) return c.v;
  const v = derivaReciente(sport);
  cacheDeriva.set(sport, { t: Date.now(), v });
  return v;
}

function bandas(sport: SportId): BandaCalibracion[] | null {
  const b = readCalibration()[sport]?.bands;
  return b ? b.filter((x) => x.media != null).map((x) => ({ desde: x.desde, n: x.n, acierto: x.acierto, media: x.media as number })) : null;
}

export function evaluar(e: EventoConfianza, opts: { pRegistrada?: number[] | null; now?: Date } = {}): Evaluacion {
  const now = opts.now ?? new Date();
  const calidad = puntuar(e.datos);
  const inc = incertidumbre(e, bandas(e.sport));
  const est = estabilidad(e);
  const des = desacuerdo(e);
  const mercado = calidadMercado(e.demo ? null : e.providerEventId, e.providerSelections, e.commence, now);
  const d = deriva(e.sport);
  const ctx = { evento: e, calidad, incertidumbre: inc, estabilidad: est, desacuerdo: des, mercado, pRegistrada: opts.pRegistrada ?? null, deriva: d.deriva ? d.texto : null, now };
  return {
    sport: e.sport,
    matchKey: e.matchKey,
    outcomes: e.outcomes,
    probs: e.probs,
    calidadDatos: calidad,
    incertidumbre: inc,
    estabilidad: est,
    desacuerdo: des,
    sensibilidad: sensibilidad(e),
    mercado,
    ood: e.ood,
    regimen: e.regimen,
    confianza: confianza(ctx),
    decision: decidir({ ...ctx, desapareceDe: (i, cuota) => edgeDesaparece(e, i, cuota, DEFAULT_CONFIG.minEdge) }),
    deriva: d.texto,
    nota:
      'No hay un «Trust Score» único a propósito: sumar calidad de datos, estabilidad, calibración y mercado exigiría ' +
      'pesos que no se han medido. Cada componente se enseña por separado, con su criterio.',
  };
}

/** Guarda la evaluación si cambió algo relevante. Nunca lanza. */
export function registrarEvaluacion(e: EventoConfianza, ev: Evaluacion, now = new Date()): 'nueva' | 'igual' | 'empezado' | 'rechazada' {
  if (e.demo) return 'rechazada';
  if (Date.parse(e.commence) <= now.getTime()) return 'empezado';
  try {
    const db = getDb();
    const ultima = db
      .prepare('SELECT decision, confidence, data_quality, stability, probs, odds FROM prediction_assessments WHERE sport = ? AND match_key = ? ORDER BY id DESC LIMIT 1')
      .get(e.sport, e.matchKey) as { decision: string; confidence: string; data_quality: number; stability: string; probs: string; odds: number | null } | undefined;
    const probs = JSON.stringify(e.probs.map((p) => Math.round(p * 1e4) / 1e4));
    const dec = ev.decision;
    if (
      ultima &&
      ultima.decision === dec.decision &&
      ultima.confidence === ev.confianza.nivel &&
      ultima.data_quality === ev.calidadDatos.puntuacion &&
      ultima.stability === ev.estabilidad.nivel &&
      ultima.probs === probs &&
      (ultima.odds ?? null) === (dec.seleccion?.cuota ?? null)
    ) return 'igual';
    db.prepare(
      `INSERT INTO prediction_assessments (sport, match_key, event_id, commence_time, assessed_at, probs, decision, selection, odds, edge,
         stake_factor, confidence, data_quality, uncertainty_pp, stability, stability_pp, disagreement, disagreement_pp, market_quality,
         edge_vanish, ood, regime, reasons, model_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      e.sport, e.matchKey, e.eventId, e.commence, now.toISOString(), probs, dec.decision, dec.seleccion?.indice ?? null,
      dec.seleccion?.cuota ?? null, dec.seleccion?.edge ?? null, dec.factorStake, ev.confianza.nivel, ev.calidadDatos.puntuacion,
      ev.incertidumbre.totalPp, ev.estabilidad.nivel, ev.estabilidad.anchoPp, ev.desacuerdo.nivel, ev.desacuerdo.rangoPp,
      ev.mercado.calidad, dec.desaparece, JSON.stringify(e.ood), e.regimen.etiqueta, JSON.stringify(dec.razones), versionsFor(e.sport).model_version,
    );
    return 'nueva';
  } catch {
    return 'rechazada';
  }
}

export interface FilaEvaluacion {
  id: number;
  assessed_at: string;
  decision: string;
  confidence: string;
  data_quality: number;
  stability: string;
  reasons: string[];
}

/** La última evaluación registrada de un partido, antes de `at`. */
export function ultimaEvaluacion(sport: string, matchKey: string, at = new Date().toISOString()): FilaEvaluacion | null {
  const r = getDb()
    .prepare('SELECT id, assessed_at, decision, confidence, data_quality, stability, reasons FROM prediction_assessments WHERE sport = ? AND match_key = ? AND assessed_at <= ? ORDER BY assessed_at DESC, id DESC LIMIT 1')
    .get(sport, matchKey, at) as (Omit<FilaEvaluacion, 'reasons'> & { reasons: string }) | undefined;
  return r ? { ...r, reasons: JSON.parse(r.reasons) as string[] } : null;
}

/**
 * Evalúa y, si el partido es real, registra. Nunca lanza: la confianza no puede romper
 * servir una predicción. Devuelve null si algo falló, y la tarjeta dice «sin evaluación».
 */
export function evaluarParaServir(e: EventoConfianza | null, registrar: boolean): Evaluacion | null {
  if (!e) return null;
  try {
    const ev = evaluar(e);
    if (registrar) {
      registrarEvaluacion(e, ev);
      // Las sombras, en el mismo instante y solo la primera vez (ver shadow/shadows.ts).
      registrarSombras(e);
    }
    return ev;
  } catch {
    return null;
  }
}
