// football-data.co.uk tiene que caer sobre los equipos que ya creó openfootball, no crear otros.
//
// Nocturno «Datos» (docs/plans/nocturno-datos.md): `ingestFootballData` daba a cada club el id
// `slugify(nombre de football-data)` («Man United» → man-united, «Brighton» → brighton) y solo se fundían
// con openfootball los clubes cuyo slug coincidía por casualidad. El resto entraba dos veces, con ids
// distintos: «equipos de una temporada que nunca se cruzan» y «clubes con dos ids». Con las CSV reales de
// 2019-20 a 2026-27, 208 de 421 nombres no casaban. Equipos, partidos y CSV sintéticos; sin red (la
// ingesta lee los ficheros manuales de raw/football/football-data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import '../../test/setup.ts';

const { getDb } = await import('../../db.ts');
const { ingestFootballData, MANUAL_DIR } = await import('./footballData.ts');

const CAB = 'Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR,AvgH,AvgD,AvgA';
const liga = (id: string) => ({ id, footballData: { kind: 'main', div: 'E0' } }) as never;
const codigo = (fin: number) => `${String((fin - 1) % 100).padStart(2, '0')}${String(fin % 100).padStart(2, '0')}`;

/** Lo que dejó openfootball: equipos con su nombre formal y partidos con marcador, sin cuotas. */
function openfootball(league: string, equipos: [id: string, name: string][], partidos: [season: number, date: string, home: string, away: string, hg: number, ag: number][]): void {
  const db = getDb();
  const eq = db.prepare('INSERT INTO fb_teams (id, league, name) VALUES (?, ?, ?)');
  for (const [id, name] of equipos) eq.run(id, league, name);
  const pa = db.prepare("INSERT INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result) VALUES (?, ?, ?, ?, ?, ?, ?, 'H')");
  for (const [s, d, h, a, hg, ag] of partidos) pa.run(league, s, d, h, a, hg, ag);
}

/** Una CSV de football-data, como fichero manual (fechas dd/mm/aaaa, cuotas medias). */
function csv(league: string, season: number, filas: [date: string, home: string, away: string, hg: number, ag: number][]): void {
  fs.mkdirSync(MANUAL_DIR, { recursive: true });
  const ddmm = (d: string) => `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
  const lineas = filas.map(([d, h, a, hg, ag]) => `E0,${ddmm(d)},${h},${a},${hg},${ag},${hg > ag ? 'H' : hg === ag ? 'D' : 'A'},2.10,3.40,3.60`);
  fs.writeFileSync(path.join(MANUAL_DIR, `${league}-${codigo(season)}.csv`), [CAB, ...lineas].join('\n') + '\n');
}

const equiposDe = (league: string) => (getDb().prepare('SELECT id, name FROM fb_teams WHERE league = ? ORDER BY id').all(league) as { id: string; name: string }[]).map((r) => `${r.id}=${r.name}`);
const partidosDe = (league: string) =>
  getDb().prepare('SELECT season, match_date d, home_id h, away_id a, odds_home o FROM fb_matches WHERE league = ? ORDER BY match_date, home_id').all(league) as { season: number; d: string; h: string; a: string; o: number | null }[];

test('los nombres de football-data caen sobre los ids de openfootball: sin equipos nuevos ni partidos dobles', async () => {
  const L = 't_fd_epl';
  openfootball(
    L,
    [['brighton-hove-albion', 'Brighton & Hove Albion FC'], ['manchester-united', 'Manchester United FC'], ['arsenal', 'Arsenal FC']],
    [
      [2026, '20250816', 'brighton-hove-albion', 'manchester-united', 2, 1],
      [2026, '20250823', 'manchester-united', 'arsenal', 0, 1],
      [2026, '20250830', 'arsenal', 'brighton-hove-albion', 3, 0],
      [2026, '20250913', 'manchester-united', 'brighton-hove-albion', 1, 1],
      [2026, '20250920', 'brighton-hove-albion', 'arsenal', 2, 2],
      [2026, '20250927', 'arsenal', 'manchester-united', 4, 2],
    ],
  );
  csv(L, 2026, [
    ['20250816', 'Brighton', 'Man United', 2, 1],
    ['20250823', 'Man United', 'Arsenal', 0, 1],
    ['20250830', 'Arsenal', 'Brighton', 3, 0],
    ['20250913', 'Man United', 'Brighton', 1, 1],
    ['20250920', 'Brighton', 'Arsenal', 2, 2],
    ['20250927', 'Arsenal', 'Man United', 4, 2],
  ]);
  const r = await ingestFootballData(liga(L), [2026]);
  assert.equal(r.matches, 6);
  assert.deepEqual(equiposDe(L), ['arsenal=Arsenal FC', 'brighton-hove-albion=Brighton & Hove Albion FC', 'manchester-united=Manchester United FC'], 'ni brighton ni man-united, y los nombres formales intactos');
  const p = partidosDe(L);
  assert.equal(p.length, 6, 'cada partido una vez');
  assert.ok(p.every((x) => x.o === 2.1), 'las cuotas van al partido de openfootball');
});

test('openfootball cambió de id entre temporadas: cada temporada cae sobre el id que usó ese año', async () => {
  const L = 't_fd_lev';
  // Doble vuelta entre cuatro clubes, dos temporadas. openfootball llama «Bayer Leverkusen» al de
  // 2019-20 y «Bayer 04 Leverkusen» al de 2020-21 (pasa así en los datos reales); football-data dice
  // «Leverkusen» en las dos.
  const fd: Record<string, string> = { 'bayern-munchen': 'Bayern Munich', 'borussia-dortmund': 'Dortmund', 'sv-werder-bremen': 'Werder Bremen' };
  openfootball(L, [['bayer-leverkusen', 'Bayer Leverkusen'], ['bayer-04-leverkusen', 'Bayer 04 Leverkusen'], ['bayern-munchen', 'FC Bayern München'], ['borussia-dortmund', 'Borussia Dortmund'], ['sv-werder-bremen', 'SV Werder Bremen']], []);
  for (const [season, lev] of [[2020, 'bayer-leverkusen'], [2021, 'bayer-04-leverkusen']] as const) {
    const clubes = [lev, 'bayern-munchen', 'borussia-dortmund', 'sv-werder-bremen'];
    const of: [number, string, string, string, number, number][] = [];
    const filas: [string, string, string, number, number][] = [];
    let dia = 0;
    for (const h of clubes) for (const a of clubes) {
      if (h === a) continue;
      dia++;
      const fecha = `${season - 1}09${String(dia).padStart(2, '0')}`;
      of.push([season, fecha, h, a, dia % 4, (dia + 1) % 3]);
      filas.push([fecha, h === lev ? 'Leverkusen' : fd[h], a === lev ? 'Leverkusen' : fd[a], dia % 4, (dia + 1) % 3]);
    }
    openfootball(L, [], of);
    csv(L, season, filas);
  }
  const r = await ingestFootballData(liga(L), [2020, 2021]);
  assert.equal(equiposDe(L).length, 5, 'ningún equipo nuevo');
  assert.deepEqual(r.creados, []);
  const p = partidosDe(L);
  assert.equal(p.length, 24, 'cada partido una vez');
  assert.ok(p.every((x) => x.o === 2.1));
  assert.ok(p.filter((x) => x.season === 2020).every((x) => x.h !== 'bayer-04-leverkusen' && x.a !== 'bayer-04-leverkusen'), '2019-20 sigue con su id');
});

test('una temporada que solo trae football-data toma el id de la más cercana; un club sin rastro se da de alta', async () => {
  const L = 't_fd_hueco';
  openfootball(
    L,
    [['stade-rennais-1901', 'Stade Rennais FC 1901'], ['olympique-lyonnais', 'Olympique Lyonnais'], ['fc-nantes', 'FC Nantes']],
    [
      [2021, '20201003', 'stade-rennais-1901', 'olympique-lyonnais', 1, 0],
      [2021, '20201010', 'fc-nantes', 'stade-rennais-1901', 0, 0],
      [2021, '20201017', 'olympique-lyonnais', 'fc-nantes', 3, 2],
      [2021, '20201024', 'stade-rennais-1901', 'fc-nantes', 2, 0],
      [2021, '20201031', 'olympique-lyonnais', 'stade-rennais-1901', 1, 1],
      [2021, '20201107', 'fc-nantes', 'olympique-lyonnais', 0, 4],
    ],
  );
  csv(L, 2021, [
    ['20201003', 'Rennes', 'Lyon', 1, 0],
    ['20201010', 'Nantes', 'Rennes', 0, 0],
    ['20201017', 'Lyon', 'Nantes', 3, 2],
    ['20201024', 'Rennes', 'Nantes', 2, 0],
    ['20201031', 'Lyon', 'Rennes', 1, 1],
    ['20201107', 'Nantes', 'Lyon', 0, 4],
  ]);
  // 2022-23: openfootball no la tiene; Bordeaux no aparece en ninguna temporada de openfootball.
  csv(L, 2023, [
    ['20220806', 'Rennes', 'Bordeaux', 2, 1],
    ['20220813', 'Lyon', 'Rennes', 0, 1],
  ]);
  const r = await ingestFootballData(liga(L), [2021, 2023]);
  assert.deepEqual(
    equiposDe(L),
    ['bordeaux=Bordeaux', 'fc-nantes=FC Nantes', 'olympique-lyonnais=Olympique Lyonnais', 'stade-rennais-1901=Stade Rennais FC 1901'],
    'Rennes y Lyon de 2022-23 son los de 2020-21; Bordeaux, nuevo',
  );
  assert.deepEqual(r.creados, ['Bordeaux'], 'lo que se da de alta se dice');
  const de2023 = partidosDe(L).filter((x) => x.season === 2023);
  assert.deepEqual(de2023.map((x) => `${x.h}-${x.a}`), ['stade-rennais-1901-bordeaux', 'olympique-lyonnais-stade-rennais-1901']);
});

test('un día con dos partidos del mismo marcador no enseña nada a ciegas', async () => {
  const L = 't_fd_empate';
  openfootball(
    L,
    [['aaa-uno', 'Aaa Uno'], ['bbb-dos', 'Bbb Dos'], ['ccc-tres', 'Ccc Tres'], ['ddd-cuatro', 'Ddd Cuatro']],
    [
      [2026, '20250816', 'aaa-uno', 'bbb-dos', 1, 0],
      [2026, '20250816', 'ccc-tres', 'ddd-cuatro', 1, 0],
    ],
  );
  csv(L, 2026, [
    ['20250816', 'Uno', 'Dos', 1, 0],
    ['20250816', 'Tres', 'Cuatro', 1, 0],
  ]);
  const r = await ingestFootballData(liga(L), [2026]);
  // Ni votos claros ni nombre igual: se dan de alta tal cual, como antes, y se dice.
  assert.deepEqual((r.creados ?? []).sort(), ['Cuatro', 'Dos', 'Tres', 'Uno']);
  assert.ok(!equiposDe(L).some((e) => /^(aaa-uno|bbb-dos|ccc-tres|ddd-cuatro)=(Uno|Dos|Tres|Cuatro)$/.test(e)), 'ningún nombre formal pisado');
});

test('lo aprendido se guarda: un feed que escribe como football-data («Napoli») sigue encontrando al club', async () => {
  // Revisión data-guardian (F1): al dejar de dar de alta los nombres cortos, las casas (odds.ts) y
  // ClubElo (clubelo.ts), que resuelven con buildTeamIndex, dejaban de encontrar a «Napoli», «Lyon» o
  // «Bayern Munich» en una base nueva, y sin home_id no se registra la predicción del partido.
  const { buildTeamIndex, resolveTeam } = await import('./teamNames.ts');
  const L = 't_fd_alias';
  openfootball(
    L,
    [['ssc-napoli', 'SSC Napoli'], ['juventus', 'Juventus FC'], ['fc-internazionale-milano', 'FC Internazionale Milano']],
    [
      [2026, '20250816', 'ssc-napoli', 'juventus', 2, 1],
      [2026, '20250823', 'juventus', 'fc-internazionale-milano', 0, 1],
      [2026, '20250830', 'fc-internazionale-milano', 'ssc-napoli', 3, 0],
      [2026, '20250913', 'juventus', 'ssc-napoli', 1, 1],
      [2026, '20250920', 'fc-internazionale-milano', 'juventus', 2, 2],
      [2026, '20250927', 'ssc-napoli', 'fc-internazionale-milano', 4, 2],
    ],
  );
  csv(L, 2026, [
    ['20250816', 'Napoli', 'Juventus', 2, 1],
    ['20250823', 'Juventus', 'Inter', 0, 1],
    ['20250830', 'Inter', 'Napoli', 3, 0],
    ['20250913', 'Juventus', 'Napoli', 1, 1],
    ['20250920', 'Inter', 'Juventus', 2, 2],
    ['20250927', 'Napoli', 'Inter', 4, 2],
  ]);
  await ingestFootballData(liga(L), [2026]);
  const idx = buildTeamIndex(L as never);
  assert.equal(resolveTeam(idx, 'Napoli'), 'ssc-napoli');
  assert.equal(resolveTeam(idx, 'Inter'), 'fc-internazionale-milano');
  assert.equal(resolveTeam(idx, 'Juventus'), 'juventus');
  // Un alias nunca tapa un nombre que ya resolvía: «SSC Napoli» sigue siendo el suyo.
  assert.equal(resolveTeam(idx, 'SSC Napoli'), 'ssc-napoli');
});

test('el mismo partido con fecha distinta en cada fuente (1–3 días, o aplazado) entra una vez', async () => {
  // Hallazgo C del nocturno: unos 51 partidos con la fecha de football-data a 1–3 días de la de
  // openfootball, o con una la original y otra la del aplazamiento (Juve Stabia–Bari, 29/10 y 4/12/2025),
  // entraban dos veces. Mismo marcador, misma temporada, la pareja una sola vez: es el mismo partido, y
  // se queda la fecha de openfootball. Dos candidatos, o un marcador distinto, no se tocan.
  const L = 't_fd_fecha';
  const clubes: [string, string][] = [['aa-uno', 'Aa Uno'], ['bb-dos', 'Bb Dos'], ['cc-tres', 'Cc Tres'], ['dd-cuatro', 'Dd Cuatro']];
  const of: [number, string, string, string, number, number][] = [];
  const fd: [string, string, string, number, number][] = [];
  let dia = 0;
  for (const [h] of clubes) for (const [a] of clubes) {
    if (h === a) continue;
    dia++;
    const fecha = `202509${String(dia).padStart(2, '0')}`;
    of.push([2026, fecha, h, a, dia % 4, (dia + 1) % 3]);
    fd.push([fecha, h.split('-')[1], a.split('-')[1], dia % 4, (dia + 1) % 3]);
  }
  // Tres desacuerdos: un día después, un aplazado (36 días) y uno con otro marcador (no es el mismo).
  fd[0] = ['20250902', fd[0][1], fd[0][2], fd[0][3], fd[0][4]];
  fd[1] = ['20251008', fd[1][1], fd[1][2], fd[1][3], fd[1][4]];
  fd[2] = ['20250904', fd[2][1], fd[2][2], 9, 9];
  openfootball(L, clubes, of);
  csv(L, 2026, fd);
  const r = await ingestFootballData(liga(L), [2026]);
  const p = partidosDe(L);
  assert.equal(p.length, 13, '12 partidos y el de otro marcador aparte');
  assert.equal(r.porFecha, 2, 'dos se juntan con su gemelo de otra fecha');
  const deUnoADos = p.filter((x) => x.h === 'aa-uno' && x.a === 'bb-dos');
  assert.deepEqual(deUnoADos.map((x) => [x.d, x.o]), [['20250901', 2.1]], 'la fecha de openfootball, con las cuotas');
});
