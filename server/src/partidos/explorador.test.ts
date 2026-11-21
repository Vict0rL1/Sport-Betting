// El explorador de partidos (rediseño de noviembre, D2): una lista de todos los deportes con el
// origen de cada cosa dicho por separado. Datos sintéticos y aislados (DATA_DIR temporal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { explorarPartidos, ventana } = await import('./explorador.ts');

const AHORA = new Date('2026-11-20T10:00:00Z');
const EN = (h: number) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();

function sembrar() {
  const db = getDb();
  const fb = db.prepare(
    `INSERT INTO fb_upcoming (id, league, commence_time, home_name, away_name, home_id, away_id, odds_home, odds_draw, odds_away, books, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Real con cuotas de casa.
  fb.run('ev-real', 'laliga', EN(5), 'Real Betis', 'Sevilla FC', 'betis', 'sevilla', 2.1, 3.3, 3.6, 12, 'live', EN(-1));
  // Real del calendario, sin cuotas.
  fb.run('ev-sin', 'laliga', EN(30), 'Girona FC', 'Valencia CF', 'girona', 'valencia', null, null, null, 0, 'schedule', EN(-1));
  // Demostración: cuotas inventadas.
  fb.run('fixture-laliga-x-0', 'laliga', EN(6), 'Villarreal CF', 'RCD Mallorca', 'villarreal', 'mallorca', 1.8, 3.6, 4.5, 0, 'fixture', EN(-1));
  // Alias contra su propio club (T01).
  fb.run('ev-alias', 'laliga', EN(7), 'Real Betis Balompié', 'Betis', 'betis', 'betis', 2, 3, 4, 3, 'live', EN(-1));
  // Fuera de la ventana.
  fb.run('ev-lejos', 'laliga', EN(24 * 20), 'Getafe CF', 'CA Osasuna', 'getafe', 'osasuna', null, null, null, 0, 'schedule', EN(-1));

  const log = db.prepare(
    `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, predicted_at, model_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  log.run('laliga|betis|sevilla|20261120', 'laliga', 'ev-real', EN(5), 'betis', 'sevilla', 'Real Betis', 'Sevilla FC', 0.5, 0.25, 0.25, EN(-5), 'fb-1');
  log.run('laliga|villarreal|mallorca|20261120', 'laliga', 'fixture-laliga-x-0', EN(6), 'villarreal', 'mallorca', 'Villarreal CF', 'RCD Mallorca', 0.55, 0.25, 0.2, EN(-5), 'fb-1');

  // Una revisión posterior en las instantáneas: el explorador enseña la última, con su hora.
  db.prepare(
    `INSERT INTO prediction_snapshots (sport, match_key, event_id, commence_time, captured_at, outcomes, probs, inputs, model_version)
     VALUES ('football', 'laliga|betis|sevilla|20261120', 'ev-real', ?, ?, ?, ?, '{}', 'fb-2')`,
  ).run(EN(5), EN(-1), JSON.stringify(['Real Betis', 'Empate', 'Sevilla FC']), JSON.stringify([0.52, 0.26, 0.22]));

  // NHL: dos resultados, con prórroga; una distribución rota en el registro (T07).
  const nhl = db.prepare(
    `INSERT INTO nhl_upcoming (id, league, season, game_id, commence_time, home_name, away_name, home_id, away_id, odds_home, odds_away, books, source, updated_at)
     VALUES (?, 'nhl', 2026, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  nhl.run('nhl-1', 1, EN(9), 'Boston Bruins', 'Toronto Maple Leafs', 'BOS', 'TOR', 1.9, 1.95, 8, 'live', EN(-30));
  nhl.run('nhl-2', 2, EN(10), 'Edmonton Oilers', 'Calgary Flames', 'EDM', 'CGY', null, null, 0, 'schedule', EN(-1));
  db.prepare(
    `INSERT INTO nhl_prediction_log (match_key, league, upcoming_id, commence_time, season, home_id, away_id, home_name, away_name, prob_home, shown_home, predicted_at, model_version)
     VALUES (?, 'nhl', ?, ?, 2026, ?, ?, ?, ?, ?, ?, ?, 'nhl-1')`,
  ).run('nhl|BOS|TOR|20261120', 'nhl-1', EN(9), 'BOS', 'TOR', 'Boston Bruins', 'Toronto Maple Leafs', 0.56, 0.55, EN(-2));
  db.prepare(
    `INSERT INTO nhl_prediction_log (match_key, league, upcoming_id, commence_time, season, home_id, away_id, home_name, away_name, prob_home, shown_home, predicted_at, model_version)
     VALUES (?, 'nhl', ?, ?, 2026, ?, ?, ?, ?, ?, ?, ?, 'nhl-1')`,
  ).run('nhl|EDM|CGY|20261120', 'nhl-2', EN(10), 'EDM', 'CGY', 'Edmonton Oilers', 'Calgary Flames', 1.4, null, EN(-2));

  // Tenis: jugadores, sin local.
  db.prepare(
    `INSERT INTO upcoming_matches (id, tour, tournament_id, tournament_name, surface, commence_time, p1_name, p2_name, p1_id, p2_id, p1_odds, p2_odds, books, source, updated_at)
     VALUES ('t-1', 'atp', 'finals', 'ATP Finals', 'hard', ?, 'Jannik Sinner', 'Carlos Alcaraz', 1, 2, null, null, 0, 'schedule', ?)`,
  ).run(EN(8), EN(-1));
}

sembrar();

test('la ventana: Hoy y Mañana en la zona pedida, y un rango mal formado no rompe', () => {
  // 23:30 en Madrid es ya mañana en UTC+1; «hoy» va de 00:00 a 24:00 de Madrid.
  const v = ventana({ dia: '2026-11-20', zona: 'Europe/Madrid' }, AHORA);
  assert.equal(v.desde, '2026-11-19T23:00:00.000Z');
  assert.equal(v.hasta, '2026-11-20T23:00:00.000Z');
  // Los Ángeles va 8 h por detrás: su 20 de noviembre empieza a las 08:00 UTC.
  const la = ventana({ dia: '2026-11-20', zona: 'America/Los_Angeles' }, AHORA);
  assert.equal(la.desde, '2026-11-20T08:00:00.000Z');
  // Sin día: desde 3 h antes (lo que se está jugando) hasta 7 días después.
  const def = ventana({}, AHORA);
  assert.equal(def.desde, EN(-3));
  assert.equal(def.hasta, EN(24 * 7));
  // Zona o día inválidos: la ventana por defecto, no una excepción.
  assert.equal(ventana({ dia: 'ayer', zona: 'Marte/Olimpo' }, AHORA).desde, EN(-3));
});

test('T22: un partido a las 23:30 de Madrid es de «hoy» en Madrid y de «mañana» en UTC', () => {
  getDb()
    .prepare(
      `INSERT INTO fb_upcoming (id, league, commence_time, home_name, away_name, home_id, away_id, books, source, updated_at)
       VALUES ('ev-noche', 'epl', '2026-11-20T22:30:00.000Z', 'Arsenal FC', 'Chelsea FC', 'arsenal', 'chelsea', 0, 'schedule', ?)`,
    )
    .run(EN(-1));
  const madrid = explorarPartidos(ventana({ dia: '2026-11-20', zona: 'Europe/Madrid' }, AHORA), AHORA);
  assert.ok(madrid.filas.some((f) => f.id === 'ev-noche'));
  const tokio = explorarPartidos(ventana({ dia: '2026-11-20', zona: 'Asia/Tokyo' }, AHORA), AHORA);
  assert.ok(!tokio.filas.some((f) => f.id === 'ev-noche'), 'en Tokio ya es el 21');
});

test('T01: el mismo club a los dos lados no sale en la lista y se cuenta en cuarentena', () => {
  const r = explorarPartidos(ventana({}, AHORA), AHORA);
  assert.ok(!r.filas.some((f) => f.id === 'ev-alias'));
  assert.equal(r.cuarentena.n, 1);
  assert.match(r.cuarentena.ejemplos[0], /Real Betis Balompié/);
  assert.ok(!r.filas.some((f) => f.id === 'ev-lejos'), 'fuera de la ventana');
});

test('T03: un partido real sin cuotas sigue en la lista, sin cuotas inventadas', () => {
  const r = explorarPartidos(ventana({}, AHORA), AHORA);
  const f = r.filas.find((x) => x.id === 'ev-sin')!;
  assert.ok(f);
  assert.equal(f.origen, 'real');
  assert.equal(f.cuotas, null);
  assert.equal(f.prediccion, null);
  assert.equal(f.sinPrediccion, 'sin-registro');
});

test('T04: las cuotas de demostración se marcan como tales y el partido como demostración', () => {
  const r = explorarPartidos(ventana({}, AHORA), AHORA);
  const demo = r.filas.find((x) => x.id === 'fixture-laliga-x-0')!;
  assert.equal(demo.origen, 'demo');
  assert.equal(demo.cuotas?.origen, 'demo');
  const real = r.filas.find((x) => x.id === 'ev-real')!;
  assert.equal(real.origen, 'real');
  assert.equal(real.cuotas?.origen, 'casa');
  assert.deepEqual(real.cuotas?.precios, [2.1, 3.3, 3.6]);
  assert.equal(real.cuotas?.completas, true);
  assert.equal(real.cuotas?.recibidasEn, EN(-1));
});

test('T06 / T11: el 1X2 sale de la última instantánea, con su hora y versión; tres resultados', () => {
  const r = explorarPartidos(ventana({}, AHORA), AHORA);
  const f = r.filas.find((x) => x.id === 'ev-real')!;
  assert.deepEqual(f.mercado.resultados, ['local', 'empate', 'visitante']);
  assert.equal(f.mercado.prorroga, 'no');
  assert.deepEqual(f.prediccion?.probs, [0.52, 0.26, 0.22]);
  assert.equal(f.prediccion?.capturadaEn, EN(-1));
  assert.equal(f.prediccion?.version, 'fb-2');
  assert.equal(f.prediccion?.fuente, 'instantanea');
  assert.equal(f.liga?.nombre, 'LaLiga');
});

test('T08: la NHL y el tenis tienen dos resultados, sin empate; el tenis no tiene local', () => {
  const r = explorarPartidos(ventana({}, AHORA), AHORA);
  const n = r.filas.find((x) => x.id === 'nhl-1')!;
  assert.deepEqual(n.mercado.resultados, ['local', 'visitante']);
  assert.equal(n.mercado.prorroga, 'incluida');
  // La enseñada (shown_home) manda sobre la cruda.
  assert.deepEqual(n.prediccion?.probs, [0.55, 0.45]);
  assert.equal(n.prediccion?.fuente, 'registro');
  const t = r.filas.find((x) => x.id === 't-1')!;
  assert.equal(t.sede, 'neutral');
  assert.equal(t.mercado.prorroga, 'no-aplica');
  assert.equal(t.torneo, 'ATP Finals');
  assert.equal(t.local.nombre, 'Jannik Sinner');
});

test('una fila de demostración sin estimación registrada lo dice con su motivo (no «todavía»)', () => {
  getDb()
    .prepare(
      `INSERT INTO upcoming_matches (id, tour, tournament_id, tournament_name, surface, commence_time, p1_name, p2_name, p1_id, p2_id, p1_odds, p2_odds, books, source, updated_at)
       VALUES ('t-demo', 'atp', 'w', 'Wimbledon', 'grass', ?, 'Demo Uno', 'Demo Dos', 11, 12, 1.4, 3.1, 0, 'fixture', ?)`,
    )
    .run(EN(11), EN(-1));
  const f = explorarPartidos(ventana({}, AHORA), AHORA).filas.find((x) => x.id === 't-demo')!;
  assert.equal(f.origen, 'demo');
  assert.equal(f.prediccion, null);
  assert.equal(f.sinPrediccion, 'demo');
});

test('T07: una distribución imposible en el registro no llega a la pantalla como predicción', () => {
  const r = explorarPartidos(ventana({}, AHORA), AHORA);
  const f = r.filas.find((x) => x.id === 'nhl-2')!;
  assert.equal(f.prediccion, null);
  assert.equal(f.sinPrediccion, 'invalida');
});

test('orden por hora con desempate estable, y el recuento por deporte cuadra con las filas', () => {
  const r = explorarPartidos(ventana({}, AHORA), AHORA);
  for (let i = 1; i < r.filas.length; i++) {
    const a = r.filas[i - 1];
    const b = r.filas[i];
    assert.ok(a.cuando < b.cuando || (a.cuando === b.cuando && `${a.sport}|${a.id}` <= `${b.sport}|${b.id}`));
  }
  const total = r.porDeporte.reduce((s, d) => s + d.filas, 0);
  assert.equal(total, r.filas.length);
  // Solo un deporte.
  const soloNhl = explorarPartidos({ ...ventana({}, AHORA), sports: ['nhl'] }, AHORA);
  assert.deepEqual([...new Set(soloNhl.filas.map((f) => f.sport))], ['nhl']);
});

test('GET /api/partidos responde con la lista y respeta deportes=', async () => {
  const { buildApp } = await import('../app.ts');
  const { configAuth } = await import('../auth/mode.ts');
  const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  const res = await app.inject({ method: 'GET', url: '/api/partidos?deportes=nhl,inventado' });
  assert.equal(res.statusCode, 200);
  const j = res.json() as { filas: { sport: string }[]; porDeporte: { sport: string }[] };
  assert.deepEqual(j.porDeporte.map((d) => d.sport), ['nhl']);
  await app.close();
});

test('B5: cada fila dice de dónde sale el partido (casa de apuestas, calendario o demostración), sin inventar lo que no se sabe', () => {
  const r = explorarPartidos(ventana({}, AHORA), AHORA);
  assert.equal(r.filas.find((x) => x.id === 'ev-real')?.fuenteCalendario, 'casa');
  assert.equal(r.filas.find((x) => x.id === 'ev-sin')?.fuenteCalendario, 'calendario');
  assert.equal(r.filas.find((x) => x.id === 'fixture-laliga-x-0')?.fuenteCalendario, 'demo');
  assert.equal(r.filas.find((x) => x.id === 'nhl-1')?.fuenteCalendario, 'casa');
});
