// Migración v32 (seguimiento del PR #18, G): la cola de avisos aplazados gana `attempts` y `last_error`.
// Aditiva: una cola en v31 con avisos dentro los conserva, con 0 intentos; reaplicarla no cambia nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb, MIGRACIONES } = await import('../db.ts');
const { migrar } = await import('./migrations.ts');

test('v32: una cola en v31 (sin intentos) recibe las columnas sin perder lo aplazado; reaplicarla no cambia nada', () => {
  const db = getDb();
  const columnas = () => (db.prepare('PRAGMA ledger.table_info(notification_pending)').all() as { name: string }[]).map((c) => c.name);
  // Una cola de v31, con un aviso dentro.
  db.exec('DROP TABLE ledger.notification_pending');
  db.exec(`CREATE TABLE ledger.notification_pending (clave TEXT PRIMARY KEY, created_at TEXT NOT NULL, event_type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT, deliver_after TEXT NOT NULL, expires_at TEXT NOT NULL)`);
  db.prepare("INSERT INTO ledger.notification_pending VALUES ('k', '2026-11-20T23:00:00Z', 'digest_listo', 'Resumen', 'x', NULL, '2026-11-21T06:00:00Z', '2026-11-21T11:00:00Z')").run();
  db.exec('DELETE FROM ledger.schema_version WHERE version = 32');
  assert.ok(!columnas().includes('attempts'));
  assert.deepEqual(migrar(db, 'ledger', 'ledger', MIGRACIONES, { ledger: 'ledger', fichero: 'ledger' }), [32]);
  assert.ok(columnas().includes('attempts') && columnas().includes('last_error'));
  assert.deepEqual({ ...(db.prepare('SELECT clave, attempts, last_error FROM ledger.notification_pending').get() as object) }, { clave: 'k', attempts: 0, last_error: null }, 'lo aplazado sigue, con 0 intentos');
  assert.deepEqual(migrar(db, 'ledger', 'ledger', MIGRACIONES, { ledger: 'ledger', fichero: 'ledger' }), []);
});

test('v32: una instalación nueva ya nace con las columnas (el esquema las lleva)', () => {
  const cols = (getDb().prepare('PRAGMA ledger.table_info(notification_pending)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('attempts') && cols.includes('last_error'));
});
