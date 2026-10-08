// Historia del Elo: un punto por partido del equipo, en orden, de la misma reproducción.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { historiaElo, olvidarHistoriaElo } = await import('./historia.ts');
const { getDb } = await import('../db.ts');

test('historiaElo (fútbol): un punto antes de cada partido, el primero en el Elo inicial', async () => {
  const db = getDb();
  const ins = db.prepare("INSERT INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result) VALUES ('ligue1', 2026, ?, ?, ?, ?, ?, ?)");
  ins.run('20250810', 'psg', 'om', 3, 0, 'H');
  ins.run('20250817', 'om', 'psg', 1, 1, 'D');
  ins.run('20250824', 'psg', 'ol', 2, 1, 'H');
  olvidarHistoriaElo();
  const h = await historiaElo('football', 'ligue1', 'psg', new Date('2026-10-07T10:00:00Z'));
  assert.equal(h.puntos.length, 3);
  assert.deepEqual(h.puntos.map((p) => p.fecha), ['2025-08-10', '2025-08-17', '2025-08-24']);
  assert.ok(h.puntos[1].elo > h.puntos[0].elo, 'ganó el primero: sube');
  assert.deepEqual(h.puntos.map((p) => p.local), [true, false, true]);
  const nadie = await historiaElo('football', 'ligue1', 'no-existe', new Date('2026-10-07T10:00:00Z'));
  assert.deepEqual(nadie.puntos, []);
});
