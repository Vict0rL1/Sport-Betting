// Bullpen: del boxscore salen los relevistas (no el abridor), la carga se agrega por equipo y
// la ficha dice DESCONOCIDO sin datos recientes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../test/setup.ts';

const { relevistasDeBoxscore, agregarCarga, ingestBullpen, cargaBullpen, codigoRetrosheet } = await import('./bullpen.ts');

function boxscore(homeAbbr: string, awayAbbr: string, homePitchers: [number, string, number][], awayPitchers: [number, string, number][]) {
  const lado = (abbr: string, ps: [number, string, number][]) => ({
    team: { abbreviation: abbr },
    pitchers: ps.map((p) => p[0]),
    players: Object.fromEntries(ps.map(([id, name, n]) => [`ID${id}`, { person: { id, fullName: name }, stats: { pitching: { numberOfPitches: n } } }])),
  });
  return { teams: { home: lado(homeAbbr, homePitchers), away: lado(awayAbbr, awayPitchers) } };
}

test('relevistasDeBoxscore: todos menos el primero de cada lado, con el código Retrosheet', () => {
  const r = relevistasDeBoxscore(boxscore('NYY', 'BOS', [[1, 'Abridor NY', 95], [2, 'Relevo A', 18], [3, 'Cerrador', 12]], [[4, 'Abridor BOS', 101], [5, 'Relevo B', 30]]), '20260710');
  assert.deepEqual(r.map((x) => [x.teamId, x.nombre, x.lanzamientos]), [['NYA', 'Relevo A', 18], ['NYA', 'Cerrador', 12], ['BOS', 'Relevo B', 30]]);
  assert.throws(() => relevistasDeBoxscore({ teams: { home: {} } }, '20260710'), /abbreviation/);
  assert.equal(codigoRetrosheet('CWS'), 'CHA');
  assert.equal(codigoRetrosheet('BOS'), 'BOS');
});

test('agregarCarga: suma por relevista, «1d» es solo ayer', () => {
  const c = agregarCarga(
    [
      { teamId: 'NYA', pitcherId: '2', nombre: 'Relevo A', fecha: '20260709', lanzamientos: 18 },
      { teamId: 'NYA', pitcherId: '2', nombre: 'Relevo A', fecha: '20260708', lanzamientos: 22 },
      { teamId: 'NYA', pitcherId: '2', nombre: 'Relevo A', fecha: '20260707', lanzamientos: 10 },
      { teamId: 'NYA', pitcherId: '3', nombre: 'Cerrador', fecha: '20260709', lanzamientos: 12 },
    ],
    '20260710',
  );
  assert.deepEqual(c, [
    { teamId: 'NYA', pitcherId: '2', nombre: 'Relevo A', apariciones3d: 3, lanzamientos1d: 18, lanzamientos3d: 50 },
    { teamId: 'NYA', pitcherId: '3', nombre: 'Cerrador', apariciones3d: 1, lanzamientos1d: 12, lanzamientos3d: 12 },
  ]);
});

test('ingestBullpen con la API simulada: calendario + boxscores → filas, y la ficha marca a los cansados', async () => {
  const ahora = new Date('2026-07-10T12:00:00Z');
  const urls: string[] = [];
  const f = async (url: string | URL | Request) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/schedule')) {
      assert.match(u, /startDate=2026-07-07&endDate=2026-07-09/);
      return new Response(JSON.stringify({ dates: [
        { games: [{ gamePk: 1, officialDate: '2026-07-08', status: { abstractGameState: 'Final' } }] },
        { games: [{ gamePk: 2, officialDate: '2026-07-09', status: { abstractGameState: 'Final' } }, { gamePk: 3, officialDate: '2026-07-09', status: { abstractGameState: 'Live' } }] },
      ] }), { status: 200 });
    }
    if (u.endsWith('/game/1/boxscore')) return new Response(JSON.stringify(boxscore('NYY', 'BOS', [[1, 'Abridor', 90], [2, 'Relevo A', 22], [3, 'Cerrador', 15]], [[4, 'Abridor', 88], [5, 'Relevo B', 9]])), { status: 200 });
    if (u.endsWith('/game/2/boxscore')) return new Response(JSON.stringify(boxscore('BOS', 'NYY', [[4, 'Abridor', 70], [5, 'Relevo B', 31]], [[6, 'Otro abridor', 80], [2, 'Relevo A', 28], [3, 'Cerrador', 14]])), { status: 200 });
    return new Response('?', { status: 404 });
  };
  const r = await ingestBullpen({ ahora, fetch: f });
  assert.deepEqual(r, { partidos: 2, equipos: 2, relevistas: 3, asOf: '20260710' });
  assert.equal(urls.filter((u) => u.includes('/boxscore')).length, 2, 'el partido en juego no se pide');
  const ny = cargaBullpen('mlb', 'NYA', ahora);
  assert.equal(ny.estado, 'conocido');
  assert.equal(ny.relevistasUsados3d, 2);
  assert.equal(ny.lanzamientos3d, 22 + 15 + 28 + 14);
  assert.equal(ny.lanzamientos1d, 28 + 14);
  assert.deepEqual(ny.cansados.map((c) => c.nombre), ['Relevo A'], '50 lanzamientos en 3 días y 28 ayer');
  const bos = cargaBullpen('mlb', 'BOS', ahora);
  assert.deepEqual(bos.cansados.map((c) => c.nombre), ['Relevo B'], '31 ayer supera los 25');
  // Sin datos recientes: DESCONOCIDO, no cero.
  assert.equal(cargaBullpen('mlb', 'NYA', new Date('2026-07-20T12:00:00Z')).estado, 'DESCONOCIDO');
  assert.equal(cargaBullpen('mlb', 'SEA', ahora).estado, 'DESCONOCIDO');
  await assert.rejects(ingestBullpen({ ahora, fetch: async () => new Response('x', { status: 503 }) }), /HTTP 503/);
});
