// D6 (revisión del 8 de octubre): sin red en un arranque en frío, `estadoAuth()` lanzaba y la
// pantalla se quedaba en blanco; y salir no vaciaba la caché de la API del service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoAuth, salir, CACHE_API } from './auth.ts';

const g = globalThis as unknown as { fetch: typeof fetch; caches?: { delete: (n: string) => Promise<boolean> } };

test('D6: estadoAuth sin red no lanza: deja entrar a lo guardado y lo dice', async () => {
  const original = g.fetch;
  g.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  try {
    const e = await estadoAuth();
    assert.equal(e.dentro, true);
    assert.equal(e.sinRed, true);
  } finally {
    g.fetch = original;
  }
});

test('D6: salir vacía la caché de la API aunque el logout falle', async () => {
  const original = g.fetch;
  const borradas: string[] = [];
  g.caches = { delete: async (n) => (borradas.push(n), true) };
  g.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  try {
    await salir();
    assert.deepEqual(borradas, [CACHE_API]);
    assert.equal(CACHE_API, 'predictor-api-v1', 'el mismo nombre que public/sw.js');
  } finally {
    g.fetch = original;
    delete g.caches;
  }
});
