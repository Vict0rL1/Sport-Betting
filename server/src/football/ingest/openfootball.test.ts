// openfootball fecha un año antes los partidos de julio de 2020 (la vuelta tras el COVID de 2019-20):
// en el JSON publicado (football.json/master/2019-20/en.1.json) las jornadas 32 a 38 de la Premier
// salen en julio de 2019, y la jornada 1 es del 9 de agosto de 2019. Lo mismo en la Championship.
// 143 partidos ordenados antes de empezar la temporada, y que no casan con el mismo partido de
// football-data (docs/plans/nocturno-datos.md, hallazgo B). JSON sintético con la forma del real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../test/setup.ts';

const { parseOpenFootball } = await import('./openfootball.ts');

const partido = (round: string | undefined, date: string, team1: string, team2: string, ft: [number, number]) => ({ round, date, team1, team2, score: { ft } });
const fichero = (matches: unknown[]) => JSON.stringify({ name: 'Liga de prueba', matches });

test('una jornada posterior fechada antes de que empiece la temporada está un año corta: se mueve', () => {
  const ms = parseOpenFootball(
    fichero([
      partido('Matchday 1', '2019-08-09', 'Liverpool FC', 'Norwich City FC', [4, 1]),
      partido('Matchday 1', '2019-08-10', 'West Ham United FC', 'Manchester City FC', [0, 5]),
      partido('Matchday 30', '2020-06-20', 'Norwich City FC', 'Southampton FC', [0, 3]),
      partido('Matchday 32', '2019-07-01', 'Arsenal FC', 'Norwich City FC', [4, 0]),
      partido('Matchday 38', '2019-07-26', 'Liverpool FC', 'Newcastle United FC', [3, 1]),
    ]),
    'en.1.json',
  );
  assert.deepEqual(
    ms.map((m) => m.date),
    ['20190809', '20190810', '20200620', '20200701', '20200726'],
  );
  assert.deepEqual(ms.filter((m) => m.fechaOriginal).map((m) => m.fechaOriginal), ['20190701', '20190726'], 'se dice cuál se movió y desde qué fecha');
});

test('una liga que empieza en julio no se toca, ni un partido sin jornada numerada', () => {
  const ms = parseOpenFootball(
    fichero([
      partido('Apertura - Jornada 1', '2019-07-19', 'Club América', 'Club Necaxa', [2, 0]),
      partido('Apertura - Jornada 2', '2019-07-27', 'Club Necaxa', 'Club América', [1, 1]),
      partido('Clausura - Jornada 1', '2020-01-10', 'Club América', 'Club Necaxa', [3, 2]),
      partido('Final', '2019-07-05', 'Club América', 'Club Necaxa', [1, 0]),
      partido(undefined, '2019-07-06', 'Club Necaxa', 'Club América', [0, 1]),
    ]),
    'mx.1.json',
  );
  assert.deepEqual(ms.map((m) => m.date), ['20190719', '20190727', '20200110', '20190705', '20190706']);
  assert.ok(ms.every((m) => !m.fechaOriginal));
});

test('sin jornada 1 en el fichero no hay con qué comparar: nada se mueve', () => {
  const ms = parseOpenFootball(fichero([partido('Matchday 32', '2019-07-01', 'Arsenal FC', 'Norwich City FC', [4, 0])]), 'en.1.json');
  assert.equal(ms[0].date, '20190701');
});

test('una jornada temprana colada antes del inicio (la vuelta de una eliminatoria) no se mueve un año hacia delante', () => {
  // Revisión data-guardian: «antes de la jornada 1» no basta. Solo se mueve una jornada TARDÍA (número por
  // encima de la mediana del fichero), que es lo que pasa en julio de 2020 (jornadas 32 a 38, mediana 20).
  const jornadas = Array.from({ length: 30 }, (_, i) => partido(`Matchday ${i + 1}`, `2019-${String(8 + Math.floor(i / 4)).padStart(2, '0')}-1${i % 4}`.replace(/^2019-1([3-9])/, '2020-0$1'), 'Aaa FC', 'Bbb FC', [1, 0]));
  const ms = parseOpenFootball(fichero([...jornadas, partido('Leg 2', '2019-06-20', 'Ccc FC', 'Ddd FC', [2, 2])]), 'en.2.json');
  const leg = ms.find((m) => m.homeName === 'Ccc FC');
  assert.equal(leg?.date, '20190620');
  assert.equal(leg?.fechaOriginal, undefined);
});

test('en una base que ya existe, el partido movido no deja su copia en la fecha vieja', async () => {
  // Revisión data-guardian (B1): la ingesta de antes guardó el partido en julio de 2019, y el upsert por
  // (liga, fecha, local, visitante) del nuevo no lo tocaba. Una pasada incremental lo dejaba dos veces.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { getDb } = await import('../../db.ts');
  const { ingestOpenFootball, CACHE_DIR } = await import('./openfootball.ts');
  const L = 't_of_incremental';
  const db = getDb();
  for (const [id, n] of [['aaa', 'Aaa FC'], ['bbb', 'Bbb FC'], ['ccc', 'Ccc FC'], ['ddd', 'Ddd FC']]) db.prepare('INSERT INTO fb_teams (id, league, name) VALUES (?, ?, ?)').run(id, L, n);
  db.prepare("INSERT INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result) VALUES (?, 2020, '20190719', 'aaa', 'bbb', 2, 1, 'H')").run(L);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CACHE_DIR, 'tt.1_2019-20.json'),
    fichero([
      partido('Matchday 1', '2019-08-10', 'Aaa FC', 'Ccc FC', [1, 0]),
      partido('Matchday 1', '2019-08-10', 'Bbb FC', 'Ddd FC', [0, 0]),
      partido('Matchday 32', '2019-07-19', 'Aaa FC', 'Bbb FC', [2, 1]),
    ]),
  );
  const r = await ingestOpenFootball({ id: L, openfootball: { key: 'tt.1' } } as never, ['2019-20']);
  assert.equal(r.fechasCorregidas, 1);
  const filas = db.prepare("SELECT match_date d FROM fb_matches WHERE league = ? AND home_id = 'aaa' AND away_id = 'bbb'").all(L) as { d: string }[];
  assert.deepEqual(filas.map((f) => f.d), ['20200719'], 'una fila, en la fecha corregida');
});
