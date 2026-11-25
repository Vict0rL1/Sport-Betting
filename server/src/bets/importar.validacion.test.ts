// Revisión data-guardian (21-nov): la importación por CSV no pasaba por la validación de la API. Una
// fila con deporte «foo», mercado «bar», cuota 5000, estado «zzz», probabilidad 2 o un cashout sin
// importe entraba tal cual en el libro mayor (la tabla `bets` no tiene CHECK). Ahora cada fila se
// valida con la MISMA regla que POST /api/bets (bets/validar.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { createBet, getBet } = await import('../bets.ts');
const { importarCsv } = await import('./importar.ts');

const CAB = 'placed_on,sport,event,market,selection,odds,stake,status,payout,model_prob\n';
const fila = (o: Partial<Record<'sport' | 'event' | 'market' | 'odds' | 'status' | 'payout' | 'model_prob', string>>) =>
  `2026-11-05,${o.sport ?? 'tennis'},${o.event ?? 'Válida'},${o.market ?? 'moneyline'},A,${o.odds ?? '1.9'},5,${o.status ?? ''},${o.payout ?? ''},${o.model_prob ?? ''}\n`;

test('una fila que la API rechazaría, la importación también la rechaza, con su motivo', () => {
  const csv =
    CAB +
    fila({ event: 'Buena' }) +
    fila({ sport: 'foo' }) +
    fila({ market: 'bar' }) +
    fila({ odds: '5000' }) +
    fila({ status: 'zzz' }) +
    fila({ model_prob: '2' }) +
    fila({ status: 'cashout' });
  const r = importarCsv(csv, (input) => createBet(input));
  assert.equal(r.importadas, 1, JSON.stringify(r.rechazadas));
  assert.equal(getBet(r.ids[0])?.event, 'Buena');
  assert.deepEqual(
    r.rechazadas.map((x) => [x.linea, x.error.split(':')[0]]),
    [
      [3, 'sport'],
      [4, 'market'],
      [5, 'odds'],
      [6, 'status'],
      [7, 'model_prob'],
      [8, 'payout'],
    ],
  );
});

test('los textos largos se recortan como en la API', () => {
  const r = importarCsv(CAB + fila({ event: 'e'.repeat(300) }), (input) => createBet(input));
  assert.equal(r.importadas, 1);
  assert.equal(getBet(r.ids[0])?.event.length, 200);
});

test('un número opcional que no es un número se rechaza, no se guarda como vacío (data-guardian)', () => {
  const r = importarCsv(CAB + fila({ model_prob: '55%' }) + fila({ status: 'won', payout: 'abc' }) + fila({ model_prob: '"0,55"' }), (input) => createBet(input));
  assert.deepEqual(
    r.rechazadas.map((x) => [x.linea, x.error.split(':')[0]]),
    [
      [2, 'model_prob'],
      [3, 'payout'],
    ],
  );
  assert.equal(r.importadas, 1);
  assert.equal(getBet(r.ids[0])?.model_prob, 0.55, 'la coma decimal sigue valiendo');
});
