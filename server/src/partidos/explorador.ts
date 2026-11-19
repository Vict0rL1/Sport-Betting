// El explorador de partidos: UNA lista de los próximos de todos los deportes (rediseño de
// noviembre, D2). Sustituye a las tres o cuatro representaciones de los mismos partidos que
// tenía cada pestaña.
//
// ===========================================================================
// DE DÓNDE SALE CADA COSA, Y QUÉ SE DICE DE CADA UNA
// ===========================================================================
//   · El partido: la tabla de próximos de su deporte. `origen` dice si es real (calendario o
//     casa de apuestas) o de demostración (`source = 'fixture'`, inventado por la app).
//   · La predicción: la ÚLTIMA instantánea pre-partido (prediction_snapshots), o la fila del
//     registro si no hay instantánea. Nunca se recalcula aquí, y lleva la hora en que se capturó
//     y la versión del modelo. La misma regla que «Hoy» y Destacados: dos pantallas no pueden dar
//     dos cifras para el mismo partido.
//   · Las cuotas: las de la fila de próximos. `origen: 'casa'` solo si vienen de un proveedor
//     real (`source = 'live'`); las de demostración se marcan `demo`, y un partido sin precio no
//     lleva cuotas (no se rellena con nada). `recibidasEn` es cuándo las guardó la app; la hora
//     de la casa no viaja en esta tabla y no se inventa.
//
// ===========================================================================
// LO QUE NO ENTRA
// ===========================================================================
//   · Un partido con el mismo participante a los dos lados (T01): un alias contra su propio
//     club. Se cuenta en `cuarentena`, con ejemplos, para Diagnóstico.
//   · Un duplicado del mismo partido (mismos participantes y misma hora con dos ids): sale una
//     vez, la fila real antes que la de demostración.
//   · Una distribución imposible (negativa, NaN, que no suma 1): el partido sale, sin predicción,
//     con `sinPrediccion: 'invalida'` (T07).

import { getDb } from '../db.ts';
import { FUENTES, probSql, empateSql, type Fuente } from '../today.ts';
import { zonedToUtc } from '../timezone.ts';
import { basketballConfig, baseballConfig, footballConfig, nflConfig, toursConfig } from '../config.ts';
import type { SportId } from '../sports.ts';

export type Resultado = 'local' | 'empate' | 'visitante';

export interface Participante {
  nombre: string;
  id: string | null;
}

export interface MercadoFila {
  /** El mercado de la lista: quién gana (con empate en el fútbol). */
  id: 'resultado';
  resultados: Resultado[];
  /** Excluyentes y exhaustivos: las probabilidades suman 1. */
  excluyentes: true;
  /** Si la prórroga (y la tanda) cuentan para decidir el ganador. */
  prorroga: 'no' | 'incluida' | 'no-aplica';
}

export interface PrediccionFila {
  /** En el orden de `mercado.resultados`, de 0 a 1. */
  probs: number[];
  /** Cuándo se capturó esta predicción (antes del inicio). */
  capturadaEn: string;
  version: string | null;
  fuente: 'instantanea' | 'registro';
}

export interface CuotasFila {
  /** Cuota decimal por resultado, en el orden de `mercado.resultados`; null si falta. */
  precios: (number | null)[];
  /** Todas las cuotas del mercado presentes y válidas. */
  completas: boolean;
  casas: number | null;
  /** Cuándo las guardó la app. */
  recibidasEn: string | null;
  origen: 'casa' | 'demo';
  /** Recibidas hace más de CUOTAS_CADUCAN_MS. */
  antiguas: boolean;
}

export interface FilaPartido {
  sport: SportId;
  /** El id de la fila de próximos: el de /partido/:sport/:id. */
  id: string;
  matchKey: string | null;
  liga: { id: string; nombre: string } | null;
  /** Torneo (tenis), si lo hay. */
  torneo: string | null;
  cuando: string;
  empezado: boolean;
  local: Participante;
  visitante: Participante;
  /** 'neutral': no hay local (tenis, UFC) y los participantes se nombran sin casa/fuera. */
  sede: 'local' | 'neutral';
  mercado: MercadoFila;
  prediccion: PrediccionFila | null;
  /**
   * Por qué no hay predicción: 'sin-registro' (aún no se ha guardado ninguna), 'invalida' (la
   * guardada no es una distribución válida) o 'demo' (los partidos de demostración no se registran:
   * la ficha la calcula al abrirla).
   */
  sinPrediccion: 'sin-registro' | 'invalida' | 'demo' | null;
  cuotas: CuotasFila | null;
  origen: 'real' | 'demo';
}

export interface Explorador {
  generado: string;
  desde: string;
  hasta: string;
  filas: FilaPartido[];
  cuarentena: { n: number; ejemplos: string[] };
  duplicados: number;
  porDeporte: { sport: SportId; filas: number; error: string | null }[];
}

/** Más viejas que esto, las cuotas se enseñan como antiguas y no alimentan comparaciones. */
export const CUOTAS_CADUCAN_MS = 6 * 3_600_000;
/** Lo que se está jugando sigue en la lista hasta 3 h después de empezar. */
export const EN_JUEGO_MS = 3 * 3_600_000;
export const DIAS_POR_DEFECTO = 7;
export const RANGO_MAXIMO_DIAS = 31;

interface ConfigDeporte {
  sport: SportId;
  fuente: Fuente['deporte'];
  liga: string;
  cuotas: string[];
  ids: [string, string];
  prorroga: MercadoFila['prorroga'];
  sede: FilaPartido['sede'];
  torneo?: string;
}

const DEPORTES: ConfigDeporte[] = [
  { sport: 'football', fuente: 'Fútbol', liga: 'league', cuotas: ['odds_home', 'odds_draw', 'odds_away'], ids: ['home_id', 'away_id'], prorroga: 'no', sede: 'local' },
  { sport: 'basketball', fuente: 'Baloncesto', liga: 'league', cuotas: ['home_odds', 'away_odds'], ids: ['home_id', 'away_id'], prorroga: 'incluida', sede: 'local' },
  { sport: 'baseball', fuente: 'Béisbol', liga: 'league', cuotas: ['odds_home', 'odds_away'], ids: ['home_id', 'away_id'], prorroga: 'incluida', sede: 'local' },
  { sport: 'nfl', fuente: 'NFL', liga: 'league', cuotas: ['odds_home', 'odds_away'], ids: ['home_id', 'away_id'], prorroga: 'incluida', sede: 'local' },
  { sport: 'nhl', fuente: 'NHL', liga: 'league', cuotas: ['odds_home', 'odds_away'], ids: ['home_id', 'away_id'], prorroga: 'incluida', sede: 'local' },
  { sport: 'ufc', fuente: 'UFC', liga: 'league', cuotas: ['odds_home', 'odds_away'], ids: ['home_id', 'away_id'], prorroga: 'no-aplica', sede: 'neutral' },
  { sport: 'tennis', fuente: 'Tenis', liga: 'tour', cuotas: ['p1_odds', 'p2_odds'], ids: ['p1_id', 'p2_id'], prorroga: 'no-aplica', sede: 'neutral', torneo: 'tournament_name' },
];
export const DEPORTES_EXPLORADOR: SportId[] = DEPORTES.map((d) => d.sport);

const NOMBRES_LIGA: Partial<Record<SportId, Map<string, string>>> = {
  football: new Map(footballConfig.leagues.map((l) => [l.id, l.name])),
  basketball: new Map(basketballConfig.leagues.map((l) => [l.id, l.name])),
  baseball: new Map(baseballConfig.leagues.map((l) => [l.id, l.name])),
  nfl: new Map(nflConfig.leagues.map((l) => [l.id, l.name])),
  tennis: new Map(toursConfig.tours.map((t) => [t.id, t.name])),
};
const NOMBRES_FIJOS: Partial<Record<SportId, string>> = { nhl: 'NHL', ufc: 'UFC' };

function nombreLiga(sport: SportId, id: string | null): { id: string; nombre: string } | null {
  if (!id) return null;
  return { id, nombre: NOMBRES_LIGA[sport]?.get(id) ?? NOMBRES_FIJOS[sport] ?? id.toUpperCase() };
}

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** El día siguiente a YYYY-MM-DD, sin pasar por ninguna zona. */
function diaSiguiente(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function instante(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface PeticionVentana {
  /** Un día local (YYYY-MM-DD) en `zona`: de su 00:00 a las 00:00 del siguiente. */
  dia?: string;
  /** Zona IANA de quien mira (Europe/Madrid). Sin ella, UTC. */
  zona?: string;
  /** O un rango explícito de instantes. */
  desde?: string;
  hasta?: string;
}

/**
 * La ventana de la lista en instantes UTC. Hoy / Mañana / un día concreto se calculan en la zona
 * de quien mira (D3, T22): «hoy» en Madrid no es «hoy» en Los Ángeles. Lo que no se entiende
 * (un día mal escrito, una zona que no existe, un rango al revés o de más de 31 días) cae a la
 * ventana por defecto en vez de lanzar.
 */
export function ventana(p: PeticionVentana, ahora: Date = new Date()): { desde: string; hasta: string } {
  const defecto = {
    desde: new Date(ahora.getTime() - EN_JUEGO_MS).toISOString(),
    hasta: new Date(ahora.getTime() + DIAS_POR_DEFECTO * 86_400_000).toISOString(),
  };
  if (p.dia && DIA_RE.test(p.dia)) {
    try {
      const zona = p.zona || 'UTC';
      const desde = zonedToUtc(p.dia, '00:00', zona);
      const hasta = zonedToUtc(diaSiguiente(p.dia), '00:00', zona);
      if (desde && hasta) return { desde, hasta };
    } catch {
      // Zona desconocida: Intl lanza RangeError. Se queda la ventana por defecto.
    }
    return defecto;
  }
  const desde = instante(p.desde);
  const hasta = instante(p.hasta);
  if (desde && hasta && desde < hasta && Date.parse(hasta) - Date.parse(desde) <= RANGO_MAXIMO_DIAS * 86_400_000) return { desde, hasta };
  return defecto;
}

const finito = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** ¿Es una distribución válida? Cada una entre 0 y 1 y suma 1 (±0,001). */
function distribucionValida(ps: unknown[]): ps is number[] {
  if (ps.length < 2 || !ps.every((p) => finito(p) && p >= 0 && p <= 1)) return false;
  return Math.abs((ps as number[]).reduce((a, b) => a + b, 0) - 1) <= 1e-3;
}

function leerJson(v: unknown): unknown {
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export function explorarPartidos(
  p: { desde: string; hasta: string; sports?: SportId[] },
  ahora: Date = new Date(),
): Explorador {
  const db = getDb();
  const filas: FilaPartido[] = [];
  const cuarentena: string[] = [];
  const porDeporte: Explorador['porDeporte'] = [];
  let duplicados = 0;
  const ahoraMs = ahora.getTime();

  const ultimaInstantanea = db.prepare(
    `SELECT probs, outcomes, captured_at, model_version FROM prediction_snapshots
      WHERE sport = ? AND match_key = ? ORDER BY captured_at DESC, id DESC LIMIT 1`,
  );

  for (const d of DEPORTES) {
    if (p.sports && !p.sports.includes(d.sport)) continue;
    const f = FUENTES.find((x) => x.deporte === d.fuente);
    if (!f) continue;
    const tresVias = !!f.empate;
    const resultados: Resultado[] = tresVias ? ['local', 'empate', 'visitante'] : ['local', 'visitante'];
    const delDeporte: FilaPartido[] = [];
    try {
      const rows = db
        .prepare(
          `SELECT u.id AS uid, u.commence_time AS cuando, u.source AS fuente, u.${d.liga} AS liga, u.books AS casas,
                  u.updated_at AS recibidas, u.${d.ids[0]} AS casaId, u.${d.ids[1]} AS fueraId,
                  ${f.casa.replace(/^/, 'u.')} AS casa, ${f.fuera.replace(/^/, 'u.')} AS fuera,
                  ${d.cuotas.map((c, i) => `u.${c} AS c${i}`).join(', ')}
                  ${d.torneo ? `, u.${d.torneo} AS torneo` : ''},
                  l.${f.clave} AS clave, l.predicted_at AS predichaEn, l.model_version AS version,
                  ${probSql(f, 'l.')} AS p ${tresVias ? `, ${empateSql(f, 'l.')} AS pEmpate` : ''}
             FROM ${f.up} u
             LEFT JOIN ${f.log} l ON l.upcoming_id = u.id
            WHERE u.commence_time >= ? AND u.commence_time < ?
            ORDER BY u.commence_time, u.id, l.predicted_at DESC`,
        )
        .all(p.desde, p.hasta) as Record<string, unknown>[];

      const vistos = new Set<string>();
      const porPartido = new Map<string, FilaPartido>();
      for (const r of rows) {
        const id = String(r.uid);
        // Un partido con dos filas de registro (otra clave por un cambio de fecha): la más reciente.
        if (vistos.has(id)) continue;
        vistos.add(id);
        const casaId = r.casaId == null ? null : String(r.casaId);
        const fueraId = r.fueraId == null ? null : String(r.fueraId);
        const casa = String(r.casa ?? '');
        const fuera = String(r.fuera ?? '');
        if (casaId != null && casaId === fueraId) {
          cuarentena.push(`${d.sport} ${r.liga ?? ''}: ${casa} / ${fuera} (${casaId})`);
          continue;
        }
        const origen: FilaPartido['origen'] = r.fuente === 'fixture' ? 'demo' : 'real';

        // La predicción: la última instantánea; si no hay, la del registro.
        let prediccion: PrediccionFila | null = null;
        let sinPrediccion: FilaPartido['sinPrediccion'] = 'sin-registro';
        const clave = r.clave == null ? null : String(r.clave);
        const snap = clave ? (ultimaInstantanea.get(d.sport, clave) as Record<string, unknown> | undefined) : undefined;
        if (snap) {
          const probs = leerJson(snap.probs);
          if (Array.isArray(probs) && probs.length === resultados.length && distribucionValida(probs)) {
            prediccion = { probs, capturadaEn: String(snap.captured_at), version: (snap.model_version as string | null) ?? null, fuente: 'instantanea' };
          } else sinPrediccion = 'invalida';
        } else if (finito(r.p)) {
          const pE = tresVias ? r.pEmpate : 0;
          // El resto es el complemento, redondeado a 9 decimales: 1 − 0,55 no puede salir 0,4499…96.
          const resto = (x: number) => Math.round(x * 1e9) / 1e9;
          const probs = tresVias ? [r.p, pE, resto(1 - r.p - (finito(pE) ? pE : 0))] : [r.p, resto(1 - r.p)];
          if (distribucionValida(probs) && (!tresVias || finito(pE))) {
            prediccion = { probs, capturadaEn: String(r.predichaEn), version: (r.version as string | null) ?? null, fuente: 'registro' };
          } else sinPrediccion = 'invalida';
        } else if (clave) sinPrediccion = 'invalida';
        if (prediccion) sinPrediccion = null;
        else if (origen === 'demo' && sinPrediccion === 'sin-registro') sinPrediccion = 'demo';

        // Las cuotas: solo las que existen; ninguna se rellena.
        const precios = d.cuotas.map((_, i) => {
          const c = r[`c${i}`];
          return finito(c) && c > 1 ? c : null;
        });
        const recibidas = instante(r.recibidas);
        const cuotas: CuotasFila | null = precios.some((x) => x != null)
          ? {
              precios,
              completas: precios.every((x) => x != null),
              casas: finito(r.casas) ? r.casas : null,
              recibidasEn: recibidas,
              origen: origen === 'demo' ? 'demo' : 'casa',
              antiguas: recibidas == null || ahoraMs - Date.parse(recibidas) > CUOTAS_CADUCAN_MS,
            }
          : null;

        const fila: FilaPartido = {
          sport: d.sport,
          id,
          matchKey: clave,
          liga: nombreLiga(d.sport, r.liga == null ? null : String(r.liga)),
          torneo: d.torneo && r.torneo ? String(r.torneo) : null,
          cuando: String(r.cuando),
          empezado: Date.parse(String(r.cuando)) <= ahoraMs,
          local: { nombre: casa, id: casaId },
          visitante: { nombre: fuera, id: fueraId },
          sede: d.sede,
          mercado: { id: 'resultado', resultados, excluyentes: true, prorroga: d.prorroga },
          prediccion,
          sinPrediccion,
          cuotas,
          origen,
        };

        // El mismo partido con dos ids (dos fuentes): uno, el real antes que el inventado.
        if (casaId != null && fueraId != null) {
          const k = `${casaId}|${fueraId}|${fila.cuando}`;
          const otro = porPartido.get(k);
          if (otro) {
            duplicados++;
            if (otro.origen === 'demo' && fila.origen === 'real') {
              delDeporte.splice(delDeporte.indexOf(otro), 1, fila);
              porPartido.set(k, fila);
            }
            continue;
          }
          porPartido.set(k, fila);
        }
        delDeporte.push(fila);
      }
      porDeporte.push({ sport: d.sport, filas: delDeporte.length, error: null });
      filas.push(...delDeporte);
    } catch (e) {
      // Un deporte sin tablas no deja sin lista a los demás; se dice cuál falló.
      porDeporte.push({ sport: d.sport, filas: 0, error: (e as Error).message });
    }
  }

  filas.sort((a, b) => (a.cuando < b.cuando ? -1 : a.cuando > b.cuando ? 1 : `${a.sport}|${a.id}`.localeCompare(`${b.sport}|${b.id}`)));
  return {
    generado: ahora.toISOString(),
    desde: p.desde,
    hasta: p.hasta,
    filas,
    cuarentena: { n: cuarentena.length, ejemplos: cuarentena.slice(0, 10) },
    duplicados,
    porDeporte,
  };
}
