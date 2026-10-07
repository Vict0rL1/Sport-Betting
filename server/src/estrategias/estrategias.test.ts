// El laboratorio de estrategias: crear, apostar en paralelo, lo que NO se puede tocar, liquidar
// y comparar con los avisos de muestra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { crearEstrategia, archivarEstrategia, colocarEstrategias, liquidarEstrategias, compararEstrategias, configDe, bancoDe, perdidasDe, listarEstrategias } = await import('./index.ts');
const { decideStake, DEFAULT_CONFIG } = await import('../staking/policy.ts');

const db = getDb();
const H = 3_600_000;
const ahora = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const INICIO = iso(ahora + 48 * H);

// Un partido con cuotas REALES y su predicción registrada, como en paper/bankroll.test.ts.
db.prepare(
  `INSERT INTO fb_upcoming (id, league, commence_time, home_name, away_name, home_id, away_id, odds_home, odds_draw, odds_away, books, source, updated_at)
   VALUES ('lab-arsenal-chelsea', 'epl', ?, 'Arsenal', 'Chelsea', 'ars', 'che', 2.5, 3.4, 3.0, 6, 'live', ?)`,
).run(INICIO, iso(ahora - 30 * 60_000));
db.prepare(
  `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
     prob_home, prob_draw, prob_away, shown_home, shown_draw, shown_away,
     market_prob_home, market_prob_draw, market_prob_away, reliability, predicted_at)
   VALUES ('lab|ars|che', 'epl', 'lab-arsenal-chelsea', ?, 'ars', 'che', 'Arsenal', 'Chelsea',
     0.54, 0.24, 0.22, 0.52, 0.25, 0.23, 0.385, 0.283, 0.332, 'high', ?)`,
).run(INICIO, iso(ahora - 1 * H));
// Un partido de DEMOSTRACIÓN: ninguna estrategia puede apostarlo.
db.prepare(
  `INSERT INTO fb_upcoming (id, league, commence_time, home_name, away_name, home_id, away_id, odds_home, odds_draw, odds_away, books, source, updated_at)
   VALUES ('lab-demo', 'epl', ?, 'Leeds', 'Fulham', 'lee', 'ful', 1.5, 4.0, 7.0, 1, 'fixture', ?)`,
).run(INICIO, iso(ahora - 30 * 60_000));
db.prepare(
  `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
     prob_home, prob_draw, prob_away, market_prob_home, market_prob_draw, market_prob_away, reliability, predicted_at)
   VALUES ('lab|lee|ful', 'epl', 'lab-demo', ?, 'lee', 'ful', 'Leeds', 'Fulham', 0.9, 0.05, 0.05, 0.6, 0.25, 0.15, 'high', ?)`,
).run(INICIO, iso(ahora - 1 * H));

test('configDe: la política vigente con los cambios, y lo que no tiene sentido se rechaza', () => {
  const c = configDe({ nombre: 'x', staking: { minEdge: 0.05 } });
  assert.equal(c.staking.minEdge, 0.05);
  assert.equal(c.staking.kellyFraction, DEFAULT_CONFIG.kellyFraction);
  assert.deepEqual(c.mercados, ['h2h']);
  assert.equal(c.confianza, true);
  assert.equal(c.calibracion, true);
  assert.throws(() => configDe({ nombre: 'x', staking: { kellyFraction: 0.5 as never } }), /kellyFraction/);
  assert.throws(() => configDe({ nombre: 'x', deportes: ['curling'] }), /curling/);
  assert.throws(() => configDe({ nombre: 'x', deportes: [] }), /al menos uno/);
  assert.throws(() => configDe({ nombre: 'x', mercados: ['totals'] }), /solo ganador/);
  assert.throws(() => configDe({ nombre: 'x', staking: { inventada: 1 } as never }), /desconocida/);
});

test('decideStake con pérdidas explícitas no mira el registro personal', () => {
  const sin = decideStake({ sport: 'football', p: 0.6, odds: 2.0, bankroll: 1000, openExposure: 0, perdidas: { hoy: 0, semana: 0 } }, DEFAULT_CONFIG, { football: { ece: 0, n: 1, beatsMarket: true, vsMarketLogLoss: null, measuredAt: '' } });
  assert.ok(sin.stake > 0);
  const corte = decideStake({ sport: 'football', p: 0.6, odds: 2.0, bankroll: 1000, openExposure: 0, perdidas: { hoy: -60, semana: -60 } }, DEFAULT_CONFIG, { football: { ece: 0, n: 1, beatsMarket: true, vsMarketLogLoss: null, measuredAt: '' } });
  assert.equal(corte.stake, 0);
  assert.match(String(corte.blockedBy), /DIARIA/);
});

let id = 0;
let exigente = 0;
test('crear: nombre y configuración únicos entre las activas', () => {
  // Sin capa de confianza (no hay evaluación registrada en este test) y sin freno de calibración.
  id = crearEstrategia({ nombre: 'Agresiva', deportes: ['football'], confianza: false, calibracion: false, staking: { minEdge: 0.01 } }).id;
  exigente = crearEstrategia({ nombre: 'Exigente', deportes: ['football'], confianza: false, calibracion: false, staking: { minEdge: 0.4 } }).id;
  assert.throws(() => crearEstrategia({ nombre: 'agresiva', deportes: ['football'] }), /ya hay una estrategia activa llamada/);
  assert.throws(() => crearEstrategia({ nombre: 'Otra', deportes: ['football'], confianza: false, calibracion: false, staking: { minEdge: 0.01 } }), /exactamente esta configuración/);
  assert.throws(() => crearEstrategia({ nombre: 'x' }), /entre 2 y 60/);
});

test('apuesta en paralelo sobre las mismas candidatas, nunca sobre cuotas de demostración', () => {
  const pasadas = colocarEstrategias(new Date(ahora));
  const agresiva = pasadas.find((p) => p.id === id)!;
  assert.equal(agresiva.colocadas, 1, JSON.stringify(pasadas));
  const exig = pasadas.find((p) => p.id === exigente)!;
  assert.equal(exig.colocadas, 0);
  assert.ok(Object.keys(exig.rechazos).length > 0);
  const a = db.prepare('SELECT * FROM strategy_bets WHERE strategy_id = ?').get(id) as Record<string, unknown>;
  assert.equal(a.event_id, 'lab-arsenal-chelsea');
  assert.equal(a.selection, 'Arsenal');
  assert.equal(a.odds, 2.5);
  assert.equal(a.bankroll_at, 1000);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM strategy_bets WHERE event_id = 'lab-demo'").get()!.n, 0, 'nunca contra precios inventados');
  // Una segunda pasada no duplica.
  colocarEstrategias(new Date(ahora));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM strategy_bets WHERE strategy_id = ?').get(id)!.n, 1);
  // El banco principal no se entera: son registros distintos.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM paper_bets WHERE event_id = 'lab-arsenal-chelsea'").get()!.n, 0);
});

test('lo apostado queda congelado y no se borra; una estrategia no se edita', () => {
  assert.throws(() => db.prepare('UPDATE strategy_bets SET stake = 1 WHERE strategy_id = ?').run(id), /congelados/);
  assert.throws(() => db.prepare('UPDATE strategy_bets SET odds = 9 WHERE strategy_id = ?').run(id), /congelados/);
  assert.throws(() => db.prepare('DELETE FROM strategy_bets WHERE strategy_id = ?').run(id), /no se borra/);
  assert.throws(() => db.prepare("UPDATE strategies SET config = '{}' WHERE id = ?").run(id), /no se edita/);
  assert.throws(() => db.prepare('DELETE FROM strategies WHERE id = ?').run(id), /no se borra/);
  assert.throws(
    () => db.prepare("INSERT INTO strategy_bets (strategy_id, placed_at, sport, match_key, event_id, label, selection, commence_time, p_model, p_market, odds, edge, stake, bankroll_at) VALUES (?, ?, 'football', 'k', 'e', 'l', 's', ?, 0.5, 0.5, 2, 0, 10, 1000)").run(id, iso(ahora), iso(ahora - H)),
    /alta inválida/,
    'una apuesta posterior al inicio no entra',
  );
});

test('se liquida una vez con el resultado real, y el banco de la estrategia se mueve solo', () => {
  db.prepare("UPDATE fb_prediction_log SET home_goals = 2, away_goals = 0, resolved_at = ? WHERE match_key = 'lab|ars|che'").run(iso(ahora));
  const r = liquidarEstrategias(new Date(ahora + 72 * H));
  assert.equal(r.liquidadas, 1);
  const a = db.prepare('SELECT * FROM strategy_bets WHERE strategy_id = ?').get(id) as Record<string, number | string>;
  assert.equal(a.status, 'won');
  assert.ok((a.profit as number) > 0);
  assert.equal(bancoDe(id), 1000 + (a.profit as number));
  assert.equal(bancoDe(exigente), 1000);
  assert.throws(() => db.prepare("UPDATE strategy_bets SET status = 'lost', profit = -1 WHERE strategy_id = ?").run(id), /no se vuelve a liquidar/);
  assert.equal(liquidarEstrategias(new Date(ahora + 73 * H)).liquidadas, 0);
  const p = perdidasDe(id, new Date(ahora + 72 * H));
  assert.ok(p.semana > 0, 'lo realizado esta semana cuenta para los límites de esta estrategia');
});

test('comparar: el banco principal como referencia y ninguna conclusión con menos de 30 apuestas', () => {
  const { filas } = compararEstrategias();
  assert.equal(filas[0].id, null);
  const f = filas.find((x) => x.id === id)!;
  assert.equal(f.liquidadas, 1);
  assert.equal(f.ganadas, 1);
  assert.equal(f.acierto, 1);
  assert.equal(f.comparable, false);
  assert.equal(f.aviso.nivel, 'insuficiente');
  assert.ok(f.roi != null && f.roi > 0);
});

test('archivar: una vez, y deja de apostar', () => {
  archivarEstrategia(id);
  assert.throws(() => archivarEstrategia(id), /ya está archivada/);
  assert.ok(!listarEstrategias(false).some((e) => e.id === id));
  assert.ok(colocarEstrategias(new Date(ahora)).every((p) => p.id !== id));
});
