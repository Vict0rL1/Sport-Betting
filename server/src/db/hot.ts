// Las consultas que más veces se ejecutan, con sus planes. `npm run db:explain` las imprime;
// hot.test.ts exige que ninguna recorra su tabla entera.

import type { DatabaseSync } from 'node:sqlite';

export interface ConsultaCaliente {
  nombre: string;
  sql: string;
  /** Las tablas (o alias) que tienen que resolverse por índice. */
  tablasConIndice: string[];
}

export const CONSULTAS_CALIENTES: ConsultaCaliente[] = [
  {
    nombre: 'próximos de hoy con su predicción (today.ts, picks/top.ts)',
    sql: `SELECT u.id, l.prob_home FROM fb_upcoming u LEFT JOIN fb_prediction_log l ON l.upcoming_id = u.id
          WHERE u.commence_time >= '2026-10-07T00:00:00Z' AND u.commence_time < '2026-10-08T00:00:00Z'`,
    tablasConIndice: ['u', 'l'],
  },
  {
    nombre: 'última evaluación de confianza de un partido (trust/assess.ts, paper/bankroll.ts)',
    sql: `SELECT id, decision FROM prediction_assessments WHERE sport = 'nfl' AND match_key = 'k' ORDER BY id DESC LIMIT 1`,
    tablasConIndice: ['prediction_assessments'],
  },
  {
    nombre: 'último precio de una selección (odds/lines.ts)',
    sql: `SELECT odds_decimal, observed_at FROM odds_snapshots WHERE event_id = 'e' AND market = 'h2h' AND selection = 's' ORDER BY observed_at DESC LIMIT 1`,
    tablasConIndice: ['odds_snapshots'],
  },
  {
    nombre: 'predicciones pendientes de resolver (trackRecord)',
    sql: `SELECT match_key, league, home_id, away_id, commence_time FROM fb_prediction_log WHERE resolved_at IS NULL`,
    tablasConIndice: ['fb_prediction_log'],
  },
  {
    nombre: 'apuestas abiertas del banco (paper/bankroll.ts)',
    sql: `SELECT id, stake FROM paper_bets WHERE status = 'pending' ORDER BY placed_at`,
    tablasConIndice: ['paper_bets'],
  },
];

export function planDe(db: DatabaseSync, sql: string): { detail: string }[] {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as unknown as { detail: string }[];
}
