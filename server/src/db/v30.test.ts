// Migración v30 (revisión del PR 17, E3/E5): notas en las estimaciones guardadas y la instantánea a
// la que se enlaza una apuesta. Solo columnas nuevas: lo de antes queda NULL (sin nota, sin enlazar),
// nada se reescribe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb, MIGRACIONES } = await import('../db.ts');
const { migrar } = await import('./migrations.ts');

test('v30: un libro mayor en v29 recibe bets.snapshot_id y la nota de las guardadas, con lo de antes en NULL', () => {
  const db = getDb();
  db.prepare("INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status) VALUES ('2026-10-01T00:00:00Z', '2026-10-01', 'nhl', 'A vs B', 'moneyline', 'A', 2, 10, 'won')").run();
  db.exec('ALTER TABLE ledger.bets DROP COLUMN snapshot_id');
  db.exec('ALTER TABLE ledger.saved_predictions DROP COLUMN note');
  db.exec('ALTER TABLE ledger.saved_predictions DROP COLUMN note_updated_at');
  db.exec('DELETE FROM ledger.schema_version WHERE version = 30');
  const cols = (t: string) => (db.prepare(`PRAGMA ledger.table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols('bets').includes('snapshot_id'));
  const aplicadas = migrar(db, 'ledger', 'ledger', MIGRACIONES, { ledger: 'ledger', fichero: 'ledger' });
  assert.deepEqual(aplicadas, [30]);
  assert.ok(cols('bets').includes('snapshot_id'));
  assert.ok(cols('saved_predictions').includes('note') && cols('saved_predictions').includes('note_updated_at'));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM bets WHERE snapshot_id IS NULL').get() as { n: number }).n, 1, 'la apuesta de antes queda sin enlazar, no enlazada a una inventada');
});

test('v30: volver a aplicarla con las columnas ya puestas no cambia nada ni falla, y los triggers siguen', () => {
  const db = getDb();
  const triggers = () => (db.prepare("SELECT COUNT(*) AS n FROM ledger.sqlite_master WHERE type = 'trigger'").get() as { n: number }).n;
  const antes = triggers();
  db.exec('DELETE FROM ledger.schema_version WHERE version = 30');
  assert.deepEqual(migrar(db, 'ledger', 'ledger', MIGRACIONES, { ledger: 'ledger', fichero: 'ledger' }), [30]);
  assert.deepEqual(migrar(db, 'ledger', 'ledger', MIGRACIONES, { ledger: 'ledger', fichero: 'ledger' }), [], 'ya aplicada: nada');
  assert.equal(triggers(), antes);
});
