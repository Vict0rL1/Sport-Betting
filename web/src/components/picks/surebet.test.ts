// Auditoría del 22 de octubre, hallazgo 2: cada pata de una surebet se pinta con su línea con signo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seleccionConLinea } from './tipos';
import { fijarIdiomaFormato } from '../../lib/formato';

test('una pata de hándicap lleva su signo; la de un total, el umbral; sin línea, la selección tal cual', () => {
  fijarIdiomaFormato('es');
  assert.equal(seleccionConLinea('Kansas City Chiefs', -3.5, 'spreads'), 'Kansas City Chiefs −3,5');
  assert.equal(seleccionConLinea('Buffalo Bills', 3.5, 'spreads'), 'Buffalo Bills +3,5');
  assert.equal(seleccionConLinea('Buffalo Bills', 0, 'spreads'), 'Buffalo Bills 0');
  assert.equal(seleccionConLinea('Over', 2.5, 'totals'), 'Over 2,5');
  assert.equal(seleccionConLinea('Arsenal', null, 'h2h'), 'Arsenal');
  fijarIdiomaFormato('en');
  assert.equal(seleccionConLinea('Buffalo Bills', 3.5, 'alternate_spreads'), 'Buffalo Bills +3.5');
  fijarIdiomaFormato('es');
});
