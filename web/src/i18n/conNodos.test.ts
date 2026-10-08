// conNodos: una frase del catálogo con elementos dentro, sin partirla en trozos intraducibles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, isValidElement, type ReactElement } from 'react';
import { conNodos } from './index';

test('sustituye solo las marcas con nodo y deja el resto del texto', () => {
  const r = conNodos('Los puntos van del {sacador} primero: {otro}.', { sacador: createElement('strong', null, 'sacador') });
  assert.equal(r.length, 5);
  assert.equal(r[0], 'Los puntos van del ');
  assert.ok(isValidElement(r[1]));
  const hijo = (r[1] as ReactElement<{ children: ReactElement<{ children: string }> }>).props.children;
  assert.equal(hijo.props.children, 'sacador');
  assert.equal(r.slice(2).join(''), ' primero: {otro}.');
});

test('sin marcas, el texto entero', () => {
  assert.deepEqual(conNodos('nada que sustituir', { x: 'y' }), ['nada que sustituir']);
});
