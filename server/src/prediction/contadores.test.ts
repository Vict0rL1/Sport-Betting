// G13 (segunda pasada de ui-tester al lote G): las pastillas de liga y de torneo contaban también
// los partidos ya jugados que siguen en la tabla de próximos: «Premier League 6» sobre «No hay
// partidos próximos». La lista aplica `freshFilter()`; los contadores, no. Ahora los dos, el mismo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const ahora = Date.now();
const hace = (dias: number) => new Date(ahora - dias * 86_400_000).toISOString();
const dentroDe = (dias: number) => new Date(ahora + dias * 86_400_000).toISOString();

test('G13: los contadores de fútbol, baloncesto, béisbol y tenis no cuentan lo ya jugado', async () => {
  const db = getDb();
  for (const [tabla, extra] of [['fb_upcoming', ''], ['bb_upcoming', ''], ['bsb_upcoming', '']] as const) {
    const ins = db.prepare(`INSERT INTO ${tabla} (id, league, commence_time, home_name, away_name${extra}) VALUES (?, 'zz', ?, 'A', 'B')`);
    ins.run(`${tabla}-viejo-1`, hace(3));
    ins.run(`${tabla}-viejo-2`, hace(2));
    ins.run(`${tabla}-nuevo`, dentroDe(1));
  }
  const tenis = db.prepare("INSERT INTO upcoming_matches (id, tour, tournament_id, tournament_name, surface, commence_time, p1_name, p2_name) VALUES (?, 'atp', ?, ?, 'Hard', ?, 'A', 'B')");
  tenis.run('t-viejo', 'viejo', 'Torneo jugado', hace(3));
  tenis.run('t-nuevo', 'nuevo', 'Torneo por jugar', dentroDe(1));

  const cuenta = (xs: { league: string; count: number }[]) => xs.find((x) => x.league === 'zz')?.count ?? 0;
  assert.equal(cuenta((await import('../football/repo.ts')).getLeaguesWithUpcoming()), 1, 'fútbol');
  assert.equal(cuenta((await import('../basketball/repo.ts')).getLeaguesWithUpcoming()), 1, 'baloncesto');
  assert.equal(cuenta((await import('../baseball/repo.ts')).getLeaguesWithUpcoming()), 1, 'béisbol');
  const torneos = (await import('../repo.ts')).getUpcomingTournaments('atp');
  assert.deepEqual(torneos.map((t) => [t.tournament_id, t.count]), [['nuevo', 1]], 'tenis: el torneo ya jugado ni aparece');
});
