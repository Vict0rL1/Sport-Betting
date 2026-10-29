// Predicciones y apuestas sin resultado mucho después del inicio, con su causa (auditoría del 17
// de octubre, punto 3).
//
// Un partido empezado no tiene resultado hasta que la fuente lo trae, y aquí nunca se supone uno:
// ni jugado, ni cancelado. Lo que se puede saber sin suponer es POR QUÉ falta, comparando la fecha
// del partido con hasta dónde llega la fuente de SU competición (no la del deporte entero: en el
// fútbol, la Premier puede estar al día y la Segunda llevar un año parada):
//
//   · fuente_atrasada: el partido es posterior al último resultado que tiene la fuente de esa
//     competición. Se resolverá solo cuando la fuente avance (o hay que cambiar de fuente).
//   · sin_emparejar: la fuente ya cubre esa fecha y el partido no aparece. O el emparejamiento
//     falla (nombres, claves) o el partido no se jugó en esa fecha; desde aquí no se sabe cuál.
//   · sin_hora: la hora del registro no se entiende; no se puede juzgar.
//
// Y para las apuestas, además: sin_registro (no hay predicción registrada con esa clave) y
// por_liquidar (el registro ya tiene resultado y la apuesta sigue pendiente: falta liquidar).
//
// La misma cuenta frena las apuestas (motivoArchivoAtrasado → trust/decision.ts): con partidos de
// una competición ya jugados que su fuente no tiene, sus ratings no saben lo que pasó en ellos, y
// una apuesta en ella no se podría liquidar con esa fuente. Hace falta la prueba —partidos que
// empezaron y la fuente no tiene—, no basta un hueco largo: la primera jornada de una temporada
// viene después de meses sin resultados y no está atrasada. Y la prueba tiene que ser de al menos
// dos días distintos de los últimos 30 (revisión quant del 20 de octubre): un solo partido aplazado
// no frena la liga entera, y unos playoffs que la fuente no trae no frenan la temporada siguiente.
//
// Solo lee.

import { getDb } from '../db.ts';
import type { SportId } from '../sports.ts';

/** Horas tras el inicio a partir de las cuales falta un resultado que ya debería estar. */
export const HORAS_GRACIA = 48;
/** El freno pide pruebas de al menos estos días distintos… */
export const MIN_DIAS_PRUEBA = 2;
/** …dentro de esta ventana hacia atrás. */
export const VENTANA_PRUEBA_DIAS = 30;

const DIA = 86_400_000;

export type CausaVencida = 'fuente_atrasada' | 'sin_emparejar' | 'sin_hora';
export type CausaApuesta = CausaVencida | 'sin_registro' | 'por_liquidar';

export interface Fuente {
  sport: SportId;
  registro: string;
  /** La columna clave del registro (la que guarda la apuesta en match_key). */
  clave: string;
  /** El último resultado guardado de cada competición: (c, u). */
  historia: string;
}

export const FUENTES: Fuente[] = [
  { sport: 'tennis', registro: 'prediction_log', clave: 'match_key', historia: 'SELECT tour AS c, MAX(tourney_date) AS u FROM matches GROUP BY tour' },
  { sport: 'football', registro: 'fb_prediction_log', clave: 'match_key', historia: 'SELECT league AS c, MAX(match_date) AS u FROM fb_matches GROUP BY league' },
  { sport: 'basketball', registro: 'bb_prediction_log', clave: 'game_key', historia: 'SELECT league AS c, MAX(game_date) AS u FROM bb_games GROUP BY league' },
  { sport: 'baseball', registro: 'bsb_prediction_log', clave: 'match_key', historia: 'SELECT league AS c, MAX(game_date) AS u FROM bsb_games GROUP BY league' },
  { sport: 'nfl', registro: 'naf_prediction_log', clave: 'match_key', historia: 'SELECT league AS c, MAX(game_date) AS u FROM naf_games GROUP BY league' },
  { sport: 'nhl', registro: 'nhl_prediction_log', clave: 'match_key', historia: "SELECT 'nhl' AS c, MAX(game_date) AS u FROM nhl_games" },
  { sport: 'ufc', registro: 'ufc_prediction_log', clave: 'match_key', historia: "SELECT 'ufc' AS c, MAX(fecha) AS u FROM ufc_fights" },
];

/** La competición de un partido: las claves de los siete registros empiezan por ella («epl|…», «atp|…», «nhl|…»). */
export function competicionDe(matchKey: string): string {
  return matchKey.split('|')[0];
}

/** 'YYYYMMDD' o 'YYYY-MM-DD…' → 'YYYY-MM-DD'; null si no es una fecha. */
function fechaIso(u: string | null | undefined): string | null {
  const m = u ? /^(\d{4})-?(\d{2})-?(\d{2})/.exec(u) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Por qué le falta el resultado a un partido ya vencido. `ultimo` es el último resultado de la
 * fuente de su competición. Un día de margen por la zona horaria (la fuente guarda la fecha local
 * del partido; el registro, la hora en UTC) y, en el tenis, trece más: la fuente guarda la fecha
 * de INICIO del torneo, y un partido de hasta dos semanas después puede ser de ese torneo.
 */
export function causaVencida(sport: SportId, commence: string | null | undefined, ultimo: string | null | undefined): CausaVencida {
  const t = commence ? Date.parse(commence) : NaN;
  if (!Number.isFinite(t)) return 'sin_hora';
  const u = fechaIso(ultimo);
  if (!u) return 'fuente_atrasada';
  const margen = 1 + (sport === 'tennis' ? 13 : 0);
  const cubreHasta = Date.parse(`${u}T00:00:00Z`) + (margen + 1) * DIA;
  return t >= cubreHasta ? 'fuente_atrasada' : 'sin_emparejar';
}

export interface CompeticionVencida {
  sport: SportId;
  competicion: string;
  /** Último resultado de su fuente (YYYY-MM-DD), o null si no tiene ninguno. */
  ultimoResultado: string | null;
  vencidas: number;
  fuenteAtrasada: number;
  sinEmparejar: number;
  sinHora: number;
  /** La hora de inicio (tal cual está en el registro) de la vencida más antigua. */
  masAntigua: string | null;
  /** Días distintos (UTC) de los últimos VENTANA_PRUEBA_DIAS con partidos que la fuente no tiene. */
  diasConPrueba: number;
}

export interface ApuestasVencidas {
  banco: 'papel' | 'estrategias';
  sport: string;
  competicion: string;
  n: number;
  fuenteAtrasada: number;
  sinEmparejar: number;
  sinHora: number;
  sinRegistro: number;
  porLiquidar: number;
  masAntigua: string | null;
  /** Lo apostado en ellas: sigue contando en los topes de exposición mientras no se liquiden. */
  importe: number;
}

export interface Vencidas {
  ahora: string;
  horasGracia: number;
  /** Si el freno de la política está encendido (undefined: no se dice; p. ej. en una auditoría). */
  freno?: boolean;
  competiciones: CompeticionVencida[];
  apuestas: ApuestasVencidas[];
  total: { predicciones: number; apuestas: number };
}

const limiteDe = (ahora: Date, horas = HORAS_GRACIA) => ahora.getTime() - horas * 3_600_000;

function ultimosDe(f: Fuente): Map<string, string | null> {
  const filas = getDb().prepare(f.historia).all() as { c: string | null; u: string | null }[];
  return new Map(filas.filter((r) => r.c).map((r) => [r.c as string, fechaIso(r.u)]));
}

/** Las predicciones vencidas de un deporte, por competición. */
function vencidasDe(f: Fuente, ahora: Date, horas = HORAS_GRACIA): CompeticionVencida[] {
  const ultimos = ultimosDe(f);
  const limite = limiteDe(ahora, horas);
  const desdePrueba = ahora.getTime() - VENTANA_PRUEBA_DIAS * DIA;
  const diasDe = new Map<string, Set<string>>();
  const filas = getDb().prepare(`SELECT ${f.clave} AS k, commence_time AS t FROM ${f.registro} WHERE resolved_at IS NULL`).all() as { k: string; t: string | null }[];
  const por = new Map<string, CompeticionVencida>();
  for (const r of filas) {
    const t = r.t ? Date.parse(r.t) : NaN;
    if (Number.isFinite(t) && t > limite) continue;
    const competicion = competicionDe(r.k);
    const ultimo = ultimos.get(competicion) ?? null;
    let c = por.get(competicion);
    if (!c) {
      c = { sport: f.sport, competicion, ultimoResultado: ultimo, vencidas: 0, fuenteAtrasada: 0, sinEmparejar: 0, sinHora: 0, masAntigua: null, diasConPrueba: 0 };
      por.set(competicion, c);
      diasDe.set(competicion, new Set());
    }
    c.vencidas++;
    const causa = causaVencida(f.sport, r.t, ultimo);
    if (causa === 'fuente_atrasada' && t >= desdePrueba) diasDe.get(competicion)!.add(new Date(t).toISOString().slice(0, 10));
    if (causa === 'fuente_atrasada') c.fuenteAtrasada++;
    else if (causa === 'sin_emparejar') c.sinEmparejar++;
    else c.sinHora++;
    if (Number.isFinite(t) && (c.masAntigua == null || t < Date.parse(c.masAntigua))) c.masAntigua = r.t;
  }
  for (const c of por.values()) c.diasConPrueba = diasDe.get(c.competicion)!.size;
  return [...por.values()].sort((a, b) => a.competicion.localeCompare(b.competicion));
}

/**
 * Todo lo vencido: predicciones por competición y apuestas pendientes de los dos bancos. `horas` y
 * `freno`, los de la política, para que el doctor diga lo mismo que el freno (revisión quant).
 */
export function vencidas(ahora = new Date(), opts: { horas?: number; freno?: boolean } = {}): Vencidas {
  const db = getDb();
  const horas = opts.horas ?? HORAS_GRACIA;
  const competiciones = FUENTES.flatMap((f) => vencidasDe(f, ahora, horas));
  const ultimos = new Map(FUENTES.map((f) => [f.sport as string, ultimosDe(f)]));
  const registro = new Map(FUENTES.map((f) => [f.sport as string, db.prepare(`SELECT resolved_at FROM ${f.registro} WHERE ${f.clave} = ?`)]));
  const limite = limiteDe(ahora, horas);
  const apuestas: ApuestasVencidas[] = [];
  for (const [banco, tabla] of [['papel', 'paper_bets'], ['estrategias', 'strategy_bets']] as const) {
    const filas = db.prepare(`SELECT sport, match_key, commence_time, stake FROM ${tabla} WHERE status = 'pending'`).all() as { sport: string; match_key: string; commence_time: string | null; stake: number }[];
    const por = new Map<string, ApuestasVencidas>();
    for (const a of filas) {
      const t = a.commence_time ? Date.parse(a.commence_time) : NaN;
      if (Number.isFinite(t) && t > limite) continue;
      const competicion = competicionDe(a.match_key);
      const k = `${a.sport}|${competicion}`;
      let x = por.get(k);
      if (!x) {
        x = { banco, sport: a.sport, competicion, n: 0, fuenteAtrasada: 0, sinEmparejar: 0, sinHora: 0, sinRegistro: 0, porLiquidar: 0, masAntigua: null, importe: 0 };
        por.set(k, x);
      }
      x.n++;
      x.importe = Math.round((x.importe + (a.stake ?? 0)) * 100) / 100;
      const fila = registro.get(a.sport)?.get(a.match_key) as { resolved_at: string | null } | undefined;
      if (!fila) x.sinRegistro++;
      else if (fila.resolved_at) x.porLiquidar++;
      else {
        const causa = causaVencida(a.sport as SportId, a.commence_time, ultimos.get(a.sport)?.get(competicion) ?? null);
        if (causa === 'fuente_atrasada') x.fuenteAtrasada++;
        else if (causa === 'sin_emparejar') x.sinEmparejar++;
        else x.sinHora++;
      }
      if (Number.isFinite(t) && (x.masAntigua == null || t < Date.parse(x.masAntigua))) x.masAntigua = a.commence_time;
    }
    apuestas.push(...[...por.values()].sort((a, b) => `${a.sport}|${a.competicion}`.localeCompare(`${b.sport}|${b.competicion}`)));
  }
  return {
    ahora: ahora.toISOString(),
    horasGracia: horas,
    freno: opts.freno,
    competiciones,
    apuestas,
    total: { predicciones: competiciones.reduce((s, c) => s + c.vencidas, 0), apuestas: apuestas.reduce((s, a) => s + a.n, 0) },
  };
}

/** Por deporte, recalculado cada 15 minutos como mucho (se pregunta por cada partido evaluado). */
const cache = new Map<string, { t: number; ahora: number; v: Map<string, CompeticionVencida> }>();
const QUINCE_MIN = 15 * 60_000;

/** Para los tests y tras una ingesta: que la próxima pregunta vuelva a contar. */
export function olvidarArchivoAtrasado(): void {
  cache.clear();
}

/**
 * Si la fuente de resultados de la competición de este partido va atrasada, el motivo; si no,
 * null. Atrasada = partidos suyos empezados hace más de `horas` que la fuente no tiene, en al menos
 * MIN_DIAS_PRUEBA días distintos de los últimos VENTANA_PRUEBA_DIAS. `horas` sale de la política
 * (abstencion.archivoAtrasadoHoras).
 */
export function motivoArchivoAtrasado(sport: SportId, matchKey: string, ahora = new Date(), horas = HORAS_GRACIA): string | null {
  const f = FUENTES.find((x) => x.sport === sport);
  if (!f) return null;
  // La caché vale para el mismo «ahora» (±15 min) y como mucho 15 min de reloj.
  const k = `${sport}|${horas}`;
  let c = cache.get(k);
  if (!c || Date.now() - c.t > QUINCE_MIN || Math.abs(ahora.getTime() - c.ahora) > QUINCE_MIN) {
    c = { t: Date.now(), ahora: ahora.getTime(), v: new Map(vencidasDe(f, ahora, horas).map((x) => [x.competicion, x])) };
    cache.set(k, c);
  }
  const competicion = competicionDe(matchKey);
  const x = c.v.get(competicion);
  if (!x || x.diasConPrueba < MIN_DIAS_PRUEBA) return null;
  return `${x.fuenteAtrasada} partido(s) de ${competicion} empezados hace más de ${horas} h que la fuente no tiene, de ${x.diasConPrueba} días distintos de los últimos ${VENTANA_PRUEBA_DIAS} (su último resultado es del ${x.ultimoResultado ?? '— (no tiene ninguno)'})`;
}
