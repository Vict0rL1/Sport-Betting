// Exportaciones (Fase 3.4): los conjuntos que alguien querría abrir en una hoja de cálculo o
// pasar a otra herramienta, con filtros de fecha y deporte, en CSV (RFC 4180) o JSON.
// Solo lectura: nada de aquí escribe en la base.

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db.ts';
import { payoutOf, profitOf } from '../bets.ts';
import { ROOT } from '../config.ts';
import { SPORT_IDS, type SportId } from '../sports.ts';
import { ORDEN_LIBRE, POLITICA_EVALUACION, resolverEvaluada, resultadosDe, type FinalLeida } from '../evaluation/evaluada.ts';
import { publicadasDe } from '../prediction/publicada.ts';
import { clasePrepartido, empezado } from '../prematch/tiempo.ts';
import { clavePeriodo, cohorteDeMotivo, DEFINICION_RENDIMIENTO, filasEvaluadas } from '../evaluation/calibracion.ts';
import { zonaPolitica } from '../staking/contabilidad.ts';

export const DATASETS = ['predicciones', 'apuestas', 'papel', 'snapshots', 'benchmark', 'evaluadas'] as const;
export type Dataset = (typeof DATASETS)[number];

export interface Filtros {
  /** YYYY-MM-DD, inclusive. */
  desde?: string;
  hasta?: string;
  sport?: string;
}

export interface Exportacion {
  columnas: string[];
  datos: Record<string, unknown>[];
  /** Algo que quien exporta debe saber y que no cabe en una fila (p. ej., por qué no sale ninguna). */
  aviso?: string;
}

const fechaIso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** Los siete registros de predicciones, con las mismas columnas. */
function predicciones(f: Filtros): Exportacion {
  const db = getDb();
  // a = local (o el jugador 1 en el tenis, el luchador A en la UFC), b = visitante; prob_* son las
  // PUBLICADAS (la enseñada donde hay post-proceso), y outcome, el resultado: home / draw / away.
  // Antes cinco de las siete consultas nombraban columnas que no existen (p_a, outcome, prob_away…)
  // y caían a `SELECT *`, sin columnas comunes y, en el baloncesto, sin match_key (hallazgo 3).
  const fuentes: { sport: string; tabla: string; sql: string }[] = [
    { sport: 'tennis', tabla: 'prediction_log', sql: "SELECT 'tennis' AS sport, match_key, predicted_at, commence_time, prob1 AS prob_a, 1 - prob1 AS prob_b, NULL AS prob_draw, CASE WHEN winner_id IS NULL THEN NULL WHEN winner_id = p1_id THEN 'home' ELSE 'away' END AS outcome, model_version FROM prediction_log" },
    {
      sport: 'football',
      tabla: 'fb_prediction_log',
      sql: "SELECT 'football' AS sport, match_key, predicted_at, commence_time, COALESCE(shown_home, prob_home) AS prob_a, COALESCE(shown_away, prob_away) AS prob_b, COALESCE(shown_draw, prob_draw) AS prob_draw, CASE WHEN home_goals IS NULL THEN NULL WHEN home_goals > away_goals THEN 'home' WHEN home_goals = away_goals THEN 'draw' ELSE 'away' END AS outcome, model_version FROM fb_prediction_log",
    },
    { sport: 'basketball', tabla: 'bb_prediction_log', sql: "SELECT 'basketball' AS sport, game_key AS match_key, predicted_at, commence_time, prob_home AS prob_a, 1 - prob_home AS prob_b, NULL AS prob_draw, CASE WHEN home_pts IS NULL THEN NULL WHEN home_pts > away_pts THEN 'home' WHEN home_pts < away_pts THEN 'away' ELSE NULL END AS outcome, model_version FROM bb_prediction_log" },
    { sport: 'baseball', tabla: 'bsb_prediction_log', sql: "SELECT 'baseball' AS sport, match_key, predicted_at, commence_time, prob_home AS prob_a, 1 - prob_home AS prob_b, NULL AS prob_draw, CASE WHEN home_runs IS NULL THEN NULL WHEN home_runs > away_runs THEN 'home' WHEN home_runs < away_runs THEN 'away' ELSE NULL END AS outcome, model_version FROM bsb_prediction_log" },
    {
      sport: 'nfl',
      tabla: 'naf_prediction_log',
      sql: "SELECT 'nfl' AS sport, match_key, predicted_at, commence_time, COALESCE(shown_home, prob_home) AS prob_a, 1 - COALESCE(shown_home, prob_home) AS prob_b, NULL AS prob_draw, CASE WHEN home_points IS NULL THEN NULL WHEN home_points > away_points THEN 'home' WHEN home_points = away_points THEN 'draw' ELSE 'away' END AS outcome, model_version FROM naf_prediction_log",
    },
    {
      sport: 'nhl',
      tabla: 'nhl_prediction_log',
      sql: "SELECT 'nhl' AS sport, match_key, predicted_at, commence_time, COALESCE(shown_home, prob_home) AS prob_a, 1 - COALESCE(shown_home, prob_home) AS prob_b, NULL AS prob_draw, CASE WHEN home_goals IS NULL THEN NULL WHEN home_goals > away_goals THEN 'home' ELSE 'away' END AS outcome, model_version FROM nhl_prediction_log",
    },
    {
      sport: 'ufc',
      tabla: 'ufc_prediction_log',
      // a = el luchador A (home_*), b = el B; empate y «sin resultado» se exportan como tales.
      sql: "SELECT 'ufc' AS sport, match_key, predicted_at, commence_time, COALESCE(shown_home, prob_home) AS prob_a, 1 - COALESCE(shown_home, prob_home) AS prob_b, NULL AS prob_draw, CASE outcome WHEN 'A' THEN 'home' WHEN 'B' THEN 'away' WHEN 'EMPATE' THEN 'draw' WHEN 'NC' THEN 'no_contest' ELSE NULL END AS outcome, model_version FROM ufc_prediction_log",
    },
  ];
  const datos: Record<string, unknown>[] = [];
  for (const x of fuentes) {
    if (f.sport && f.sport !== x.sport) continue;
    let filas: Record<string, unknown>[];
    try {
      filas = db.prepare(`${x.sql} ORDER BY predicted_at`).all() as Record<string, unknown>[];
    } catch {
      // Una columna con otro nombre en un deporte: se exporta lo que la tabla tenga.
      try {
        filas = (db.prepare(`SELECT * FROM ${x.tabla}`).all() as Record<string, unknown>[]).map((r) => ({ sport: x.sport, ...r }));
      } catch {
        continue;
      }
    }
    const enFecha = filas.filter((r) => enRango(String(r.predicted_at ?? r.commence_time ?? ''), f));
    datos.push(...conEvaluada(x.sport as SportId, enFecha));
  }
  return { columnas: ['sport', 'match_key', 'predicted_at', 'commence_time', 'prob_a', 'prob_b', 'prob_draw', 'outcome', 'model_version', ...COLUMNAS_EVALUADA], datos };
}

/**
 * Lo que se PUNTÚA de cada partido (evaluation/evaluada.ts), al lado de lo registrado: la política,
 * si se evaluó la final congelada o la publicación («legado»), de dónde salió, cuándo se capturó y
 * sus probabilidades en el mismo orden que prob_a / prob_b / prob_draw. 'pendiente' = aún no ha
 * empezado; 'excluida' = no se puntúa, con el motivo.
 */
const COLUMNAS_EVALUADA = ['politica_evaluacion', 'evaluacion', 'motivo_exclusion', 'evaluada_fuente', 'evaluada_en', 'eval_prob_a', 'eval_prob_b', 'eval_prob_draw'];

function conEvaluada(sport: SportId, filas: Record<string, unknown>[]): Record<string, unknown>[] {
  if (filas.length === 0) return filas;
  const db = getDb();
  const finales = new Map<string, FinalLeida>();
  try {
    for (const r of db.prepare('SELECT match_key, source, outcomes, probs, market_probs, model_version, captured_at, snapshot_id FROM prematch_final WHERE sport = ?').all(sport) as Record<string, unknown>[]) {
      finales.set(String(r.match_key), { source: String(r.source), outcomes: r.outcomes, probs: r.probs, market_probs: r.market_probs ?? null, model_version: (r.model_version as string | null) ?? null, captured_at: String(r.captured_at), snapshot_id: r.snapshot_id == null ? null : Number(r.snapshot_id) });
    }
  } catch {
    // Sin la tabla todavía: nada congelado.
  }
  const pubs = publicadasDe(sport);
  const n = resultadosDe(sport);
  return filas.map((r) => {
    const mk = String(r.match_key);
    const pub = pubs.get(mk) ?? null;
    const base = { politica_evaluacion: POLITICA_EVALUACION, evaluacion: null as string | null, motivo_exclusion: null as string | null, evaluada_fuente: null as string | null, evaluada_en: null as string | null, eval_prob_a: null as number | null, eval_prob_b: null as number | null, eval_prob_draw: null as number | null };
    const final = finales.get(mk) ?? null;
    if (!final && empezado(pub?.commence ?? (r.commence_time as string | null)) !== true) return { ...r, ...base, evaluacion: 'pendiente' };
    // Como en Rendimiento y en «¿Acertó?»: solo cuenta un partido con publicación anterior al inicio.
    const prepartido = pub != null && clasePrepartido(pub.en, pub.commence) === 'prepartido';
    const ev = !prepartido
      ? ({ ok: false, motivo: pub ? 'publicacion-tardia' : 'sin-publicacion' } as const)
      : resolverEvaluada({ probs: pub.probs, mercado: null, version: (r.model_version as string | null) ?? null, en: pub.en }, final, n, { nombres: pub.nombres, ordenLibre: ORDEN_LIBRE.has(sport) });
    if (!ev.ok) return { ...r, ...base, evaluacion: 'excluida', motivo_exclusion: ev.motivo };
    const p = ev.evaluada.probs;
    return {
      ...r,
      ...base,
      evaluacion: ev.evaluada.tipo,
      evaluada_fuente: ev.evaluada.fuente,
      evaluada_en: ev.evaluada.capturadaEn,
      eval_prob_a: p[0],
      eval_prob_b: p[p.length - 1],
      eval_prob_draw: p.length === 3 ? p[1] : null,
    };
  });
}

function enRango(fecha: string, f: Filtros): boolean {
  const d = fecha.slice(0, 10).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const desde = fechaIso(f.desde);
  const hasta = fechaIso(f.hasta);
  if (desde && d < desde) return false;
  if (hasta && d > hasta) return false;
  return true;
}

function tabla(nombre: string, columnaFecha: string, f: Filtros, columnaSport = 'sport'): Exportacion {
  const db = getDb();
  const cols = (db.prepare(`PRAGMA table_info(${nombre})`).all() as unknown as { name: string }[]).map((c) => c.name);
  const cond: string[] = [];
  const args: unknown[] = [];
  if (fechaIso(f.desde)) {
    cond.push(`substr(${columnaFecha}, 1, 10) >= ?`);
    args.push(f.desde);
  }
  if (fechaIso(f.hasta)) {
    cond.push(`substr(${columnaFecha}, 1, 10) <= ?`);
    args.push(f.hasta);
  }
  if (f.sport && cols.includes(columnaSport)) {
    cond.push(`${columnaSport} = ?`);
    args.push(f.sport);
  }
  const datos = db.prepare(`SELECT * FROM ${nombre}${cond.length ? ` WHERE ${cond.join(' AND ')}` : ''} ORDER BY ${columnaFecha}, rowid LIMIT 200000`).all(...(args as never[])) as Record<string, unknown>[];
  return { columnas: cols, datos };
}

/**
 * Las apuestas con su pago bruto y su neto CALCULADOS al exportar, con la misma aritmética exacta que
 * la API y la vista previa (dinero.ts, B2): la hoja de cálculo dice lo mismo que la pantalla. No se
 * guardan: se calculan de apuesta, cuota y estado, como en bets.ts.
 */
function conPagos(e: Exportacion): Exportacion {
  const datos = e.datos.map((r) => {
    const b = { stake: Number(r.stake), odds: Number(r.odds), status: String(r.status), payout: r.payout == null ? null : Number(r.payout) } as Parameters<typeof payoutOf>[0];
    return { ...r, pago_bruto: payoutOf(b), neto: profitOf(b) };
  });
  return { columnas: [...e.columnas, 'pago_bruto', 'neto'], datos };
}

/** Las tablas del walk-forward por deporte, aplanadas: una fila por deporte y periodo. */
function benchmark(f: Filtros): Exportacion {
  const datos: Record<string, unknown>[] = [];
  for (const sport of SPORT_IDS) {
    if (f.sport && f.sport !== sport) continue;
    const p = path.join(ROOT, 'experiments', 'walkforward', `${sport}.json`);
    if (!fs.existsSync(p)) continue;
    let wf: { periodos?: { periodo: string; n: number; modelo?: { logLoss?: number | null; brier?: number | null }; recalibrado?: { logLoss?: number | null }; baselines?: Record<string, { logLoss?: number | null }>; mercado?: { logLoss?: number | null } | null }[] };
    try {
      wf = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    for (const x of wf.periodos ?? []) {
      const fila: Record<string, unknown> = { sport, periodo: x.periodo, n: x.n, modelo_logloss: x.modelo?.logLoss ?? null, modelo_brier: x.modelo?.brier ?? null, recalibrado_logloss: x.recalibrado?.logLoss ?? null, mercado_logloss: x.mercado?.logLoss ?? null };
      for (const [b, v] of Object.entries(x.baselines ?? {})) fila[`baseline_${b.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_logloss`] = v?.logLoss ?? null;
      datos.push(fila);
    }
  }
  const columnas = [...new Set(datos.flatMap((d) => Object.keys(d)))];
  return { columnas, datos };
}

/**
 * Fase E: las predicciones EVALUADAS, una fila por partido, con las mismas definiciones que la
 * calibración y el rendimiento por periodo (evaluation/calibracion.ts): lo que se dibuja y lo que se
 * exporta salen de la misma función; los excluidos van también, con `motivo_exclusion` y sin cifras.
 * OJO: aquí `desde`/`hasta` son días LOCALES en la zona de la política (en los demás conjuntos, el
 * prefijo de la fecha guardada); con
 * una APP_TIMEZONE inválida no se asigna ningún día y no sale ninguna fila (no se finge otra zona).
 * Lo reconstruido no está: es una reproducción de temporadas de reserva, no lo que se enseñó.
 */
function evaluadas(f: Filtros): Exportacion {
  const columnas = ['sport', 'match_key', 'commence_time', 'dia', 'mes', 'semana', 'cohorte', 'version', 'liga', 'prob_a', 'prob_draw', 'prob_b', 'outcome', 'brier', 'log_loss', 'brier_mercado', 'motivo_exclusion', 'definicion', 'zona'];
  const { zona } = zonaPolitica();
  if (!zona) return { columnas, datos: [], aviso: 'APP_TIMEZONE no es una zona válida: no se puede asignar el día de ningún partido y no sale ninguna fila (no se finge otra zona).' };
  const deportes = f.sport && (SPORT_IDS as readonly string[]).includes(f.sport) ? [f.sport as SportId] : [...SPORT_IDS];
  const datos: Record<string, unknown>[] = [];
  for (const sport of deportes) {
    const { filas, excluidas } = filasEvaluadas(sport, { desde: fechaIso(f.desde) ?? undefined, hasta: fechaIso(f.hasta) ?? undefined }, zona);
    // Los partidos que no se evalúan, con su motivo: así las exclusiones del informe se pueden rehacer.
    for (const e of excluidas) {
      datos.push({
        sport, match_key: e.matchKey, commence_time: e.cuando, dia: e.dia, mes: e.dia ? clavePeriodo(e.dia, 'mes') : null, semana: e.dia ? clavePeriodo(e.dia, 'semana') : null,
        cohorte: cohorteDeMotivo(e.motivo), version: null, liga: e.liga, prob_a: null, prob_draw: null, prob_b: null, outcome: null,
        brier: null, log_loss: null, brier_mercado: null, motivo_exclusion: e.motivo, definicion: DEFINICION_RENDIMIENTO, zona,
      });
    }
    for (const r of filas) {
      const tres = r.probs.length === 3;
      datos.push({
        sport,
        match_key: r.matchKey,
        commence_time: r.cuando,
        dia: r.dia,
        mes: clavePeriodo(r.dia, 'mes'),
        semana: clavePeriodo(r.dia, 'semana'),
        cohorte: r.cohorte,
        version: r.version,
        liga: r.liga,
        prob_a: r.probs[0],
        prob_draw: tres ? r.probs[1] : null,
        prob_b: r.probs[r.probs.length - 1],
        outcome: (tres ? ['home', 'draw', 'away'] : ['home', 'away'])[r.y] ?? null,
        brier: r.brier,
        log_loss: r.logLoss,
        brier_mercado: r.brierMercado,
        motivo_exclusion: null,
        definicion: DEFINICION_RENDIMIENTO,
        zona,
      });
    }
  }
  return { columnas, datos };
}

export function exportar(dataset: Dataset, f: Filtros = {}): Exportacion {
  switch (dataset) {
    case 'predicciones':
      return predicciones(f);
    case 'apuestas':
      return conPagos(tabla('bets', 'placed_on', f));
    case 'papel':
      return tabla('paper_bets', 'placed_at', f);
    case 'snapshots':
      return tabla('odds_snapshots', 'observed_at', f);
    case 'benchmark':
      return benchmark(f);
    case 'evaluadas':
      return evaluadas(f);
  }
}

/** CSV según RFC 4180: comillas dobles cuando hace falta, dobladas dentro, CRLF. */
export function aCsv(columnas: string[], datos: Record<string, unknown>[]): string {
  const celda = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Inyección de fórmulas: un TEXTO que empieza por = + - @ (o tab/CR, que algunas hojas
    // saltan) se abriría como fórmula. Un apóstrofo delante lo deja como texto. Los números
    // no son texto: −100 sigue siendo −100.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [columnas.map(celda).join(',')];
  for (const d of datos) lineas.push(columnas.map((c) => celda(d[c])).join(','));
  return lineas.join('\r\n') + '\r\n';
}
