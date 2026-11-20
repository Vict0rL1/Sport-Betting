// openfootball cambia a veces la grafía de un club entre temporadas («Bayer Leverkusen» en 2019-20,
// «Bayer 04 Leverkusen» después), y con ella el id: para el modelo eran dos equipos y el Elo se
// reiniciaba. Con los datos reales, 24 clubes en 7 ligas (docs/plans/nocturno-datos.md, hallazgo A).
// Equipos y partidos sintéticos con los nombres reales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../test/setup.ts';

const { getDb } = await import('../../db.ts');
const { clubesPartidos, unificarClubesPartidos } = await import('./clubesPartidos.ts');
const { buildTeamIndex } = await import('./teamNames.ts');
const { normalizeTeamName } = await import('./teamNames.ts');

/** Un club por temporada contra un rival fijo: lo justo para que tenga temporadas. */
function liga(L: string, equipos: [id: string, name: string, temporadas: number[]][]): void {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO fb_teams (id, league, name) VALUES ('rival', ?, 'Rival FC')").run(L);
  const eq = db.prepare('INSERT INTO fb_teams (id, league, name) VALUES (?, ?, ?)');
  const pa = db.prepare("INSERT INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result) VALUES (?, ?, ?, ?, 'rival', 1, 0, 'H')");
  let n = 0;
  for (const [id, name, temporadas] of equipos) {
    eq.run(id, L, name);
    for (const s of temporadas) pa.run(L, s, `${s - 1}09${String(++n % 28 + 1).padStart(2, '0')}`, id);
  }
}
const ids = (L: string) => (getDb().prepare("SELECT id FROM fb_teams WHERE league = ? AND id != 'rival' ORDER BY id").all(L) as { id: string }[]).map((r) => r.id);
const de = (L: string, id: string) => (getDb().prepare('SELECT COUNT(*) AS n FROM fb_matches WHERE league = ? AND (home_id = ? OR away_id = ?)').get(L, id, id) as { n: number }).n;

test('un club partido entre temporadas seguidas se une al id más reciente, y su nombre viejo queda como alias', () => {
  const L = 't_cp_lev';
  liga(L, [
    ['bayer-leverkusen', 'Bayer Leverkusen', [2020]],
    ['bayer-04-leverkusen', 'Bayer 04 Leverkusen', [2021, 2022, 2023]],
  ]);
  const r = unificarClubesPartidos(L);
  assert.deepEqual(r.map((f) => `${f.viejo}→${f.nuevo}`), ['bayer-leverkusen→bayer-04-leverkusen']);
  assert.deepEqual(ids(L), ['bayer-04-leverkusen']);
  assert.equal(de(L, 'bayer-04-leverkusen'), 4, 'los cuatro partidos, en un solo club');
  // Una nueva ingesta de 2019-20 vuelve a decir «Bayer Leverkusen»: tiene que caer en el mismo club.
  assert.equal(buildTeamIndex(L as never).get(normalizeTeamName('Bayer Leverkusen')), 'bayer-04-leverkusen');
  assert.deepEqual(unificarClubesPartidos(L), [], 'repetirlo no cambia nada');
});

test('las siglas cuentan («SL Benfica» → «Sport Lisboa e Benfica»), y las palabras sueltas en otro orden también', () => {
  const L = 't_cp_por';
  liga(L, [
    ['sl-benfica', 'SL Benfica', [2020, 2021]],
    ['sport-lisboa-e-benfica', 'Sport Lisboa e Benfica', [2022, 2023]],
    ['sporting-cp', 'Sporting CP', [2020, 2021]],
    ['sporting-clube-de-portugal', 'Sporting Clube de Portugal', [2022, 2023]],
    ['sporting-braga', 'Sporting Braga', [2020, 2021]],
    ['sporting-clube-de-braga', 'Sporting Clube de Braga', [2022, 2023]],
  ]);
  const r = unificarClubesPartidos(L);
  assert.deepEqual(r.map((f) => f.viejo).sort(), ['sl-benfica', 'sporting-braga', 'sporting-cp']);
  assert.deepEqual(ids(L), ['sport-lisboa-e-benfica', 'sporting-clube-de-braga', 'sporting-clube-de-portugal']);
});

test('dos clubes de la misma temporada son dos clubes, aunque un nombre esté dentro del otro (Paris FC y el PSG)', () => {
  const L = 't_cp_paris';
  liga(L, [
    ['paris-saint-germain', 'Paris Saint-Germain', [2020, 2021, 2022, 2023]],
    ['paris', 'Paris FC', [2023]],
  ]);
  assert.deepEqual(clubesPartidos(L), []);
});

test('tras temporadas fuera de la liga, el nombre nuevo tiene que contener al viejo (el Chievo no es el Hellas)', () => {
  const L = 't_cp_hueco';
  liga(L, [
    // Chievo Verona desapareció en 2021; el «Verona» de 2027 es el Hellas. El nuevo es más corto: no.
    ['chievo-verona', 'Chievo Verona', [2020, 2021]],
    ['verona', 'Verona', [2027]],
    // Cambuur bajó en 2023 y volvió en 2027 con el nombre largo: sí.
    ['cambuur', 'SC Cambuur', [2022, 2023]],
    ['cambuur-leeuwarden', 'SC Cambuur-Leeuwarden', [2027]],
  ]);
  assert.deepEqual(clubesPartidos(L).map((f) => `${f.viejo}→${f.nuevo}`), ['cambuur→cambuur-leeuwarden']);
});

test('si hay más de un candidato, no se une ninguno', () => {
  const L = 't_cp_dos';
  liga(L, [
    ['atletico', 'Atlético', [2020]],
    ['atletico-tucuman', 'Atlético Tucumán', [2021, 2022]],
    ['atletico-rafaela', 'Atlético Rafaela', [2021, 2022]],
  ]);
  assert.deepEqual(clubesPartidos(L), []);
});

test('las demás tablas de la historia pasan al id nuevo (el libro mayor no está en la lista: el módulo no carga si lo estuviera)', () => {
  const L = 't_cp_tablas';
  liga(L, [
    ['stade-rennais', 'Stade Rennais', [2020, 2021]],
    ['stade-rennais-1901', 'Stade Rennais FC 1901', [2022, 2023]],
  ]);
  const db = getDb();
  db.prepare("INSERT INTO fb_players (id, league, team_id, name, position) VALUES ('p1', ?, 'stade-rennais', 'Un Jugador', 'MID')").run(L);
  db.prepare("INSERT INTO fb_team_aliases (league, alias, team_id, fuente, season, updated_at) VALUES (?, 'Rennes', 'stade-rennais', 'football-data', 2021, 'x')").run(L);
  unificarClubesPartidos(L);
  assert.equal((db.prepare('SELECT team_id FROM fb_players WHERE league = ? AND id = ?').get(L, 'p1') as { team_id: string }).team_id, 'stade-rennais-1901');
  assert.equal((db.prepare("SELECT team_id FROM fb_team_aliases WHERE league = ? AND alias = 'Rennes'").get(L) as { team_id: string }).team_id, 'stade-rennais-1901');
  assert.equal(de(L, 'stade-rennais'), 0);
});

test('una predicción pendiente guardada con el id viejo se liquida con el partido del club unido', async () => {
  // La casa escribía «SC Cambuur», que caía en el id viejo `cambuur`, mientras openfootball ya llamaba
  // `cambuur-leeuwarden` al de 2026-27: esa predicción no encontraba nunca su partido. La liquidación
  // traduce un id que ya no es un equipo por el índice de nombres (con los alias); la fila del libro mayor
  // no cambia de ids.
  const { resolveFootballPredictions } = await import('../trackRecord.ts');
  const L = 't_cp_liq';
  liga(L, [
    ['cambuur', 'SC Cambuur', [2022, 2023]],
    ['cambuur-leeuwarden', 'SC Cambuur-Leeuwarden', [2027]],
  ]);
  unificarClubesPartidos(L);
  const db = getDb();
  const { match_date: d } = db.prepare("SELECT match_date FROM fb_matches WHERE league = ? AND home_id = 'cambuur-leeuwarden' AND season = 2027").get(L) as { match_date: string };
  const inicio = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T18:00:00.000Z`;
  db.prepare(
    `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, reliability, predicted_at)
     VALUES ('k-cambuur', ?, 'u-cambuur', ?, 'cambuur', 'rival', 'SC Cambuur', 'Rival FC', 0.5, 0.3, 0.2, 'medium', ?)`,
  ).run(L, inicio, `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T09:00:00.000Z`);
  resolveFootballPredictions();
  const r = db.prepare("SELECT home_id, home_goals, away_goals, resolved_at FROM fb_prediction_log WHERE match_key = 'k-cambuur'").get() as { home_id: string; home_goals: number | null; away_goals: number | null; resolved_at: string | null };
  assert.ok(r.resolved_at, 'liquidada');
  assert.deepEqual([r.home_goals, r.away_goals], [1, 0]);
  assert.equal(r.home_id, 'cambuur', 'el libro mayor conserva el id con el que se guardó');
});

test('un filial no se une al primer equipo (Villarreal B, Real Madrid Castilla, Jong Ajax), pero «Willem II» sí se une a «Willem II Tilburg»', () => {
  // Revisión data-guardian: «Villarreal CF B» en una segunda división antes de que baje el primer equipo
  // encajaba por nombres y temporadas. Una marca de filial en un nombre y no en el otro: no es el mismo.
  const L = 't_cp_filial';
  liga(L, [
    ['villarreal-b', 'Villarreal CF B', [2011, 2012]],
    ['villarreal', 'Villarreal CF', [2013]],
    ['real-madrid-castilla', 'Real Madrid Castilla', [2014]],
    ['real-madrid', 'Real Madrid', [2015]],
    ['ajax', 'Ajax', [2016]],
    ['jong-ajax', 'Jong Ajax', [2017]],
    ['willem-ii', 'Willem II', [2020, 2021, 2022]],
    ['willem-ii-tilburg', 'Willem II Tilburg', [2025]],
  ]);
  assert.deepEqual(clubesPartidos(L).map((f) => `${f.viejo}→${f.nuevo}`), ['willem-ii→willem-ii-tilburg']);
});

test('tras unir, el mismo partido no se registra dos veces porque cambie el id (sí si cambia la fecha: aplazado)', async () => {
  // Revisión data-guardian: una predicción pendiente con el id viejo y la siguiente con el nuevo tenían
  // match_key distinta, y el partido contaba dos veces en el historial y la calibración. Con el mismo
  // partido (upcoming_id) el mismo día, vale la primera, como ya hace ON CONFLICT DO NOTHING.
  const { logFootballPrediction } = await import('../trackRecord.ts');
  const L = 't_cp_doble';
  liga(L, [
    ['stade-rennais', 'Stade Rennais', [2020, 2021]],
    ['stade-rennais-1901', 'Stade Rennais FC 1901', [2022, 2023]],
  ]);
  const db = getDb();
  const inicio = '2030-03-01T19:00:00.000Z';
  db.prepare(
    `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, reliability, predicted_at)
     VALUES (?, ?, 'u-ren', ?, 'stade-rennais', 'rival', 'Stade Rennais', 'Rival FC', 0.5, 0.3, 0.2, 'medium', '2030-02-27T10:00:00.000Z')`,
  ).run(`${L}|stade-rennais|rival|20300301`, L, inicio);
  unificarClubesPartidos(L);
  const prediccion = {
    teams: { home: { name: 'Stade Rennais FC 1901' }, away: { name: 'Rival FC' } },
    model: { home: 0.55, draw: 0.25, away: 0.2 },
    final: { home: 0.55, draw: 0.25, away: 0.2 },
    goals: { expectedHome: 1.6, expectedAway: 1.0 },
    reliability: { level: 'medium' },
  } as never;
  const fila = (commence: string) => ({ id: 'u-ren', league: L, commence_time: commence, home_id: 'stade-rennais-1901', away_id: 'rival', odds_home: null, odds_draw: null, odds_away: null }) as never;
  logFootballPrediction(fila(inicio), prediccion);
  const filas = () => (db.prepare("SELECT COUNT(*) AS n FROM fb_prediction_log WHERE upcoming_id = 'u-ren'").get() as { n: number }).n;
  assert.equal(filas(), 1, 'el mismo partido el mismo día: una fila');
  logFootballPrediction(fila('2030-03-08T19:00:00.000Z'), prediccion);
  assert.equal(filas(), 2, 'aplazado a otro día: se registra, como antes');
});
