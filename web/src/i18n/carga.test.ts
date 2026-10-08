// El catálogo en inglés va en su propio fichero y se carga al pedirlo: hasta entonces cada
// clave cae al español, nunca a la clave ni a un hueco.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarIngles, inglesListo, tr } from './index';

test('el inglés se carga aparte y, mientras no llega, todo sale en español', async () => {
  assert.equal(inglesListo(), false);
  assert.equal(tr('en', 'nav.destacados'), 'Destacados');
  await cargarIngles();
  assert.equal(inglesListo(), true);
  assert.equal(tr('en', 'nav.destacados'), 'Highlights');
  assert.equal(tr('es', 'nav.destacados'), 'Destacados');
  // Pedirlo otra vez no vuelve a cargarlo.
  await cargarIngles();
  assert.equal(tr('en', 'comun.errorActualizar', { error: 'x' }), 'Could not refresh: x');
});
