// D2 (revisión del 8 de octubre): un horizonte que todavía no ha llegado (T-1h de un partido
// de pasado mañana) no es «sin observación»: está pendiente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaHorizonte, type Horizonte } from './trust.ts';

const ahora = new Date('2026-10-09T12:00:00Z');
const h = (marca: string, fila: Horizonte['fila'] = null): Horizonte => ({ etiqueta: 'T-1h', marca, fila, minutosAntesDeLaMarca: null });

test('D2: marca futura sin fila → pendiente; marca pasada sin fila → sin observación; con fila → nada', () => {
  assert.equal(etiquetaHorizonte(h('2026-10-11T19:00:00Z'), ahora), 'fiarse.pendiente');
  assert.equal(etiquetaHorizonte(h('2026-10-09T11:00:00Z'), ahora), 'fiarse.sinObservacion');
  assert.equal(etiquetaHorizonte(h('2026-10-09T11:00:00Z', { probs: [0.6, 0.4], captured_at: '2026-10-09T10:50:00Z', outcomes: ['A', 'B'] }), ahora), null);
  assert.equal(etiquetaHorizonte(h('no es una fecha'), ahora), 'fiarse.sinObservacion', 'una marca ilegible no se da por futura');
});
