// Migración v29 (rediseño de noviembre): un libro mayor que ya existía (en v28, con `bets` sin
// `currency`) tiene que salir con la columna y con `saved_predictions`. Las bases nuevas la tienen
// por la migración 1; las de verdad no (revisión data-guardian).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb, MIGRACIONES } = await import('../db.ts');
const { migrar } = await import('./migrations.ts');

test('v29: un libro mayor en v28 sin bets.currency la recibe, con las apuestas de antes en NULL', () => {
  const db = getDb();
  db.prepare("INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status) VALUES ('2026-10-01T00:00:00Z', '2026-10-01', 'nhl', 'A vs B', 'moneyline', 'A', 2, 10, 'won')").run();
  // Así estaba una instalación real antes de esta versión.
  db.exec('ALTER TABLE ledger.bets DROP COLUMN currency');
  db.exec('DROP TABLE ledger.saved_predictions');
  db.exec('DELETE FROM ledger.schema_version WHERE version = 29');
  const cols = () => (db.prepare('PRAGMA ledger.table_info(bets)').all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols().includes('currency'));
  const aplicadas = migrar(db, 'ledger', 'ledger', MIGRACIONES, { ledger: 'ledger', fichero: 'ledger' });
  assert.deepEqual(aplicadas, [29]);
  assert.ok(cols().includes('currency'), 'la columna llega a las bases que ya existían');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM bets WHERE currency IS NULL').get() as { n: number }).n, 1, 'las de antes, sin moneda inventada');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ledger.sqlite_master WHERE name = 'saved_predictions'").get() as { n: number }).n, 1);
});
