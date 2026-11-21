// Migración v31 (revisión del PR 17, G3): la cola de avisos aplazados por las horas de silencio
// llega a un libro mayor que ya existía, sin tocar lo demás.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb, MIGRACIONES } = await import('../db.ts');
const { migrar } = await import('./migrations.ts');

test('v31: un libro mayor en v30 sin notification_pending la recibe; reaplicarla no cambia nada', () => {
  const db = getDb();
  const existe = () => (db.prepare("SELECT COUNT(*) AS n FROM ledger.sqlite_master WHERE name = 'notification_pending'").get() as { n: number }).n;
  db.exec('DROP TABLE ledger.notification_pending');
  db.exec('DELETE FROM ledger.schema_version WHERE version = 31');
  assert.equal(existe(), 0);
  assert.deepEqual(migrar(db, 'ledger', 'ledger', MIGRACIONES, { ledger: 'ledger', fichero: 'ledger' }), [31]);
  assert.equal(existe(), 1);
  assert.deepEqual(migrar(db, 'ledger', 'ledger', MIGRACIONES, { ledger: 'ledger', fichero: 'ledger' }), []);
});
