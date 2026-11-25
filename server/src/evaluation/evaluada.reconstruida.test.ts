// Revisión quant de B1, hallazgo 4: un partido EN VIVO que se excluye (final ilegible) no puede
// volver a entrar por la puerta de atrás como «reconstruido» con la predicción del backtest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { historialReciente } = await import('../today.ts');
const db = getDb();

// Un archivo de la NBA con historia suficiente para reconstruir (seis equipos, dos meses).
const EQ = ['a', 'b', 'c', 'd', 'e', 'f'];
const F: Record<string, number> = { a: 12, b: 8, c: 4, d: -4, e: -8, f: -12 };
for (const id of EQ) db.prepare("INSERT INTO bb_teams (id, league, name) VALUES (?, 'nba', ?)").run(id, `Equipo ${id.toUpperCase()}`);
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const ins = db.prepare("INSERT INTO bb_games (league, season, game_date, home_id, away_id, home_pts, away_pts) VALUES ('nba', 2026, ?, ?, ?, ?, ?)");
let k = 0;
for (let d = new Date(2026, 7, 1); d <= new Date(2026, 9, 5); d.setDate(d.getDate() + 1)) {
  const r = [[0, 1, 2, 3, 4, 5], [0, 2, 1, 4, 3, 5], [0, 3, 1, 5, 2, 4], [0, 4, 1, 3, 2, 5], [0, 5, 1, 2, 3, 4]][k % 5];
  for (let i = 0; i < 6; i += 2) {
    const [h, a] = k % 2 ? [EQ[r[i]], EQ[r[i + 1]]] : [EQ[r[i + 1]], EQ[r[i]]];
    const gana = (F[h] + 3 > F[a]) !== ((k * 3 + i) % 7 === 0);
    ins.run(ymd(d), h, a, gana ? 110 : 100, gana ? 100 : 110);
  }
  k++;
}
const AHORA = new Date(2026, 9, 6, 12, 0, 0);

test('hallazgo 4: el partido en vivo con final ilegible queda fuera, y no se cuenta como reconstruido', () => {
  const g = db.prepare("SELECT id, home_id, away_id, home_pts, away_pts FROM bb_games WHERE game_date = '20261004' ORDER BY id LIMIT 1").get() as { id: number; home_id: string; away_id: string; home_pts: number; away_pts: number };
  const mismo = (h: ReturnType<typeof historialReciente>) => h.resultados.filter((r) => r.casaId === g.home_id && r.fueraId === g.away_id && r.dia === '2026-10-04');
  assert.equal(mismo(historialReciente(AHORA, 7)).length, 1, 'sin registro en vivo, el archivo lo reconstruye');
  const ko = new Date(2026, 9, 4, 20).toISOString();
  db.prepare(
    `INSERT INTO bb_prediction_log (game_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, reliability, predicted_at, home_pts, away_pts, game_id, resolved_at)
     VALUES ('vivo-1', 'nba', 'u1', ?, ?, ?, 'Vivo Casa', 'Vivo Fuera', 0.9, 'high', ?, ?, ?, ?, ?)`,
  ).run(ko, g.home_id, g.away_id, new Date(2026, 9, 4, 10).toISOString(), g.home_pts, g.away_pts, g.id, new Date(2026, 9, 5).toISOString());
  db.prepare(
    `INSERT INTO prematch_final (sport, match_key, commence_time, frozen_at, source, snapshot_id, captured_at, outcomes, probs, market_probs, model_version)
     VALUES ('basketball', 'vivo-1', ?, ?, 'prediction_log', NULL, ?, '["a","b","c"]', '[0.5,0.3,0.2]', NULL, NULL)`,
  ).run(ko, new Date(2026, 9, 4, 21).toISOString(), new Date(2026, 9, 4, 10).toISOString());
  const h = historialReciente(AHORA, 7);
  assert.equal(h.evaluacion.excluidas, 1);
  assert.deepEqual(mismo(h), [], 'ni en vivo ni reconstruido: excluido y contado como excluido');
});
