// Guardar una estimación concreta (rediseño de noviembre, FAV-3): una referencia de la persona a una
// instantánea que ya existe. Quitar la referencia no toca la instantánea.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { guardarInstantanea, listarGuardadas, quitarGuardada } = await import('./guardadas.ts');

const db = getDb();
const INICIO = '2026-12-01T20:00:00.000Z';
const snapId = Number(
  db
    .prepare(
      `INSERT INTO prediction_snapshots (sport, match_key, event_id, commence_time, captured_at, outcomes, probs, inputs, model_version)
       VALUES ('nhl', 'nhl|g|1', 'nhl-g-1', ?, '2026-12-01T08:00:00.000Z', '["Boston","Toronto"]', '[0.6,0.4]', '{"usaMercado":false,"entradas":{}}', 'nhl-v1')`,
    )
    .run(INICIO).lastInsertRowid,
);

test('se guarda una instantánea que existe, con su etiqueta del servidor; guardar dos veces no duplica', () => {
  const g = guardarInstantanea({ sport: 'nhl', matchKey: 'nhl|g|1', snapshotId: snapId });
  assert.equal(g.snapshot_id, snapId);
  assert.match(g.label, /Boston 60/);
  guardarInstantanea({ sport: 'nhl', matchKey: 'nhl|g|1', snapshotId: snapId });
  const l = listarGuardadas();
  assert.equal(l.length, 1);
  assert.deepEqual(l[0].probs, [0.6, 0.4]);
  assert.equal(l[0].captured_at, '2026-12-01T08:00:00.000Z');
});

test('una instantánea que no existe, o de otro partido, no se guarda', () => {
  assert.throws(() => guardarInstantanea({ sport: 'nhl', matchKey: 'nhl|g|1', snapshotId: 999_999 }), /no existe/);
  assert.throws(() => guardarInstantanea({ sport: 'nhl', matchKey: 'otro', snapshotId: snapId }), /no existe/);
  assert.throws(() => guardarInstantanea({ sport: 'inventado' as never, matchKey: 'nhl|g|1', snapshotId: snapId }), /deporte/);
});

test('quitar la referencia no toca la instantánea', () => {
  const id = listarGuardadas()[0].id;
  assert.equal(quitarGuardada(id), true);
  assert.equal(listarGuardadas().length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prediction_snapshots WHERE id = ?').get(snapId)!.n, 1);
  assert.equal(quitarGuardada(id), false);
});
