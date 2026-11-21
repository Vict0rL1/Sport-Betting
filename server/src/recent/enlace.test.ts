// F1 (revisión del PR 17): cada fila «en vivo» de «¿Acertó?» lleva el deporte y la clave del registro,
// para abrir su ficha (resultado, predicción evaluada e historial). Las reconstruidas no tienen
// registro: no llevan clave y no se inventa una.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { historialReciente } = await import('../today.ts');

const AHORA = new Date('2026-11-21T12:00:00Z');
const db = getDb();
db.prepare(
  `INSERT INTO fb_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, predicted_at, home_goals, away_goals, resolved_at)
   VALUES ('esp|enl-l|enl-v|20261120', 'esp', '2026-11-20T19:00:00Z', 'enl-l', 'enl-v', 'Local Enlace', 'Visitante Enlace', 0.5, 0.3, 0.2, '2026-11-20T10:00:00Z', 2, 1, '2026-11-20T21:00:00Z')`,
).run();
db.prepare(
  `INSERT INTO prediction_log (match_key, tour, commence_time, p1_id, p2_id, p1_name, p2_name, prob1, predicted_at, winner_id, resolved_at)
   VALUES ('atp|9001|9002|20261120', 'atp', '2026-11-20T15:00:00Z', 9001, 9002, 'Jugadora Uno', 'Jugadora Dos', 0.64, '2026-11-20T09:00:00Z', 9002, '2026-11-20T17:00:00Z')`,
).run();

test('F1: las filas en vivo llevan deporte y clave del registro', () => {
  const h = historialReciente(AHORA, 7, 'UTC');
  const fut = h.resultados.find((r) => r.casa === 'Local Enlace');
  assert.ok(fut, 'fila de fútbol');
  assert.equal(fut.origen, 'en vivo');
  assert.equal(fut.sport, 'football');
  assert.equal(fut.matchKey, 'esp|enl-l|enl-v|20261120');
  const ten = h.resultados.find((r) => r.casa === 'Jugadora Uno');
  assert.ok(ten, 'fila de tenis');
  assert.equal(ten.sport, 'tennis');
  assert.equal(ten.matchKey, 'atp|9001|9002|20261120');
  for (const r of h.resultados.filter((x) => x.origen === 'reconstruida')) assert.equal(r.matchKey, null, 'una reconstruida no tiene clave');
});
