// Mis apuestas (rediseño de noviembre, D8): pago bruto y neto con céntimos exactos, «push» como
// devolución íntegra, una moneda por apuesta y ningún total que sume monedas distintas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { createBet, getBet, summarizeBets, payoutOf, profitOf } = await import('../bets.ts');
const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
const { getDb } = await import('../db.ts');

const base = { sport: 'football', event: 'A vs B', market: 'moneyline', selection: 'A', placed_on: '2026-11-01' } as const;

test('T27: 100 a 2,06 ganada → pago 206 y neto 106, sin error de coma flotante', () => {
  const b = createBet({ ...base, odds: 2.06, stake: 100, status: 'won', currency: 'EUR' });
  assert.equal(b.payoutGross, 206);
  assert.equal(b.profit, 106);
  assert.equal(b.currency, 'EUR');
});

test('T28: perdida 0 / −100; anulada y push 100 / 0; pendiente sin pago ni beneficio', () => {
  const row = { odds: 2.06, stake: 100, payout: null };
  assert.equal(payoutOf({ ...row, status: 'lost' }), 0);
  assert.equal(profitOf({ ...row, status: 'lost' }), -100);
  assert.equal(payoutOf({ ...row, status: 'void' }), 100);
  assert.equal(profitOf({ ...row, status: 'void' }), 0);
  assert.equal(payoutOf({ ...row, status: 'push' }), 100);
  assert.equal(profitOf({ ...row, status: 'push' }), 0);
  assert.equal(payoutOf({ ...row, status: 'pending' }), null);
  assert.equal(profitOf({ ...row, status: 'pending' }), null);
  assert.equal(payoutOf({ ...row, status: 'half_won' }), 153);
  assert.equal(profitOf({ ...row, status: 'half_won' }), 53);
  assert.equal(payoutOf({ odds: 2.06, stake: 100, payout: 80, status: 'cashout' }), 80);
  // Un push no cuenta como apuesta arriesgada en el ROI.
  const p = createBet({ ...base, odds: 1.9, stake: 50, status: 'push', currency: 'EUR' });
  assert.equal(p.risked, 0);
});

test('T29: con dos monedas no hay un total que las sume; cada una por separado', () => {
  getDb().exec('DELETE FROM bets');
  createBet({ ...base, odds: 2, stake: 100, status: 'won', currency: 'EUR' });
  createBet({ ...base, odds: 2, stake: 10, status: 'lost', currency: 'EUR' });
  createBet({ ...base, odds: 3, stake: 50, status: 'won', currency: 'USD' });
  const s = summarizeBets();
  assert.deepEqual(s.monedas.map((m) => [m.moneda, m.apuestas]).sort(), [['EUR', 2], ['USD', 1]]);
  // Sin filtro, el resumen es el de UNA moneda (la de más apuestas) y lo dice.
  assert.equal(s.moneda, 'EUR');
  assert.equal(s.totals.profit, 90);
  assert.equal(s.totals.staked, 110);
  const usd = summarizeBets({ currency: 'USD' });
  assert.equal(usd.moneda, 'USD');
  assert.equal(usd.totals.profit, 100);
  // Las antiguas sin moneda son su propio grupo: no se suman a los euros.
  getDb().prepare("INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status) VALUES ('2026-10-01T00:00:00Z', '2026-10-01', 'tennis', 'C vs D', 'moneyline', 'C', 2, 1000, 'won')").run();
  const sinMoneda = summarizeBets({ currency: 'none' });
  assert.equal(sinMoneda.moneda, null);
  assert.equal(sinMoneda.totals.staked, 1000);
  assert.equal(summarizeBets({ currency: 'EUR' }).totals.staked, 110);
});

test('T32: la API rechaza cuotas e importes inválidos, más de 2 decimales y monedas sin soporte', async () => {
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  const post = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/bets', payload: { ...base, odds: 2, stake: 10, currency: 'EUR', ...body } });
  for (const [campo, valor] of [['odds', 'NaN'], ['odds', 'Infinity'], ['odds', 0], ['odds', 1], ['stake', -5], ['stake', 0], ['stake', '10.005'], ['stake', 'Infinity'], ['currency', 'BTC'], ['currency', 'eur ']] as const) {
    const r = await post({ [campo]: valor });
    assert.equal(r.statusCode, 400, `${campo}=${valor}`);
    const j = r.json() as { errors: { field: string }[] };
    assert.ok(j.errors.some((x) => x.field === campo), `${campo}=${valor}: ${r.body}`);
  }
  const ok = await post({ stake: '12,50' });
  assert.equal(ok.statusCode, 201, ok.body);
  const creada = getBet((ok.json() as { id: number }).id)!;
  assert.equal(creada.stake, 12.5);
  assert.equal(creada.currency, 'EUR');
  await app.close();
});
