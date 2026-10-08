// i18n (Fase 5.25): el español es la fuente; el inglés no tiene claves que no existan en él y,
// para las páginas nuevas, las tiene todas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { es } from './es';
import { en } from './en';

test('en no inventa claves y cubre las del armazón y las páginas nuevas', () => {
  const claves = Object.keys(es);
  for (const k of Object.keys(en)) assert.ok(claves.includes(k), `clave inglesa sin origen español: ${k}`);
  const faltan = claves.filter((k) => !(k in en));
  assert.deepEqual(faltan, [], 'claves sin traducir');
});

test('las variables {x} son las mismas en las dos lenguas', () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [k, v] of Object.entries(en)) assert.equal(vars(v as string), vars(es[k as keyof typeof es]), k);
});
