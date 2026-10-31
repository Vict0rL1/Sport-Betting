// Lo que vio ui-tester el 30 de octubre en Líneas y Destacados: guion ASCII en los porcentajes
// negativos, «9.1 %» en inglés junto a «2.6%», «1 casas», «pinnacle» en minúscula y textos del
// servidor en español con la interfaz en inglés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nombreCasa } from './tipos';

const { formato, tr, cargarIngles } = await import('../../i18n/index.tsx');
await cargarIngles();

test('un porcentaje negativo lleva el signo menos (U+2212), como pct()', () => {
  assert.equal(formato('es').porcentaje(-0.048, 1), '−4,8 %');
  assert.equal(formato('en').porcentaje(-0.026, 1), '−2.6%');
  assert.equal(formato('es').porcentaje(0.053, 1), '5,3 %');
});

test('en inglés, el porcentaje de una surebet va pegado («4.8%»), como el resto de la interfaz en inglés', () => {
  assert.equal(tr('en', 'mi.surebet', { partido: 'A vs B', m: '4.8', patas: 'x' }), 'A vs B: surebet 4.8% (x)');
  assert.equal(tr('en', 'mi.surebetPush', { partido: 'A vs B', m: '4.8', min: '0.0', patas: 'x' }), 'A vs B: surebet 4.8%, 0.0% on a push (x)');
  assert.equal(tr('en', 'lineas.surebet', { m: '4.8', patas: 'x' }), 'Surebet 4.8% at these prices: x');
  assert.equal(tr('en', 'lineas.surebetPush', { m: '9.1', min: '0.0', patas: 'x' }), 'Surebet 9.1%, 0.0% on a push, at these prices: x');
  assert.equal(tr('es', 'mi.surebet', { partido: 'A vs B', m: '4,8', patas: 'x' }), 'A vs B: surebet 4,8 % (x)', 'en español, con el espacio duro');
});

test('«1 casa», no «1 casas», también en el steam', () => {
  const steam = { partido: 'A vs B', sel: 'A', desde: '2,00', hasta: '1,90', min: 30, pp: '+2,1' };
  assert.match(tr('es', 'mi.steam', { ...steam, casas: 1 }), /\(1 casa, /);
  assert.match(tr('es', 'mi.steam', { ...steam, casas: 4 }), /\(4 casas, /);
  assert.match(tr('en', 'mi.steam', { ...steam, casas: 1 }), /\(1 book, /);
  assert.equal(tr('es', 'lineas.casas', { n: 1 }), '1 casa');
  assert.equal(tr('es', 'lineas.casas', { n: 3 }), '3 casas');
  assert.equal(tr('en', 'lineas.casas', { n: 1 }), '1 book');
  assert.equal(tr('en', 'lineas.casas', { n: 3 }), '3 books');
});

test('el nombre de la casa de referencia con mayúscula', () => {
  assert.equal(nombreCasa('pinnacle'), 'Pinnacle');
  assert.equal(nombreCasa(''), '');
});

test('la nota del comparador y la etiqueta del mercado, en el catálogo y traducidas', () => {
  assert.match(tr('es', 'lineas.nota'), /Solo lectura/);
  assert.match(tr('en', 'lineas.nota'), /^Read-only/);
  assert.match(tr('es', 'mi.etiqueta'), /^Aproximación/);
  assert.match(tr('en', 'mi.etiqueta'), /^Approximation/);
});
