import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerMarkdown, enLinea } from './markdown';

test('bloques: títulos, viñetas, tabla sin la fila separadora, nota y párrafo', () => {
  const b = leerMarkdown('# T\n\n## S\n\n- a\n- **b** c\n\n| X | Y |\n|---|---|\n| 1 | [P](/partido/nfl/1) |\n\n_nota_\n\nTexto.');
  assert.deepEqual(b.map((x) => x.tipo), ['h1', 'h2', 'ul', 'tabla', 'nota', 'p']);
  const ul = b[2] as Extract<(typeof b)[number], { tipo: 'ul' }>;
  assert.equal(ul.items.length, 2);
  assert.deepEqual(ul.items[1][0], { t: 'negrita', v: 'b' });
  const t = b[3] as Extract<(typeof b)[number], { tipo: 'tabla' }>;
  assert.equal(t.filas.length, 1);
  assert.deepEqual(t.filas[0][1][0], { t: 'enlace', v: 'P', href: '/partido/nfl/1' });
});

test('solo enlaces internos: uno externo o de protocolo relativo se queda en texto', () => {
  assert.deepEqual(enLinea('[x](https://ejemplo.com)'), [{ t: 'texto', v: 'x' }]);
  assert.deepEqual(enLinea('[x](//ejemplo.com)'), [{ t: 'texto', v: 'x' }]);
  assert.deepEqual(enLinea('[x](javascript:alert(1))'), [{ t: 'texto', v: 'x' }, { t: 'texto', v: ')' }]);
});
