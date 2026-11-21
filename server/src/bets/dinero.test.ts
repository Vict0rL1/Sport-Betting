// B2 (revisión del PR 17): el dinero se calcula con aritmética decimal exacta y se redondea al
// céntimo más cercano, la mitad hacia arriba, una sola vez. Con coma flotante, 1,02 × 1,25 daba
// 1,27 (1,2749999…) y 1,05 × 2,30 daba 2,41 (2,4149999…), y la vista previa del formulario y el
// servidor no coincidían. Los mismos casos se comprueban en web/src/lib/dinero.test.ts contra este
// mismo módulo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { createBet, summarizeBets, payoutOf, profitOf, riskedOf } = await import('../bets.ts');
const { aCentimos, cuotaRacional, pagoEnCentimos, CASOS_DINERO } = await import('../dinero.ts');

const fila = (stake: number, odds: number, status: string, payout: number | null = null) => ({ stake, odds, status, payout }) as Parameters<typeof payoutOf>[0];

test('B2: 1,02 a 1,25 ganada paga 1,28 y 1,05 a 2,30 paga 2,42 (al céntimo, la mitad hacia arriba)', () => {
  assert.equal(payoutOf(fila(1.02, 1.25, 'won')), 1.28);
  assert.equal(profitOf(fila(1.02, 1.25, 'won')), 0.26);
  assert.equal(payoutOf(fila(1.05, 2.3, 'won')), 2.42);
  assert.equal(profitOf(fila(1.05, 2.3, 'won')), 1.37);
});

test('B2: la tabla común (servidor y vista previa) se cumple en el servidor', () => {
  for (const c of CASOS_DINERO) {
    assert.equal(payoutOf(fila(c.stake, c.odds, c.estado, c.cashout ?? null)), c.pago, `${c.stake} × ${c.odds} ${c.estado}: pago`);
    assert.equal(profitOf(fila(c.stake, c.odds, c.estado, c.cashout ?? null)), c.neto, `${c.stake} × ${c.odds} ${c.estado}: neto`);
  }
});

test('B2: medias liquidaciones con céntimos impares', () => {
  // 10,01 a 1,95 media ganada: 5,005 × 1,95 + 5,005 = 14,76475 → 14,76.
  assert.equal(payoutOf(fila(10.01, 1.95, 'half_won')), 14.76);
  assert.equal(profitOf(fila(10.01, 1.95, 'half_won')), 4.75);
  // 10,01 media perdida: vuelve 5,005 → 5,01; se pierden 5,00.
  assert.equal(payoutOf(fila(10.01, 1.95, 'half_lost')), 5.01);
  assert.equal(profitOf(fila(10.01, 1.95, 'half_lost')), -5);
  // Lo arriesgado en una media es lo que se puede perder: apuesta − lo que vuelve en la media perdida
  // (revisión quant, L1). Así el ROI de una media perdida es −100 % exacto.
  assert.equal(riskedOf({ stake: 10.01, status: 'half_lost' }), 5);
  assert.equal(riskedOf({ stake: 10.01, status: 'half_won' }), 5);
  // 0,03 a 1,5 media ganada: 0,015 × 1,5 + 0,015 = 0,0375 → 0,04.
  assert.equal(payoutOf(fila(0.03, 1.5, 'half_won')), 0.04);
});

test('B2: la precisión de la cuota se respeta tal como se escribió', () => {
  assert.deepEqual(cuotaRacional(2.3), { n: 23n, d: 10n });
  assert.deepEqual(cuotaRacional(1.333), { n: 1333n, d: 1000n });
  // 3 × 1,005 = 3,015 exacto → 3,02 (en coma flotante, 3,0149999…).
  assert.equal(pagoEnCentimos(aCentimos(3)!, cuotaRacional(1.005)!), 302);
  assert.equal(cuotaRacional(Number.NaN), null);
  assert.equal(cuotaRacional(1e21), null);
  assert.equal(aCentimos(10.005), null, 'más de dos decimales no es un importe');
  assert.equal(aCentimos(-1), null);
});

test('B2: los totales suman céntimos exactos y nunca mezclan monedas', () => {
  for (let i = 0; i < 10; i++) createBet({ sport: 'football', event: `E${i}`, market: 'moneyline', selection: 'A', placed_on: '2026-11-02', odds: 1.25, stake: 1.02, status: 'won', currency: 'USD' });
  createBet({ sport: 'football', event: 'E-gbp', market: 'moneyline', selection: 'A', placed_on: '2026-11-02', odds: 2.3, stake: 1.05, status: 'won', currency: 'GBP' });
  const usd = summarizeBets({ currency: 'USD' });
  assert.equal(usd.totals.profit, 2.6, 'diez veces 0,26, no 2,5999…');
  assert.equal(usd.moneda, 'USD');
  const gbp = summarizeBets({ currency: 'GBP' });
  assert.equal(gbp.totals.profit, 1.37);
});

test('B2: la exportación de apuestas lleva el mismo pago y neto que la API, y se puede volver a importar', async () => {
  const { exportar, aCsv } = await import('../exports/datasets.ts');
  const { importarCsv } = await import('./importar.ts');
  const e = exportar('apuestas');
  const fila = e.datos.find((d) => d.event === 'E-gbp');
  assert.ok(fila);
  assert.equal(fila.pago_bruto, 2.42);
  assert.equal(fila.neto, 1.37);
  assert.ok(e.columnas.includes('pago_bruto') && e.columnas.includes('neto'));
  const solo = e.datos.filter((d) => d.event === 'E-gbp');
  const r = importarCsv(aCsv(e.columnas, solo), (input) => createBet(input));
  assert.equal(r.rechazadas.length, 0, JSON.stringify(r.rechazadas));
  assert.equal(r.importadas, 1);
  const { getBet } = await import('../bets.ts');
  assert.equal(getBet(r.ids[0])?.payoutGross, 2.42, 'las columnas calculadas no se importan: se recalculan');
});

test('B2 (revisión quant L1/L2): ROI exacto en medias y una apuesta antigua de 1,005 suma lo mismo en apostado, arriesgado y beneficio', async () => {
  const { getDb } = await import('../db.ts');
  createBet({ sport: 'tennis', event: 'Media', market: 'moneyline', selection: 'A', placed_on: '2026-11-03', odds: 1.95, stake: 10.01, status: 'half_lost', currency: 'EUR' });
  const eur = summarizeBets({ currency: 'EUR' });
  assert.equal(eur.totals.roi, -1, 'una media perdida pierde todo lo arriesgado');
  // Una apuesta guardada antes de la validación de dos decimales (no se reescribe: se lee tal cual).
  getDb().prepare("INSERT INTO bets (placed_on, sport, event, market, selection, odds, stake, status, currency, created_at) VALUES ('2026-11-04', 'tennis', 'Antigua', 'moneyline', 'A', 1.9, 1.005, 'lost', 'GBP', '2026-11-04T10:00:00Z')").run();
  const gbp = summarizeBets({ currency: 'GBP' });
  const antigua = gbp.daily.find((d) => d.day === '2026-11-04')!;
  assert.equal(antigua.staked, 1.01);
  assert.equal(antigua.profit, -1.01);
});

test('Ida y vuelta por CSV (data-guardian): las etiquetas exportadas vuelven como etiquetas, no como una sola', async () => {
  const { exportar, aCsv } = await import('../exports/datasets.ts');
  const { importarCsv } = await import('./importar.ts');
  const { getBet } = await import('../bets.ts');
  createBet({ sport: 'tennis', event: 'Con etiquetas', market: 'moneyline', selection: 'A', placed_on: '2026-11-05', odds: 1.9, stake: 5, status: 'pending', currency: 'EUR', tags: ['valor', 'directo, en vivo'] });
  const e = exportar('apuestas');
  const fila = e.datos.filter((d) => d.event === 'Con etiquetas');
  const r = importarCsv(aCsv(e.columnas, fila), (input) => createBet(input));
  assert.equal(r.rechazadas.length, 0, JSON.stringify(r.rechazadas));
  assert.deepEqual(getBet(r.ids[0])?.tags, ['valor', 'directo, en vivo']);
  // Y una lista escrita a mano con comas o punto y coma sigue valiendo.
  const aMano = importarCsv('placed_on,sport,event,market,selection,odds,stake,tags\n2026-11-05,tennis,A mano,moneyline,A,1.9,5,"uno; dos"\n', (input) => createBet(input));
  assert.deepEqual(getBet(aMano.ids[0])?.tags, ['uno', 'dos']);
});

test('Etiquetas a mano (data-guardian): mismos límites que la API (sin repetidas, 30 caracteres, 12 como mucho)', async () => {
  const { importarCsv } = await import('./importar.ts');
  const { getBet } = await import('../bets.ts');
  const largo = 'x'.repeat(40);
  const csv = `placed_on,sport,event,market,selection,odds,stake,tags\n2026-11-05,tennis,Repetidas,moneyline,A,1.9,5,"a|a| a |${largo}"\n2026-11-05,tennis,Enorme,moneyline,A,1.9,5,"${'['.repeat(5000)}"\n`;
  const r = importarCsv(csv, (input) => createBet(input));
  assert.equal(r.importadas, 2);
  assert.deepEqual(getBet(r.ids[0])?.tags, ['a', 'x'.repeat(30)]);
  assert.deepEqual(getBet(r.ids[1])?.tags, ['['.repeat(30)], 'una celda enorme no entra entera en el libro mayor');
});
