// Fase C: la densidad de la lista (cómoda o compacta) es una preferencia de este navegador, aparte de
// los filtros: no va en la URL, no la borra «Quitar filtros» y sobrevive a recargar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const almacen = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => void almacen.set(k, v),
  removeItem: (k: string) => void almacen.delete(k),
};
const { CLAVE_DENSIDAD, leerDensidad, guardarDensidad } = await import('./densidad.ts');

test('C: por defecto cómoda; se recuerda la compacta; un valor raro vuelve a cómoda', () => {
  assert.equal(leerDensidad(), 'comoda');
  guardarDensidad('compacta');
  assert.equal(almacen.get(CLAVE_DENSIDAD), 'compacta');
  assert.equal(leerDensidad(), 'compacta');
  almacen.set(CLAVE_DENSIDAD, 'gigante');
  assert.equal(leerDensidad(), 'comoda');
});

test('C: sin almacenamiento no rompe', () => {
  const antes = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => {} };
  assert.equal(leerDensidad(), 'comoda');
  assert.doesNotThrow(() => guardarDensidad('compacta'));
  (globalThis as { localStorage?: unknown }).localStorage = antes;
});
