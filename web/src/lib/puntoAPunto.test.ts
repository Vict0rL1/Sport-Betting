import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trasPunto, type Marcador, type Recuento } from './puntoAPunto';

const m = (games: [number, number], points: [number, number], server: 1 | 2 = 1): Marcador => ({ sets: [0, 0], games, points, server });
const cero: Recuento = [
  [0, 0],
  [0, 0],
];

test('un punto suma al saque de quien sacaba, ganado solo si lo ganó él', () => {
  const a = trasPunto(m([0, 0], [0, 0]), cero, null, 1, m([0, 0], [1, 0]));
  assert.deepEqual(a.recuento, [[1, 1], [0, 0]]);
  assert.equal(a.ultimo, null, 'sin juego cerrado no hay último juego nuevo');
  const b = trasPunto(m([0, 0], [1, 0]), a.recuento, null, 2, m([0, 0], [1, 1]));
  assert.deepEqual(b.recuento, [[1, 2], [0, 0]]);
});

test('cerrar un juego al resto es un break; al saque, no', () => {
  const brk = trasPunto(m([2, 2], [0, 3], 1), cero, null, 2, m([2, 3], [0, 0], 2));
  assert.deepEqual(brk.ultimo, { winner: 2, wasBreak: true });
  const hold = trasPunto(m([2, 2], [3, 0], 1), cero, null, 1, m([3, 2], [0, 0], 2));
  assert.deepEqual(hold.ultimo, { winner: 1, wasBreak: false });
  const fin = trasPunto(m([5, 4], [3, 0], 1), cero, null, 1, null);
  assert.deepEqual(fin.ultimo, { winner: 1, wasBreak: false }, 'el punto que acaba el partido también cierra el juego');
});

test('no muta el recuento de entrada', () => {
  const r: Recuento = [
    [3, 5],
    [2, 4],
  ];
  trasPunto(m([0, 0], [0, 0], 2), r, null, 2, m([0, 0], [1, 0], 2));
  assert.deepEqual(r, [
    [3, 5],
    [2, 4],
  ]);
});
