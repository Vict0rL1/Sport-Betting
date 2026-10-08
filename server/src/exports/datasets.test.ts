import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { exportar, aCsv, DATASETS } = await import('./datasets.ts');
const { getDb } = await import('../db.ts');

test('aCsv escapa comillas, comas y saltos de línea (RFC 4180) y termina en CRLF', () => {
  const csv = aCsv(['a', 'b'], [{ a: 'x,y', b: 'di "hola"' }, { a: null, b: 'l1\nl2' }, { a: 3, b: { k: 1 } }]);
  assert.equal(csv, 'a,b\r\n"x,y","di ""hola"""\r\n,"l1\nl2"\r\n3,"{""k"":1}"\r\n');
});

test('exportar: apuestas y snapshots con filtros de fecha y deporte; conjuntos vacíos tienen columnas', () => {
  const db = getDb();
  db.exec("INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status) VALUES ('2026-10-01T10:00:00Z', '2026-10-01', 'tennis', 'A vs B', 'moneyline', 'A', 1.9, 10, 'pending'), ('2026-10-05T10:00:00Z', '2026-10-05', 'football', 'C vs D', 'moneyline', 'C', 2.1, 5, 'won')");
  db.exec("INSERT INTO odds_snapshots (event_id, sport, league, market, selection, bookmaker, odds_decimal, observed_at) VALUES ('e1', 'football', 'soccer_epl', 'h2h', 'Casa', 'bet365', 1.9, '2026-10-02T00:00:00Z'), ('e2', 'nfl', 'americanfootball_nfl', 'h2h', 'Home', 'bet365', 1.5, '2026-10-06T00:00:00Z')");
  const todas = exportar('apuestas');
  assert.equal(todas.datos.length, 2);
  assert.ok(todas.columnas.includes('placed_on') && todas.columnas.includes('odds'));
  assert.equal(exportar('apuestas', { desde: '2026-10-02' }).datos.length, 1);
  assert.equal(exportar('apuestas', { hasta: '2026-10-02' }).datos.length, 1);
  assert.equal(exportar('apuestas', { sport: 'football' }).datos[0].event, 'C vs D');
  assert.equal(exportar('snapshots', { sport: 'nfl' }).datos.length, 1);
  assert.equal(exportar('snapshots', { desde: '2026-10-03', hasta: '2026-10-10' }).datos.length, 1);
  const papel = exportar('papel');
  assert.equal(papel.datos.length, 0);
  assert.ok(papel.columnas.includes('policy_version_id'), 'las columnas salen aunque no haya filas');
  for (const d of DATASETS) assert.ok(Array.isArray(exportar(d).columnas), d);
  // Fechas mal formadas se ignoran en vez de romper.
  assert.equal(exportar('apuestas', { desde: 'ayer' }).datos.length, 2);
});
