// ClubElo: el CSV se lee por cabecera, los clubes se emparejan solo cuando es único, el Elo
// vigente se busca por fecha y una fuente caída no inventa nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../test/setup.ts';

const { parseClubElo, guardarClubElo, ingestClubElo, eloExternoEn, hayEloExterno, probsClubElo, fechasMuestreadas } = await import('./clubelo.ts');
const { getDb } = await import('../../db.ts');

const CSV = `Rank,Club,Country,Level,Elo,From,To
1,Man City,ENG,1,2044.5,2026-08-01,2026-08-07
2,Liverpool,ENG,1,1990.1,2026-08-01,2026-08-07
None,Sunderland,ENG,2,1601.0,2026-08-01,2026-08-07
7,Real Madrid,ESP,1,1960.3,2026-08-01,2026-08-07
40,Club Sin Liga Aqui,TUR,1,1700,2026-08-01,2026-08-07
`;

test('parseClubElo: filas por cabecera, fechas a YYYYMMDD, rank «None» → null', () => {
  const f = parseClubElo(CSV);
  assert.equal(f.length, 5);
  assert.deepEqual(f[0], { rank: 1, club: 'Man City', country: 'ENG', level: 1, elo: 2044.5, from: '20260801', to: '20260807' });
  assert.equal(f[2].rank, null);
  assert.throws(() => parseClubElo('a,b,c\n1,2,3'), /cabecera inesperada/);
  assert.deepEqual(parseClubElo(''), []);
});

test('guardarClubElo empareja con nuestros equipos cuando el nombre es único; eloExternoEn busca por fecha', () => {
  const db = getDb();
  db.exec("INSERT OR IGNORE INTO fb_teams (id, league, name) VALUES ('manchester-city', 'epl', 'Manchester City FC'), ('manchester-united', 'epl', 'Manchester United FC'), ('liverpool', 'epl', 'Liverpool FC'), ('real-madrid', 'laliga', 'Real Madrid CF')");
  const g = guardarClubElo(parseClubElo(CSV));
  assert.equal(g.nuevas, 5);
  assert.equal(g.emparejadas, 3, 'Man City, Liverpool y Real Madrid; Sunderland no está en nuestra Championship de prueba y Turquía no tiene liga aquí');
  assert.equal(guardarClubElo(parseClubElo(CSV)).nuevas, 0, 'idempotente');
  assert.equal(eloExternoEn('epl', 'liverpool', '20260803'), 1990.1);
  assert.equal(eloExternoEn('epl', 'liverpool', '20260901'), null, 'fuera de la vigencia');
  assert.equal(eloExternoEn('epl', 'manchester-united', '20260803'), null);
  assert.ok(hayEloExterno('epl') && hayEloExterno('laliga') && !hayEloExterno('seriea'));
});

test('ingestClubElo: muestreo de fechas, una fecha caída no para las demás, todas caídas → error', async () => {
  assert.deepEqual(fechasMuestreadas('2026-08-01', '2026-08-20', 7), ['2026-08-01', '2026-08-08', '2026-08-15']);
  const pedidas: string[] = [];
  const r = await ingestClubElo({
    desde: '2026-08-01',
    hasta: '2026-08-15',
    cadaDias: 7,
    fetch: async (url) => {
      pedidas.push(String(url));
      if (String(url).endsWith('2026-08-08')) return new Response('nope', { status: 503 });
      return new Response(CSV.replace(/2026-08-01,2026-08-07/g, `${String(url).slice(-10)},${String(url).slice(-10)}`), { status: 200 });
    },
  });
  assert.deepEqual(pedidas, ['http://api.clubelo.com/2026-08-01', 'http://api.clubelo.com/2026-08-08', 'http://api.clubelo.com/2026-08-15']);
  assert.equal(r.fechas, 3);
  assert.equal(r.fallidas.length, 1);
  assert.match(r.fallidas[0], /2026-08-08: HTTP 503/);
  await assert.rejects(ingestClubElo({ desde: '2026-08-01', hasta: '2026-08-02', cadaDias: 1, fetch: async () => { throw new Error('sin red'); } }), /ninguna de las 2 fechas/);
});

test('probsClubElo: suma 1, el empate acotado, el local favorecido con la ventaja de campo', () => {
  const p = probsClubElo(1800, 1800, 60, 0.26);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(p[1], 0.26);
  assert.ok(p[0] > p[2]);
  assert.equal(probsClubElo(1800, 1800, 0, 0.9)[1], 0.5, 'tasa absurda, acotada');
});
