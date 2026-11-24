// La evaluación EN VIVO: lo que el modelo dijo antes de cada partido real, contra lo que
// pasó. Solo lee los registros de predicciones (escritos antes del partido, inmutables):
// ningún número de backtest entra aquí, y por eso cada informe lleva `origen: 'live'`.
//
// Se evalúa la probabilidad ENSEÑADA (la calibrada, donde hay capa de calibración), que es
// la que la persona vio y la que usa el banco de papel. Juzgar la cruda sería juzgar un
// número que no se enseñó — el fallo que tuvo «¿Acertó?».

import { getDb } from '../db.ts';
import { evaluate, type Informe, type Prediccion } from './metrics.ts';
import { SPORT_IDS, type SportId } from '../sports.ts';
import { avisoMuestra, type AvisoMuestra } from './sample.ts';
import { prepartidoSql } from '../prematch/tiempo.ts';
import { ORDEN_LIBRE, POLITICA_EVALUACION, finalDeFila, joinFinal, resolverEvaluada, type MotivoSinEvaluar, type TipoEvaluacion } from './evaluada.ts';

/**
 * Solo lo escrito ANTES del inicio (auditoría del 17 de octubre, punto 2): una fila registrada
 * después no es una predicción pre-partido, aunque esté en el registro. Se queda allí, con su
 * procedencia; aquí no cuenta.
 */
const PREPARTIDO = prepartidoSql();

type Fila = Record<string, number | string | null>;

/** Una predicción en vivo, con la versión del modelo que la hizo (null: anterior al versionado). */
export type PrediccionEnVivo = Prediccion & {
  version: string | null;
  cuando: string | null;
  liga: string | null;
  /**
   * Lo que dijo el MODELO (prob_*), antes de calibrar y mezclar con el mercado. `p` es lo
   * publicado. La deriva se mide con esto, que es lo que midió el backtest (lote C, C4).
   */
  pModelo?: number[];
  /** La clave del partido en su registro. */
  matchKey?: string;
  /** Qué se evaluó (evaluation/evaluada.ts): la final congelada, o la publicación si no hay final. */
  evaluacion?: TipoEvaluacion;
  /**
   * Lo PUBLICADO (la primera fila del registro), aparte de `p` (lo evaluado). La deriva no lee esto
   * sino `publicacionesResueltas()`, que no pasa por la política de evaluación.
   */
  pPublicada?: number[];
};

/**
 * Una publicación del registro con su fila, antes de resolver qué se evalúa. `bruto`: lo publicado tal
 * cual (fútbol), para que la política de evaluación decida si se puede leer; `p` va renormalizado,
 * que es lo que mide la deriva.
 */
type Pub = PrediccionEnVivo & { fila: Fila; bruto?: number[] };

function leer(sql: string): Fila[] {
  try {
    return getDb().prepare(sql).all() as Fila[];
  } catch {
    // Un deporte sin tabla todavía no puede tumbar la evaluación de los otros cuatro.
    return [];
  }
}

const dos = (r: Fila): Pub => ({
  fila: r,
  p: [r.p as number, 1 - (r.p as number)],
  pModelo: r.pm == null ? undefined : [r.pm as number, 1 - (r.pm as number)],
  y: r.y as number,
  mercado: r.m == null ? null : [r.m as number, 1 - (r.m as number)],
  version: (r.v as string | null) ?? null,
  cuando: (r.t as string | null) ?? null,
  liga: (r.l as string | null) ?? null,
});

function publicaciones(deporte: SportId): Pub[] {
  switch (deporte) {
    case 'tennis':
      return conFinal(deporte, 
        `SELECT prob1 AS p, prob1 AS pm, market_prob1 AS m, CASE WHEN winner_id = p1_id THEN 0 ELSE 1 END AS y, model_version AS v, commence_time AS t, tour AS l
           , match_key AS mk, rowid AS rid, predicted_at AS pub_en, p1_name AS n1, p2_name AS n2
           FROM prediction_log WHERE resolved_at IS NOT NULL AND winner_id IS NOT NULL AND ${PREPARTIDO}`,
      ).map(dos);
    case 'football':
      return conFinal(deporte, 
        `SELECT COALESCE(shown_home, prob_home) AS h, COALESCE(shown_draw, prob_draw) AS d, COALESCE(shown_away, prob_away) AS a,
                prob_home AS mh0, prob_draw AS md0, prob_away AS ma0,
                market_prob_home AS mh, market_prob_draw AS md, market_prob_away AS ma, home_goals AS g1, away_goals AS g2,
                model_version AS v, commence_time AS t, league AS l
           , match_key AS mk, rowid AS rid, predicted_at AS pub_en, home_name AS n1, away_name AS n2
           FROM fb_prediction_log WHERE resolved_at IS NOT NULL AND home_goals IS NOT NULL AND ${PREPARTIDO}`,
      ).map((r) => {
        // Renormalizado: el log guarda cinco decimales y las tres pueden sumar 0,99999.
        const s = (r.h as number) + (r.d as number) + (r.a as number);
        const ms = r.mh != null && r.md != null && r.ma != null ? (r.mh as number) + (r.md as number) + (r.ma as number) : null;
        const s0 = (r.mh0 as number) + (r.md0 as number) + (r.ma0 as number);
        return {
          fila: r,
          bruto: [r.h as number, r.d as number, r.a as number],
          p: [(r.h as number) / s, (r.d as number) / s, (r.a as number) / s],
          pModelo: s0 > 0 ? [(r.mh0 as number) / s0, (r.md0 as number) / s0, (r.ma0 as number) / s0] : undefined,
          y: (r.g1 as number) > (r.g2 as number) ? 0 : r.g1 === r.g2 ? 1 : 2,
          mercado: ms ? [(r.mh as number) / ms, (r.md as number) / ms, (r.ma as number) / ms] : null,
          version: (r.v as string | null) ?? null,
          cuando: (r.t as string | null) ?? null,
          liga: (r.l as string | null) ?? null,
        };
      });
    case 'basketball':
      return conFinal(deporte, 
        `SELECT prob_home AS p, prob_home AS pm, market_prob_home AS m, CASE WHEN home_pts > away_pts THEN 0 ELSE 1 END AS y, model_version AS v, commence_time AS t, league AS l
           , game_key AS mk, rowid AS rid, predicted_at AS pub_en, home_name AS n1, away_name AS n2
           FROM bb_prediction_log WHERE home_pts IS NOT NULL AND home_pts <> away_pts AND ${PREPARTIDO}`,
      ).map(dos);
    case 'baseball':
      return conFinal(deporte, 
        `SELECT prob_home AS p, prob_home AS pm, market_prob_home AS m, CASE WHEN home_runs > away_runs THEN 0 ELSE 1 END AS y, model_version AS v, commence_time AS t, league AS l
           , match_key AS mk, rowid AS rid, predicted_at AS pub_en, home_name AS n1, away_name AS n2
           FROM bsb_prediction_log WHERE home_runs IS NOT NULL AND home_runs <> away_runs AND ${PREPARTIDO}`,
      ).map(dos);
    case 'nfl':
      // Los empates se excluyen: el moneyline se devuelve y no hay resultado que puntuar.
      return conFinal(deporte, 
        `SELECT COALESCE(shown_home, prob_home) AS p, prob_home AS pm, market_prob_home AS m, CASE WHEN home_points > away_points THEN 0 ELSE 1 END AS y,
                model_version AS v, commence_time AS t, league AS l
           , match_key AS mk, rowid AS rid, predicted_at AS pub_en, home_name AS n1, away_name AS n2
           FROM naf_prediction_log WHERE home_points IS NOT NULL AND home_points <> away_points AND ${PREPARTIDO}`,
      ).map(dos);
    case 'nhl':
      // El moneyline incluye prórroga y tanda: siempre hay ganador.
      return conFinal(deporte, 
        `SELECT COALESCE(shown_home, prob_home) AS p, prob_home AS pm, market_prob_home AS m, CASE WHEN home_goals > away_goals THEN 0 ELSE 1 END AS y,
                model_version AS v, commence_time AS t, league AS l
           , match_key AS mk, rowid AS rid, predicted_at AS pub_en, home_name AS n1, away_name AS n2
           FROM nhl_prediction_log WHERE home_goals IS NOT NULL AND home_goals <> away_goals AND ${PREPARTIDO}`,
      ).map(dos);
    case 'ufc':
      // Solo las peleas con ganador: el empate y el «sin resultado» no se puntúan (A es home_*).
      return conFinal(deporte, 
        `SELECT COALESCE(shown_home, prob_home) AS p, prob_home AS pm, market_prob_home AS m, CASE WHEN outcome = 'A' THEN 0 ELSE 1 END AS y,
                model_version AS v, commence_time AS t, league AS l
           , match_key AS mk, rowid AS rid, predicted_at AS pub_en, home_name AS n1, away_name AS n2
           FROM ufc_prediction_log WHERE outcome IN ('A', 'B') AND ${PREPARTIDO}`,
      ).map(dos);
  }
}

/**
 * Las filas pre-partido y resueltas de un registro, cada una con su final congelada al lado
 * (evaluation/evaluada.ts). La consulta del deporte va dentro, tal cual, con su clave como `mk`.
 */
function conFinal(deporte: SportId, sql: string): Fila[] {
  const pf = joinFinal(deporte, 'q.', 'mk');
  return leer(`SELECT q.*, ${pf.columnas} FROM (${sql}) q ${pf.join} ORDER BY q.rid`);
}

/**
 * Las predicciones EN VIVO que se evalúan: para cada partido resuelto, la predicción evaluada según
 * la política de evaluation/evaluada.ts (la final congelada antes del inicio; sin ella, la
 * publicación original marcada «legado»; una final ilegible no entra). `pPublicada` y `pModelo`
 * siguen siendo los de la PUBLICACIÓN: la deriva (trust/drift.ts) mide lo publicado contra el
 * backtest, y su aviso recorta importes que se apuestan al publicar.
 */
export function predicciones(deporte: SportId): PrediccionEnVivo[] {
  return prediccionesConRecuento(deporte).xs;
}

/**
 * Las PUBLICACIONES pre-partido y resueltas, tal como se publicaron: sin pasar por la política de
 * evaluación. La deriva (trust/drift.ts) sale de aquí, para que qué se puntúa no cambie cuánto se
 * apuesta (revisión quant de B1, M1).
 */
export function publicacionesResueltas(deporte: SportId): PrediccionEnVivo[] {
  return publicaciones(deporte).map(({ fila, bruto: _bruto, ...resto }) => {
    void _bruto;
    return { ...resto, matchKey: String(fila.mk) };
  });
}

/** Cuántas se evaluaron con la final, cuántas con la publicación (legado) y cuántas quedaron fuera. */
export interface RecuentoEvaluacion {
  final: number;
  legado: number;
  excluidas: number;
}

/** Un partido resuelto que no se evalúa, con su motivo (evaluation/evaluada.ts) y cuándo se jugaba. */
export interface ExcluidaEnVivo {
  motivo: MotivoSinEvaluar;
  cuando: string | null;
  liga: string | null;
  matchKey: string;
}

/**
 * Las predicciones evaluadas y, aparte, cada partido excluido con su motivo (fase E: el informe por
 * periodo cuenta las exclusiones por motivo y por periodo). Misma política que `prediccionesConRecuento`.
 */
export function prediccionesConMotivos(deporte: SportId): { xs: PrediccionEnVivo[]; excluidas: ExcluidaEnVivo[] } {
  const xs: PrediccionEnVivo[] = [];
  const excluidas: ExcluidaEnVivo[] = [];
  for (const pub of publicaciones(deporte)) {
    const fila = pub.fila;
    // Revisión quant de E: lo publicado TAL CUAL, para que una publicación que no suma 1 se excluya
    // (como en la exportación de predicciones) en vez de puntuarse renormalizada.
    const ev = resolverEvaluada({ probs: pub.bruto ?? pub.p, mercado: pub.mercado ?? null, version: pub.version, en: String(fila.pub_en) }, finalDeFila(fila), pub.p.length, {
      nombres: [String(fila.n1), String(fila.n2)],
      ordenLibre: ORDEN_LIBRE.has(deporte),
    });
    if (!ev.ok) {
      excluidas.push({ motivo: ev.motivo, cuando: pub.cuando ?? null, liga: pub.liga ?? null, matchKey: String(fila.mk) });
      continue;
    }
    const { fila: _fila, bruto: _bruto, ...resto } = pub;
    void _fila;
    void _bruto;
    xs.push({ ...resto, pPublicada: pub.p, p: ev.evaluada.probs, mercado: ev.evaluada.mercado, version: ev.evaluada.version, matchKey: String(fila.mk), evaluacion: ev.evaluada.tipo });
  }
  return { xs, excluidas };
}

/** Las predicciones evaluadas y el recuento por tipo (revisión quant de B1, hallazgo 5). */
export function prediccionesConRecuento(deporte: SportId): { xs: PrediccionEnVivo[]; recuento: RecuentoEvaluacion } {
  const { xs, excluidas } = prediccionesConMotivos(deporte);
  const recuento: RecuentoEvaluacion = { final: 0, legado: 0, excluidas: excluidas.length };
  for (const x of xs) if (x.evaluacion) recuento[x.evaluacion]++;
  return { xs, recuento };
}

/** Las métricas de UNA versión del modelo, sobre sus propias predicciones. */
export interface PorVersion {
  /** null: predicciones anteriores al versionado, que no tienen versión y no se les inventa. */
  version: string | null;
  n: number;
  logLoss: number | null;
  brier: number | null;
  mercado: { n: number; logLoss: number; modeloLogLoss: number } | null;
}

/**
 * Parte las predicciones por la versión que las hizo, en el orden en que apareció cada una.
 * El total del deporte las junta todas; esto dice si la versión nueva lo hace mejor o peor
 * que la anterior, cosa que la cifra conjunta esconde en cuanto el modelo cambia.
 */
export function porVersion(deporte: string, xs: PrediccionEnVivo[]): PorVersion[] {
  const grupos = new Map<string | null, PrediccionEnVivo[]>();
  for (const x of xs) {
    const g = grupos.get(x.version);
    if (g) g.push(x);
    else grupos.set(x.version, [x]);
  }
  return [...grupos].map(([version, g]) => {
    const r = evaluate('live', deporte, g);
    return {
      version,
      n: r.n,
      logLoss: r.logLoss,
      brier: r.brier,
      mercado: r.mercado ? { n: r.mercado.n, logLoss: r.mercado.logLoss, modeloLogLoss: r.mercado.modeloLogLoss } : null,
    };
  });
}

export function evaluacionEnVivo(): (Informe & { error?: string; porVersion: PorVersion[]; aviso: AvisoMuestra; evaluacion: RecuentoEvaluacion & { politica: typeof POLITICA_EVALUACION } })[] {
  return SPORT_IDS.map((d) => {
    try {
      const { xs, recuento } = prediccionesConRecuento(d);
      return { ...evaluate('live', d, xs), porVersion: porVersion(d, xs), aviso: avisoMuestra(xs.length, 'predicciones'), evaluacion: { politica: POLITICA_EVALUACION, ...recuento } };
    } catch (e) {
      // Una fila mal formada no puede tumbar la evaluación de los otros cuatro, pero
      // tampoco se esconde: el deporte sale sin cifras y con el motivo.
      return { ...evaluate('live', d, []), porVersion: [], aviso: avisoMuestra(0, 'predicciones'), error: (e as Error).message, evaluacion: { politica: POLITICA_EVALUACION, final: 0, legado: 0, excluidas: 0 } };
    }
  });
}
