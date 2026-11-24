// La predicción completa de una pelea de la UFC, explicable.
//
// El número sale de la logística publicada (docs/plans/ufc-combinado.md): cinco diferencias entre los
// dos luchadores —Elo, récord, edad, alcance y peleas en la UFC— con los pesos ajustados con todas las
// peleas decididas anteriores al holdout. Cada rasgo se enseña con lo que aporta, en puntos de
// probabilidad, para que la tarjeta pueda decir POR QUÉ.
//
// ===========================================================================
// LO QUE NO HACE, Y LA TARJETA LO DICE
// ===========================================================================
//   · No sabe nada de fuera de la UFC: un luchador que llega con 20 peleas de otra organización
//     empieza en la UFC como un debutante. Del debutante sin ficha no se predice nada.
//   · No conoce lesiones, cambios de categoría ni el corte de peso; tampoco quién sustituye a quién a
//     última hora (la casa sí).
//   · No se mezcla con el mercado ni se calibra: no hay cuotas históricas de la UFC alcanzables con
//     las que medir esa mezcla. La diferencia con la casa se enseña como DESACUERDO, no como valor.

import { VALUE_THRESHOLD } from '../model/market.ts';
import { CANDIDATOS, MODELO_PUBLICADO, predecirConPesos } from './combinado.ts';
import { rasgosDe, type RasgosUfc } from './evaluacion.ts';
import { UFC } from './model.ts';
import { estadoUfc, getFighterInfo, getHeadToHead, HOLDOUT_UFC, type UfcFighterInfo } from './repo.ts';
import { dec, explica, int, lista, motivos, porc, resumen, txt, type Explicacion, type ExplicacionConTexto, type Resumen, EXPLICACIONES } from '../explicaciones/index.ts';

/** El aviso de este deporte, del catálogo de explicaciones (la web lo escribe en su idioma con `aviso.ufc`). */
export const DISCLAIMER: string = EXPLICACIONES['aviso.ufc'];

export type ReliabilityLevel = 'high' | 'medium' | 'low';

/**
 * La banda de incertidumbre, A JUICIO (como en la NHL): la del Elo de cada uno según cuántas peleas
 * tiene detrás. Con diez peleas cada uno, ±6,7 pp; con menos, más.
 */
const ELO_SIGMA_C = 74;
const PELEAS_EFECTIVAS = 10;
const MIN_PELEAS = 3;
/** Días sin pelear a partir de los que se avisa (un año y medio). */
const DIAS_PARADO = 540;

export interface UfcSide extends UfcFighterInfo {
  last5: ('W' | 'L' | 'D' | 'NC')[];
}

export interface UfcFactor {
  key: keyof RasgosUfc;
  label: string;
  /** La etiqueta como código (fase C). */
  explicacion: Explicacion;
  /** La diferencia en sus unidades (puntos de Elo, años, cm, peleas…), del A menos el B. */
  diff: number | null;
  /** Lo que aporta al logit (peso × rasgo). Positivo, a favor de A. */
  logit: number;
  /** Lo mismo en puntos de probabilidad para A: p(con el rasgo) − p(sin él). */
  pp: number;
}

export interface UfcMarket {
  odds: { home: number; away: number };
  home: number;
  away: number;
  overround: number;
}

export interface UfcPrediction {
  league: 'ufc';
  /** `home` es el luchador A y `away` el B (ver ufc/schema.ts): no hay local. */
  fighters: { home: UfcSide; away: UfcSide };
  model: { home: number; away: number };
  /** Lo que se publica. Igual que `model`: no hay post-proceso medido para la UFC. */
  final: { home: number; away: number };
  postprocess: { calibrator: 'ninguno'; weight: null; disagreement: null; note: string };
  rasgos: RasgosUfc;
  factors: UfcFactor[];
  h2h: ReturnType<typeof getHeadToHead>;
  market: {
    market: UfcMarket | null;
    edge: { home: number; away: number } | null;
    /** Desacuerdo, no valor: ver la cabecera del fichero. */
    verdict: 'differs_home' | 'differs_away' | 'agree' | 'no_market';
  };
  reliability: { level: ReliabilityLevel; label: string; marginPp: number; reasons: string[]; explicaciones: Explicacion[]; fightsBehind: { home: number; away: number } };
  verdict: { label: string; close: boolean; marginPp: number };
  summary: Resumen;
  context: { modelo: string; pesos: Record<string, number>; ajustadaCon: number; holdoutDesde: number };
  disclaimer: string;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const sigm = (t: number) => 1 / (1 + Math.exp(-t));

function deVig(oddsHome: number | null | undefined, oddsAway: number | null | undefined): UfcMarket | null {
  if (!oddsHome || !oddsAway || oddsHome <= 1 || oddsAway <= 1) return null;
  const h = 1 / oddsHome;
  const a = 1 / oddsAway;
  return { odds: { home: oddsHome, away: oddsAway }, home: h / (h + a), away: a / (h + a), overround: h + a };
}

const ETIQUETAS: Record<keyof RasgosUfc, string> = {
  elo: EXPLICACIONES['ufc.rasgo.elo'],
  record: EXPLICACIONES['ufc.rasgo.record'],
  edad: EXPLICACIONES['ufc.rasgo.edad'],
  alcance: EXPLICACIONES['ufc.rasgo.alcance'],
  experiencia: EXPLICACIONES['ufc.rasgo.experiencia'],
};

function fiabilidad(a: UfcFighterInfo, b: UfcFighterInfo, ahora: Date, rasgos: RasgosUfc, margenProb: number): UfcPrediction['reliability'] {
  const ef = (n: number) => Math.max(1, Math.min(n, PELEAS_EFECTIVAS));
  const sigma = ELO_SIGMA_C / Math.sqrt(ef(a.fightsInDb)) + ELO_SIGMA_C / Math.sqrt(ef(b.fightsInDb));
  const p = (dr: number) => 1 / (1 + 10 ** (-dr / 400));
  // La mitad del intervalo (±): con diez peleas cada uno, σ = 46,8 puntos de Elo → ±6,7 pp.
  const marginPp = Math.round((p(sigma) - p(-sigma)) * 500) / 10;
  const reasons: ExplicacionConTexto[] = [];
  let level: ReliabilityLevel = 'medium';
  const pocas = [a, b].filter((x) => x.fightsInDb < MIN_PELEAS);
  if (pocas.length) {
    level = 'low';
    reasons.push(explica('ufc.fiab.pocasPeleas', { luchadores: lista(pocas.map((x) => x.name)), n: int(pocas.length), min: int(MIN_PELEAS) }));
  }
  const parados = [a, b].filter((x) => x.lastDate && (ahora.getTime() - Date.parse(x.lastDate)) / 86_400_000 > DIAS_PARADO);
  if (parados.length) reasons.push(explica('ufc.fiab.parado', { luchadores: lista(parados.map((x) => x.name)), n: int(parados.length) }));
  if (rasgos.edad === 0) reasons.push(explica('ufc.fiab.sinEdad'));
  if (rasgos.alcance === 0 && (a.reachCm == null || b.reachCm == null)) reasons.push(explica('ufc.fiab.sinAlcance'));
  if (margenProb < 0.06) reasons.push(explica('ufc.fiab.igualada'));
  reasons.push(explica('ufc.fiab.soloUfc'));
  return { level, label: level === 'low' ? 'fiabilidad baja' : 'fiabilidad media', marginPp, ...motivos(reasons), fightsBehind: { home: a.fightsInDb, away: b.fightsInDb } };
}

export interface PredictInput {
  /** Luchador A (id de ufcstats) y B. */
  homeId: string;
  awayId: string;
  oddsHome?: number | null;
  oddsAway?: number | null;
  /** El día de la pelea, para la edad (por defecto, hoy). */
  fecha?: string;
  ahora?: Date;
}

export function buildPrediction(input: PredictInput): UfcPrediction | null {
  const { homeId, awayId } = input;
  if (!homeId || !awayId || homeId === awayId) return null;
  const ahora = input.ahora ?? new Date();
  const A = getFighterInfo(homeId, ahora);
  const B = getFighterInfo(awayId, ahora);
  if (!A || !B) return null;
  const e = estadoUfc();
  const fecha = input.fecha ?? ahora.toISOString().slice(0, 10);
  const lado = (id: string) => ({ elo: e.elo.get(id) ?? UFC.inicial, peleas: e.peleas.get(id) ?? 0, victorias: e.victorias.get(id) ?? 0, ficha: e.fichas.get(id) });
  const rasgos = rasgosDe(lado(homeId), lado(awayId), fecha);
  const { p, aportes } = predecirConPesos(rasgos, e.pesos);
  const t = Math.log(p / (1 - p));

  const edadA = A.birthDate ? (Date.parse(fecha) - Date.parse(A.birthDate)) / (365.25 * 86_400_000) : null;
  const edadB = B.birthDate ? (Date.parse(fecha) - Date.parse(B.birthDate)) / (365.25 * 86_400_000) : null;
  const diffs: Record<keyof RasgosUfc, number | null> = {
    elo: Math.round(A.elo - B.elo),
    record: Math.round((A.smoothedRecord - B.smoothedRecord) * 1000) / 10,
    edad: edadA != null && edadB != null && rasgos.edad !== 0 ? Math.round((edadA - edadB) * 10) / 10 : null,
    alcance: A.reachCm != null && B.reachCm != null && rasgos.alcance !== 0 ? Math.round((A.reachCm - B.reachCm) * 10) / 10 : null,
    experiencia: A.fightsInDb - B.fightsInDb,
  };
  const factors: UfcFactor[] = CANDIDATOS[MODELO_PUBLICADO].map((k) => ({
    key: k,
    label: ETIQUETAS[k],
    explicacion: { codigo: `ufc.rasgo.${k}`, params: {} },
    diff: diffs[k],
    logit: r4(aportes[k]),
    pp: Math.round((p - sigm(t - aportes[k])) * 1000) / 10,
  }));

  const market = deVig(input.oddsHome, input.oddsAway);
  const edge = market ? { home: r4(p - market.home), away: r4(1 - p - market.away) } : null;
  const verdictMercado: UfcPrediction['market']['verdict'] = !edge ? 'no_market' : edge.home >= VALUE_THRESHOLD ? 'differs_home' : edge.away >= VALUE_THRESHOLD ? 'differs_away' : 'agree';
  const reliability = fiabilidad(A, B, ahora, rasgos, Math.abs(p - 0.5));
  const close = Math.abs(p - 0.5) * 100 < reliability.marginPp;
  const fav = p >= 0.5 ? A : B;
  const otro = p >= 0.5 ? B : A;
  const pFav = Math.max(p, 1 - p);
  const side = (x: UfcFighterInfo): UfcSide => ({ ...x, last5: x.form.slice(0, 5).map((f) => f.result) });

  // Los dos rasgos que más empujan, dichos en claro.
  const fuertes = [...factors].filter((f) => Math.abs(f.pp) >= 0.5).sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));
  const frase = (f: UfcFactor): ExplicacionConTexto => {
    const comun = { quien: txt(f.pp > 0 ? A.name : B.name), pp: dec(Math.abs(f.pp), 1) };
    if (f.key === 'elo') return explica('ufc.factor.elo', { ...comun, eloA: int(A.elo), eloB: int(B.elo) });
    if (f.key === 'record') return explica('ufc.factor.record', { ...comun, victoriasA: int(A.record.wins), derrotasA: int(A.record.losses), victoriasB: int(B.record.wins), derrotasB: int(B.record.losses) });
    if (f.key === 'edad' && f.diff != null) return explica('ufc.factor.edad', { ...comun, joven: txt(f.diff < 0 ? A.name : B.name), anios: dec(Math.abs(f.diff), 1) });
    if (f.key === 'alcance' && f.diff != null) return explica('ufc.factor.alcance', { ...comun, largo: txt(f.diff > 0 ? A.name : B.name), cm: dec(Math.abs(f.diff), 0) });
    if (f.key === 'experiencia') return explica('ufc.factor.experiencia', { ...comun, peleasA: int(A.fightsInDb), peleasB: int(B.fightsInDb) });
    return explica('ufc.factor.otro', { ...comun, factor: txt(f.label) });
  };
  const bullets = fuertes.slice(0, 3).map(frase);
  if (market) bullets.push(explica('ufc.mercado', { pMercado: porc(market.home), luchador: txt(A.name), pModelo: porc(p) }));
  if (A.weightClass && B.weightClass && A.weightClass !== B.weightClass) bullets.push(explica('ufc.categorias', { categoriaA: txt(A.weightClass), categoriaB: txt(B.weightClass) }));

  return {
    league: 'ufc',
    fighters: { home: side(A), away: side(B) },
    model: { home: r4(p), away: r4(1 - p) },
    final: { home: r4(p), away: r4(1 - p) },
    postprocess: { calibrator: 'ninguno', weight: null, disagreement: null, note: 'sin post-proceso: no hay cuotas históricas de la UFC para ajustar la calibración ni la mezcla' },
    rasgos,
    factors,
    h2h: getHeadToHead(homeId, awayId),
    market: { market, edge, verdict: verdictMercado },
    reliability,
    verdict: { label: fav.name, close, marginPp: reliability.marginPp },
    summary: resumen(explica('ufc.titular', { fav: txt(fav.name), rival: txt(otro.name), p: porc(pFav) }), bullets),
    context: {
      modelo: MODELO_PUBLICADO,
      pesos: Object.fromEntries(CANDIDATOS[MODELO_PUBLICADO].map((k, i) => [k, r4(e.pesos[i] ?? 0)])),
      ajustadaCon: e.ajustadaCon,
      holdoutDesde: HOLDOUT_UFC,
    },
    disclaimer: DISCLAIMER,
  };
}
