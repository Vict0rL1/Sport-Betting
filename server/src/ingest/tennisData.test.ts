// Fuente de tenis caída: el preflight lo dice con un mensaje claro, la ingesta no toca lo que
// hay, y envuelta en conRegistro queda como error en ingestion_runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simularFetch } from '../test/setup.ts';

const { preflightTennisData, ingestTennisData } = await import('./tennisData.ts');
const { conRegistro, ultimasEjecuciones } = await import('./runs.ts');
const { getDb } = await import('../db.ts');

test('preflightTennisData con 404 → ok:false y cómo arreglarlo a mano; con red caída, igual', async () => {
  simularFetch(async () => new Response('not found', { status: 404 }));
  const r = await preflightTennisData('wta', 2099);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.motivo, /2099/);
    assert.match(r.motivo, /wta-2099\.xlsx/);
    assert.match(r.motivo, /alldata\.php/);
  }
  simularFetch(async () => {
    throw new Error('ECONNRESET');
  });
  assert.equal((await preflightTennisData('atp', 2098)).ok, false);
  // Una respuesta 200 que no es un .xlsx (página de bloqueo) tampoco vale.
  simularFetch(async () => new Response('<html>bloqueado</html>'.repeat(100), { status: 200 }));
  assert.equal((await preflightTennisData('atp', 2097)).ok, false);
  simularFetch(null);
});

test('ingestTennisData con la fuente caída no borra ni añade nada, y conRegistro lo deja en error', async () => {
  const db = getDb();
  db.exec("INSERT OR IGNORE INTO players (id, tour, name, hand, country, birthdate) VALUES (1, 'atp', 'Uno', NULL, NULL, NULL), (2, 'atp', 'Dos', NULL, NULL, NULL)");
  db.exec("INSERT INTO matches (tour, tourney_id, tourney_name, tourney_date, surface, level, round, best_of, winner_id, loser_id, score) VALUES ('atp', 't1', 'Prueba', '20260101', 'Hard', 'A', 'F', 3, 1, 2, '6-4 6-4')");
  const antes = (db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n;
  simularFetch(async () => new Response('no', { status: 404 }));
  const temporadas = await ingestTennisData('atp', { fromYear: 2096, toYear: 2097 });
  assert.deepEqual(temporadas, [], 'ninguna temporada');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM matches').get() as { n: number }).n, antes, 'intacto');
  await assert.rejects(
    conRegistro('update-data', async () => {
      const pf = await preflightTennisData('atp', 2097);
      if (!pf.ok) throw new Error(`Ninguna fuente de tenis responde. ${pf.motivo}`);
    }),
    /Ninguna fuente de tenis responde/,
  );
  const e = ultimasEjecuciones().find((x) => x.source === 'update-data')!;
  assert.equal(e.status, 'error');
  assert.match(e.error ?? '', /tennis-data\.co\.uk no sirvió/);
  simularFetch(null);
});
