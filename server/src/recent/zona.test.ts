// G1 (revisión del PR 17): los días de «¿Acertó?» se cortan en la zona de quien mira, no en la del
// servidor. Un partido a las 23:30 UTC del 20 es del 21 en Madrid y del 20 en Nueva York.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { historialReciente } = await import('../today.ts');

const AHORA = new Date('2026-11-21T00:30:00Z');
getDb()
  .prepare(
    `INSERT INTO fb_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, predicted_at, home_goals, away_goals, resolved_at)
     VALUES ('z-1', 'esp', '2026-11-20T23:30:00Z', 'zl', 'zv', 'Local Zona', 'Visitante Zona', 0.5, 0.3, 0.2, '2026-11-20T10:00:00Z', 1, 0, '2026-11-21T00:20:00Z')`,
  )
  .run();

test('G1: con zona, el partido cae en el día de esa zona y la ventana empieza a su medianoche', () => {
  const madrid = historialReciente(AHORA, 7, 'Europe/Madrid');
  assert.equal(madrid.zona, 'Europe/Madrid');
  assert.equal(madrid.resultados.find((r) => r.casa === 'Local Zona')?.dia, '2026-11-21');
  assert.equal(madrid.porDia[0].dia, '2026-11-21', 'hoy en Madrid');
  assert.equal(madrid.porDia[0].total, 1);
  assert.equal(madrid.desde, '2026-11-14T23:00:00.000Z', 'medianoche del 15 en Madrid');
  const ny = historialReciente(AHORA, 7, 'America/New_York');
  assert.equal(ny.resultados.find((r) => r.casa === 'Local Zona')?.dia, '2026-11-20');
  assert.equal(ny.porDia[0].dia, '2026-11-20', 'aún es el 20 en Nueva York');
});

test('G1: una zona inválida no rompe: se usa la del servidor y se dice (zona null)', () => {
  const h = historialReciente(AHORA, 7, 'Marte/Olympus');
  assert.equal(h.zona, null);
  assert.equal(h.porDia.length, 7);
});
