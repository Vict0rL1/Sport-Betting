// Seguimiento del PR #18, fase B: la contabilidad del riesgo de la cartera PERSONAL.
//
// Cada test de este fichero reproduce una pista del brief contra el código de partida (`92339dc`):
// coma flotante (R1), cashout sin importe tomado como 0 (R2), monedas sumadas (R3, R4), día de
// colocación en vez de liquidación (R5), corte de día con la hora del servidor (R7) y la fecha de
// liquidación reescrita al corregir un resultado (R8). El servidor corre en UTC y la política en
// Madrid, para que la medianoche de los dos no coincida.
process.env.TZ = 'UTC';
process.env.APP_TIMEZONE = 'Europe/Madrid';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { lossState, pendingExposure, DEFAULT_CONFIG } = await import('./policy.ts');
const { createBet, updateBet, getBet } = await import('../bets.ts');

const db = getDb();
// Miércoles 25 de noviembre de 2026, 13:00 en Madrid. La semana de la política empezó el lunes 23.
const AHORA = new Date('2026-11-25T12:00:00Z');

interface Fila {
  placed_on: string;
  created_at: string;
  settled_at: string | null;
  status: string;
  stake: number;
  odds: number;
  payout?: number | null;
  currency: string | null;
}

/** Una apuesta tal como podría estar en el registro (sin pasar por la API, para fijar las horas). */
function fila(f: Fila): void {
  db.prepare(
    `INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status, payout, settled_at, currency, tags)
     VALUES (?, ?, 'football', 'Partido', 'moneyline', 'Local', ?, ?, ?, ?, ?, ?, '[]')`,
  ).run(f.created_at, f.placed_on, f.odds, f.stake, f.status, f.payout ?? null, f.settled_at, f.currency);
}

beforeEach(() => {
  db.exec('DELETE FROM bets');
});

test('R1: el beneficio de los límites es el exacto, en céntimos (media ganada con céntimos impares)', () => {
  fila({ placed_on: '2026-11-25', created_at: '2026-11-25T08:00:00Z', settled_at: '2026-11-25T10:00:00Z', status: 'half_won', stake: 10.01, odds: 1.95, currency: 'EUR' });
  const r = lossState(1000, DEFAULT_CONFIG, AHORA, 'EUR');
  // Lo mismo que el registro y la exportación (dinero.ts, CASOS_DINERO): 4,75, no 4,75475.
  assert.equal(r.today, 4.75);
});

test('R2: un cashout sin importe no es un beneficio 0: el límite no se puede evaluar', () => {
  fila({ placed_on: '2026-11-25', created_at: '2026-11-25T08:00:00Z', settled_at: '2026-11-25T10:00:00Z', status: 'cashout', stake: 80, odds: 2, payout: null, currency: 'EUR' });
  const r = lossState(1000, DEFAULT_CONFIG, AHORA, 'EUR');
  assert.equal(r.dayBreached, false, 'no se sabe si se ha alcanzado');
  assert.equal(r.evaluable, false, 'y tampoco se puede decir que esté por debajo');
});

test('R3: las pérdidas en dólares no cuentan para un banco en euros', () => {
  fila({ placed_on: '2026-11-25', created_at: '2026-11-25T08:00:00Z', settled_at: '2026-11-25T10:00:00Z', status: 'lost', stake: 30, odds: 2, currency: 'EUR' });
  fila({ placed_on: '2026-11-25', created_at: '2026-11-25T08:00:00Z', settled_at: '2026-11-25T10:00:00Z', status: 'lost', stake: 30, odds: 2, currency: 'USD' });
  const r = lossState(1000, DEFAULT_CONFIG, AHORA, 'EUR');
  assert.equal(r.today, -30);
  assert.equal(r.dayBreached, false, '30 € de 50 € de límite diario');
});

test('R4: lo pendiente se cuenta por moneda', () => {
  fila({ placed_on: '2026-11-25', created_at: '2026-11-25T08:00:00Z', settled_at: null, status: 'pending', stake: 40, odds: 2, currency: 'EUR' });
  fila({ placed_on: '2026-11-25', created_at: '2026-11-25T08:00:00Z', settled_at: null, status: 'pending', stake: 70, odds: 2, currency: 'USD' });
  assert.equal(pendingExposure('EUR'), 40);
});

test('R5: una pérdida cuenta el día en que se liquidó, no el día en que se colocó', () => {
  // Colocada y registrada el martes como pendiente; liquidada hoy, miércoles.
  fila({ placed_on: '2026-11-24', created_at: '2026-11-24T18:00:00Z', settled_at: '2026-11-25T09:00:00Z', status: 'lost', stake: 60, odds: 2, currency: 'EUR' });
  const r = lossState(1000, DEFAULT_CONFIG, AHORA, 'EUR');
  assert.equal(r.today, -60);
  assert.equal(r.dayBreached, true, '60 € perdidos hoy contra 50 € de límite');
});

test('R5: una apuesta del domingo liquidada el lunes cuenta en ESTA semana', () => {
  fila({ placed_on: '2026-11-22', created_at: '2026-11-22T17:00:00Z', settled_at: '2026-11-23T09:00:00Z', status: 'lost', stake: 120, odds: 2, currency: 'EUR' });
  const r = lossState(1000, DEFAULT_CONFIG, AHORA, 'EUR');
  assert.equal(r.week, -120);
  assert.equal(r.weekBreached, true, '120 € contra 100 € de límite semanal');
});

test('R7: el día se corta a medianoche en la zona de la política, no en la del servidor', () => {
  // Las 00:30 del jueves 26 en Madrid son las 23:30 del miércoles 25 en UTC.
  const jueves = new Date('2026-11-25T23:30:00Z');
  // Liquidada a las 23:10 del miércoles en Madrid (22:10 UTC): es de AYER para la política.
  fila({ placed_on: '2026-11-25', created_at: '2026-11-25T20:00:00Z', settled_at: '2026-11-25T22:10:00Z', status: 'lost', stake: 60, odds: 2, currency: 'EUR' });
  const r = lossState(1000, DEFAULT_CONFIG, jueves, 'EUR');
  assert.equal(r.today, 0);
  assert.equal(r.dayBreached, false);
  assert.equal(r.week, -60, 'pero sí de esta semana');
});

test('R8: corregir el resultado de una apuesta ya liquidada no mueve su fecha de liquidación', () => {
  const b = createBet({ sport: 'football', event: 'Corregida', market: 'moneyline', selection: 'Local', odds: 2, stake: 10, currency: 'EUR' });
  updateBet(b.id, { status: 'won' });
  const liquidada = getBet(b.id)!.settled_at;
  assert.ok(liquidada);
  db.prepare('UPDATE bets SET settled_at = ? WHERE id = ?').run('2026-11-23T10:00:00.000Z', b.id);
  updateBet(b.id, { status: 'lost' });
  assert.equal(getBet(b.id)!.settled_at, '2026-11-23T10:00:00.000Z', 'se liquidó el lunes; corregirla hoy no la liquida hoy');
  updateBet(b.id, { status: 'pending' });
  assert.equal(getBet(b.id)!.settled_at, null, 'volver a pendiente sí quita la fecha');
});

test('de punta a punta: la cartera solo cuenta las apuestas de la moneda de su banco, y sin moneda no dice «por debajo»', async () => {
  const { buildApp } = await import('../app.ts');
  const { configAuth } = await import('../auth/mode.ts');
  const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  const hoy = new Date();
  const iso = (ms: number) => new Date(hoy.getTime() - ms).toISOString();
  // 200 $ y 20 € perdidos hace un segundo (registrados pendientes antes); 30 € y 500 $ pendientes. La
  // ruta usa el reloj real: un segundo deja fuera la medianoche de Madrid salvo por casualidad extrema.
  fila({ placed_on: '2026-11-01', created_at: iso(2_000), settled_at: iso(1_000), status: 'lost', stake: 200, odds: 2, currency: 'USD' });
  fila({ placed_on: '2026-11-01', created_at: iso(2_000), settled_at: iso(1_000), status: 'lost', stake: 20, odds: 2, currency: 'EUR' });
  fila({ placed_on: '2026-11-01', created_at: iso(2_000), settled_at: null, status: 'pending', stake: 30, odds: 2, currency: 'EUR' });
  fila({ placed_on: '2026-11-01', created_at: iso(2_000), settled_at: null, status: 'pending', stake: 500, odds: 2, currency: 'USD' });

  const eur = (await app.inject({ method: 'GET', url: '/api/staking/book?bankroll=1000&moneda=EUR' })).json();
  assert.equal(eur.moneda, 'EUR');
  assert.equal(eur.loss.today, -20, 'los 200 $ no son de este banco');
  assert.equal(eur.loss.dayBreached, false);
  assert.equal(eur.loss.evaluable, true);
  assert.deepEqual([eur.exposicion.segura, eur.exposicion.maxima], [30, 30]);

  const usd = (await app.inject({ method: 'GET', url: '/api/staking/book?bankroll=1000&moneda=USD' })).json();
  assert.equal(usd.loss.dayBreached, true, '200 $ contra 50 $ de límite diario');

  const sin = (await app.inject({ method: 'GET', url: '/api/staking/book?bankroll=1000' })).json();
  assert.equal(sin.moneda, null);
  assert.equal(sin.loss.evaluable, false, 'sin moneda no se sabe qué apuestas son del banco');
  assert.equal(sin.loss.dayBreached, false, 'tampoco se dice «alcanzado»');
  assert.deepEqual(sin.loss.estado.incidencias, [{ codigo: 'banco-sin-moneda', apuestas: 2 }]);

  assert.equal((await app.inject({ method: 'GET', url: '/api/staking/book?bankroll=1000&moneda=JPY' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/staking/book?bankroll=10.005&moneda=EUR' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/api/staking/book?bankroll=abc&moneda=EUR' })).statusCode, 400);
  await app.close();
});

test('R8b (data-guardian): una liquidada SIN fecha que se corrige sigue sin fecha; no se inventa «hoy»', () => {
  fila({ placed_on: '2026-11-02', created_at: '2026-11-02T08:00:00Z', settled_at: null, status: 'won', stake: 10, odds: 2, currency: 'EUR' });
  const id = (db.prepare('SELECT MAX(id) AS id FROM bets').get() as { id: number }).id;
  updateBet(id, { status: 'lost' });
  assert.equal(getBet(id)!.settled_at, null);
  updateBet(id, { status: 'lost' });
  assert.equal(getBet(id)!.settled_at, null, 'reenviar el mismo estado tampoco');
});

test('R9 (quant): lo pendiente cuenta en el tope del día de SU partido; sin día conocido, en cualquier día', async () => {
  const { decideBook } = await import('./book.ts');
  const { estadoDePerdidas } = await import('./policy.ts');
  const cal = { football: { multiplier: 1, reason: 'prueba', ece: 0, n: 0 } } as never;
  const cands = ['a', 'b', 'c'].map((k, i) => ({ key: k, label: k, sport: 'football', league: `lg${i}`, day: '2026-11-28', matchKey: `m${k}`, market: '1x2' as const, side: 'canonica' as const, p: 0.6, odds: 2.2 }));
  const limites = estadoDePerdidas(1000, DEFAULT_CONFIG, { hoy: 0, semana: 0 });
  const viernes = new Date('2026-11-27T12:00:00Z');
  // 30 € colocados el viernes para un partido del sábado, sin enlace: no se sabe el día del partido.
  fila({ placed_on: '2026-11-27', created_at: '2026-11-27T09:00:00Z', settled_at: null, status: 'pending', stake: 30, odds: 2, currency: 'EUR' });
  const bk = decideBook(cands, 1000, DEFAULT_CONFIG, cal, viernes, 'EUR', { limites });
  const sabado = bk.entries.reduce((a, e) => a + e.stake, 0);
  assert.ok(sabado + 30 <= 60 + 1e-9, `el sábado queda en ${sabado + 30} € contra un tope diario de 60 €`);
  assert.ok(bk.caps.some((c) => c.scope === 'día 2026-11-28'), 'y se dice qué tope recortó');
  assert.ok(bk.notes.some((n) => /sin día de partido conocido/.test(n)), bk.notes.join(' | '));

  // Enlazada a una estimación de un partido del DOMINGO: no ocupa el tope del sábado.
  db.exec('DELETE FROM bets');
  const snap = db
    .prepare(
      `INSERT INTO prediction_snapshots (sport, match_key, event_id, commence_time, captured_at, outcomes, probs, model_version, inputs)
       VALUES ('football', 'k-dom', 'e-dom', '2026-11-29T15:00:00Z', '2026-11-27T08:00:00Z', '["A","Empate","B"]', '[0.5,0.3,0.2]', 'v', '{"usaMercado":false,"entradas":{}}')`,
    )
    .run();
  fila({ placed_on: '2026-11-27', created_at: '2026-11-27T09:00:00Z', settled_at: null, status: 'pending', stake: 30, odds: 2, currency: 'EUR' });
  db.prepare('UPDATE bets SET snapshot_id = ? WHERE status = ?').run(Number(snap.lastInsertRowid), 'pending');
  const bk2 = decideBook(cands, 1000, DEFAULT_CONFIG, cal, viernes, 'EUR', { limites });
  assert.equal(bk2.caps.filter((c) => c.scope.startsWith('día')).length, 0, 'el domingo no recorta el sábado');
});

test('lo ya en juego sin cota sale como null con su marca, no como 0 (quant)', async () => {
  const { buildApp } = await import('../app.ts');
  const { configAuth } = await import('../auth/mode.ts');
  const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  fila({ placed_on: '2026-11-01', created_at: '2026-11-01T08:00:00Z', settled_at: null, status: 'pending', stake: 0, odds: 2, currency: 'EUR' });
  const r = (await app.inject({ method: 'GET', url: '/api/staking/book?bankroll=1000&moneda=EUR' })).json();
  assert.equal(r.exposicion.maxima, null, 'un importe pendiente ilegible no tiene cota');
  assert.deepEqual(r.exposicion.incidencias, [{ codigo: 'importe-invalido', apuestas: 1 }]);
  await app.close();
});
