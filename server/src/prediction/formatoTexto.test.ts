// G5 (prueba en el navegador, 9 de octubre): el texto que escribe el servidor va en español y la
// web lo pinta tal cual («Lectura completa», el titular, los avisos de fiabilidad). Antes cada
// deporte hacía `(p * 100).toFixed(1)` y pegaba el «%»: «41.6%» al lado del «41,2 %» de la web.
// Se construye una predicción de cada deporte con una base temporal mínima y se lee todo su texto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { seedDatabase } = await import('../ingest/seed.ts');

/** Un separador de miles («20.214») no es un decimal: tres cifras tras el punto y otra delante que no sea 0. */
const DECIMAL_CON_PUNTO = /(?<![\w.,])(?:0\.\d+|\d+\.(?!\d{3}(?!\d))\d+)/;
/** El «%» va separado del número (con espacio duro en lo que escribe `numeros.ts`). */
const PORCIENTO_MAL = /\d%/;

function textos(x: unknown, ruta = '', out: [string, string][] = []): [string, string][] {
  if (typeof x === 'string') out.push([ruta, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => textos(v, `${ruta}[${i}]`, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) textos(v, ruta ? `${ruta}.${k}` : k, out);
  return out;
}
function malEscritos(p: unknown): string[] {
  return textos(p)
    .filter(([, s]) => DECIMAL_CON_PUNTO.test(s) || PORCIENTO_MAL.test(s))
    .map(([r, s]) => `${r}: ${s}`);
}

test('G5: tenis, fútbol, baloncesto, béisbol y NFL escriben sus números en español', async () => {
  const db = getDb();
  seedDatabase();
  const { buildPrediction: tenis } = await import('../model/predict.ts');
  const jugadores = db.prepare("SELECT id FROM players WHERE tour = 'atp' LIMIT 2").all() as { id: number }[];
  const t = tenis('atp', jugadores[0].id, jugadores[1].id, 'Hard', { odds1: 1.35, odds2: 3.25 }, 5, 'Wimbledon');

  for (const [id, nombre] of [['ars', 'Arsenal'], ['che', 'Chelsea']]) db.prepare("INSERT INTO fb_teams (id, league, name) VALUES (?, 'epl', ?)").run(id, nombre);
  for (const [id, e] of [['ars', 1700], ['che', 1650]] as const) db.prepare("INSERT INTO fb_team_ratings (team_id, league, elo, matches_played) VALUES (?, 'epl', ?, 38)").run(id, e);
  const partido = db.prepare("INSERT INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result) VALUES ('epl', 2025, ?, ?, ?, ?, ?, ?)");
  for (let i = 0; i < 20; i++) {
    const [gl, gv] = [i % 3, (i + 1) % 2];
    partido.run(`2025-0${1 + (i % 9)}-1${i % 10}`, i % 2 ? 'ars' : 'che', i % 2 ? 'che' : 'ars', gl, gv, gl > gv ? 'H' : gl < gv ? 'A' : 'D');
  }
  const { buildFootballPrediction } = await import('../football/predict.ts');
  const f = buildFootballPrediction('epl', 'ars', 'che', { oddsHome: 1.9, oddsDraw: 3.6, oddsAway: 4.2 });

  const { buildGamePrediction } = await import('../basketball/predict.ts');
  const b = buildGamePrediction('nba' as never, 'BOS', 'NYK', { homeOdds: 1.6, awayOdds: 2.4 });
  const { buildBaseballPrediction } = await import('../baseball/predict.ts');
  const m = buildBaseballPrediction('mlb' as never, 'NYY', 'BOS', { oddsHome: 1.8, oddsAway: 2.1 });

  for (const [id, nombre] of [['KC', 'Kansas City Chiefs'], ['BUF', 'Buffalo Bills']]) db.prepare("INSERT INTO naf_teams (id, league, name) VALUES (?, 'nfl', ?)").run(id, nombre);
  const { buildPrediction: nfl } = await import('../nfl/predict.ts');
  const n = nfl({ league: 'nfl' as never, homeId: 'KC', awayId: 'BUF', oddsHome: 1.7, oddsAway: 2.2, spreadLine: -3.5, totalLine: 47.5 });
  assert.ok(n, 'la NFL construye la predicción');

  // G5b (segunda pasada de ui-tester): no solo el resumen. TODO el texto de la predicción y de su
  // evaluación de confianza (escenarios, supuestos, razones, datos): ahí quedaban «×0.75»,
  // «+42.5 pts», «factor 0.98», «(16.5 puntos)».
  const { evaluar } = await import('../trust/assess.ts');
  const A = await import('../trust/adapters.ts');
  const fila = { id: 'ev', league: 'x', commence_time: new Date(Date.now() + 26 * 3_600_000).toISOString(), home_name: 'Local', away_name: 'Visitante', home_id: 'h', away_id: 'a', odds_home: 1.9, odds_draw: 3.4, odds_away: 2.1, books: 6, source: 'live', updated_at: new Date().toISOString(), spread_line: -3.5, total_line: 47.5, season: 2026, home_sp: null, away_sp: null };
  const filaTenis = db.prepare("SELECT * FROM upcoming_matches WHERE tour = 'atp' LIMIT 1").get() ?? { ...fila, tour: 'atp', p1_id: jugadores[0].id, p2_id: jugadores[1].id, odds1: 1.35, odds2: 3.25, surface: 'Hard' };
  const eventos = [
    ['tenis', A.confianzaTenis(filaTenis as never, t)],
    ['fútbol', A.confianzaFutbol({ ...fila, league: 'epl', home_id: 'ars', away_id: 'che', home_name: 'Arsenal', away_name: 'Chelsea' } as never, f)],
    ['baloncesto', A.confianzaBaloncesto({ ...fila, league: 'nba' } as never, b)],
    ['béisbol', A.confianzaBeisbol({ ...fila, league: 'mlb' } as never, m)],
    ['nfl', A.confianzaNfl({ ...fila, league: 'nfl' } as never, n)],
  ] as const;
  const completas: string[] = [];
  for (const [deporte, e] of eventos) {
    assert.ok(e, `${deporte}: evento de confianza`);
    completas.push(...malEscritos(evaluar(e)).map((s) => `${deporte} confianza ${s}`));
  }
  completas.push(...malEscritos(t).map((s) => `tenis ${s}`), ...malEscritos(f).map((s) => `fútbol ${s}`), ...malEscritos(b).map((s) => `baloncesto ${s}`), ...malEscritos(m).map((s) => `béisbol ${s}`), ...malEscritos(n).map((s) => `nfl ${s}`));

  const malas = [...completas,
    ...malEscritos(t.summary ?? t).map((s) => `tenis ${s}`),
    ...malEscritos(f.summary).map((s) => `fútbol ${s}`),
    ...malEscritos([b.summary, b.reasoning.text, b.reliability.reasons]).map((s) => `baloncesto ${s}`),
    ...malEscritos([m.summary, m.reliability.reasons]).map((s) => `béisbol ${s}`),
    ...malEscritos(n.summary ?? n).map((s) => `nfl ${s}`),
  ];
  assert.deepEqual(malas, []);
});

test('G5b: los avisos (bandeja, notificaciones) escriben sus porcentajes en español', async () => {
  const { deInstantanea } = await import('../alerts/detectors.ts');
  const antes = { probs: [0.448, 0.552], market_probs: [0.822, 0.178], entradas: {} };
  const despues = { probs: [0.415, 0.585], market_probs: [0.746, 0.254], entradas: {}, outcomes: ['Tampa Bay Buccaneers', 'Atlanta Falcons'] };
  const avisos = deInstantanea(antes, despues, 'TB vs ATL');
  assert.equal(avisos.length, 2);
  assert.deepEqual(avisos.flatMap((a) => [a.title, a.body]).filter((s) => DECIMAL_CON_PUNTO.test(s ?? '')), []);
  assert.equal(avisos[0].body, 'Tampa Bay Buccaneers: 44,8 % → 41,5 %');
});

test('G5b: ningún texto de aviso, confianza o banco de papel escribe un número con toFixed a pelo', async () => {
  const fs = await import('node:fs');
  const malas: string[] = [];
  for (const f of ['../alerts/detectors.ts', '../trust/perturbation.ts', '../trust/adapters.ts', '../paper/bankroll.ts']) {
    const fuente = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    fuente.split('\n').forEach((l, i) => {
      if (/\$\{[^`]*?\.toFixed\(\d\)(?!\.replace)/.test(l)) malas.push(`${f}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(malas, []);
});
