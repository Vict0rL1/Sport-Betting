// La evaluación EN VIVO: lo que el modelo dijo antes de cada partido real, contra lo que
// pasó. Solo lee los registros de predicciones (escritos antes del partido, inmutables):
// ningún número de backtest entra aquí, y por eso cada informe lleva `origen: 'live'`.
//
// Se evalúa la probabilidad ENSEÑADA (la calibrada, donde hay capa de calibración), que es
// la que la persona vio y la que usa el banco de papel. Juzgar la cruda sería juzgar un
// número que no se enseñó — el fallo que tuvo «¿Acertó?».

import { getDb } from '../db.ts';
import { evaluate, type Informe, type Prediccion } from './metrics.ts';

type Fila = Record<string, number | null>;

function leer(sql: string): Fila[] {
  try {
    return getDb().prepare(sql).all() as Fila[];
  } catch {
    // Un deporte sin tabla todavía no puede tumbar la evaluación de los otros cuatro.
    return [];
  }
}

const dos = (p: number, m: number | null, y: number): Prediccion => ({
  p: [p, 1 - p],
  y,
  mercado: m == null ? null : [m, 1 - m],
});

export function predicciones(deporte: 'tennis' | 'football' | 'basketball' | 'baseball' | 'nfl'): Prediccion[] {
  switch (deporte) {
    case 'tennis':
      return leer(
        `SELECT prob1 AS p, market_prob1 AS m, CASE WHEN winner_id = p1_id THEN 0 ELSE 1 END AS y
           FROM prediction_log WHERE resolved_at IS NOT NULL AND winner_id IS NOT NULL`,
      ).map((r) => dos(r.p as number, r.m, r.y as number));
    case 'football':
      return leer(
        `SELECT COALESCE(shown_home, prob_home) AS h, COALESCE(shown_draw, prob_draw) AS d, COALESCE(shown_away, prob_away) AS a,
                market_prob_home AS mh, market_prob_draw AS md, market_prob_away AS ma, home_goals AS g1, away_goals AS g2
           FROM fb_prediction_log WHERE resolved_at IS NOT NULL AND home_goals IS NOT NULL`,
      ).map((r) => {
        // Renormalizado: el log guarda cinco decimales y las tres pueden sumar 0,99999.
        const s = (r.h as number) + (r.d as number) + (r.a as number);
        const ms = r.mh != null && r.md != null && r.ma != null ? (r.mh as number) + (r.md as number) + (r.ma as number) : null;
        return {
          p: [(r.h as number) / s, (r.d as number) / s, (r.a as number) / s],
          y: (r.g1 as number) > (r.g2 as number) ? 0 : r.g1 === r.g2 ? 1 : 2,
          mercado: ms ? [(r.mh as number) / ms, (r.md as number) / ms, (r.ma as number) / ms] : null,
        };
      });
    case 'basketball':
      return leer(
        `SELECT prob_home AS p, market_prob_home AS m, CASE WHEN home_pts > away_pts THEN 0 ELSE 1 END AS y
           FROM bb_prediction_log WHERE home_pts IS NOT NULL AND home_pts <> away_pts`,
      ).map((r) => dos(r.p as number, r.m, r.y as number));
    case 'baseball':
      return leer(
        `SELECT prob_home AS p, market_prob_home AS m, CASE WHEN home_runs > away_runs THEN 0 ELSE 1 END AS y
           FROM bsb_prediction_log WHERE home_runs IS NOT NULL AND home_runs <> away_runs`,
      ).map((r) => dos(r.p as number, r.m, r.y as number));
    case 'nfl':
      // Los empates se excluyen: el moneyline se devuelve y no hay resultado que puntuar.
      return leer(
        `SELECT COALESCE(shown_home, prob_home) AS p, market_prob_home AS m, CASE WHEN home_points > away_points THEN 0 ELSE 1 END AS y
           FROM naf_prediction_log WHERE home_points IS NOT NULL AND home_points <> away_points`,
      ).map((r) => dos(r.p as number, r.m, r.y as number));
  }
}

export function evaluacionEnVivo(): (Informe & { error?: string })[] {
  return (['tennis', 'football', 'basketball', 'baseball', 'nfl'] as const).map((d) => {
    try {
      return evaluate('live', d, predicciones(d));
    } catch (e) {
      // Una fila mal formada no puede tumbar la evaluación de los otros cuatro, pero
      // tampoco se esconde: el deporte sale sin cifras y con el motivo.
      return { ...evaluate('live', d, []), error: (e as Error).message };
    }
  });
}
