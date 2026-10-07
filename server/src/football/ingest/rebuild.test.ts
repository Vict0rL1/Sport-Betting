// La ingesta de fútbol ya no borra la liga para volver a llenarla: sin --rebuild, lo que había
// sobrevive a una fuente caída; con --rebuild, el borrado es explícito y transaccional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../test/setup.ts';

const { getDb } = await import('../../db.ts');
const { prepararIngesta, estadoLiga, borrarLigas } = await import('./rebuild.ts');

function sembrar(liga: string, n: number): void {
  const db = getDb();
  db.exec(`INSERT OR IGNORE INTO fb_teams (id, league, name) VALUES ('a', '${liga}', 'A'), ('b', '${liga}', 'B')`);
  const ins = db.prepare("INSERT INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result) VALUES (?, 2025, ?, 'a', 'b', 1, 0, 'H')");
  for (let i = 0; i < n; i++) ins.run(liga, `202509${String(i + 1).padStart(2, '0')}`);
}

test('incremental: prepararIngesta no toca nada y devuelve lo que había', () => {
  sembrar('test_epl', 5);
  const r = prepararIngesta(['test_epl'], { rebuild: false });
  assert.equal(r.modo, 'incremental');
  assert.deepEqual(r.antes.test_epl, { partidos: 5, equipos: 2 });
  assert.deepEqual(estadoLiga('test_epl'), { partidos: 5, equipos: 2 }, 'intacto: una fuente caída no deja la liga vacía');
});

test('rebuild: borra solo las ligas pedidas, en una transacción', () => {
  sembrar('test_liga', 3);
  sembrar('test_otra', 2);
  const r = prepararIngesta(['test_liga'], { rebuild: true });
  assert.equal(r.modo, 'rebuild');
  assert.equal(r.antes.test_liga.partidos, 3);
  assert.deepEqual(estadoLiga('test_liga'), { partidos: 0, equipos: 0 });
  assert.deepEqual(estadoLiga('test_otra'), { partidos: 2, equipos: 2 }, 'la otra liga no se toca');
  assert.deepEqual(borrarLigas([]), {});
});

test('el upsert de las fuentes no duplica: el mismo partido dos veces es una fila', () => {
  const db = getDb();
  sembrar('test_dup', 1);
  db.prepare(
    `INSERT INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result)
     VALUES ('test_dup', 2025, '20250901', 'a', 'b', 2, 2, 'D')
     ON CONFLICT(league, match_date, home_id, away_id) DO UPDATE SET home_goals = excluded.home_goals, away_goals = excluded.away_goals, result = excluded.result`,
  ).run();
  assert.equal(estadoLiga('test_dup').partidos, 1);
  assert.equal((db.prepare("SELECT result FROM fb_matches WHERE league = 'test_dup'").get() as { result: string }).result, 'D', 'y el resultado se actualiza');
});
