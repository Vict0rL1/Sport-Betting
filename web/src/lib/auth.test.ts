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

test('G4: cerrar desde la lista la sesión ACTUAL también vacía la caché de la API', async () => {
  const { revocar } = await import('./auth.ts');
  const original = g.fetch;
  const borradas: string[] = [];
  g.caches = { delete: async (n) => (borradas.push(n), true) };
  g.fetch = (async () => new Response(JSON.stringify({ ok: true, eraLaActual: true }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const r = await revocar(7);
    assert.equal(r.eraLaActual, true);
    assert.deepEqual(borradas, [CACHE_API]);
  } finally {
    g.fetch = original;
    delete g.caches;
  }
});

test('G4: cerrar OTRA sesión no toca la caché', async () => {
  const { revocar } = await import('./auth.ts');
  const original = g.fetch;
  const borradas: string[] = [];
  g.caches = { delete: async (n) => (borradas.push(n), true) };
  g.fetch = (async () => new Response(JSON.stringify({ ok: true, eraLaActual: false }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    await revocar(8);
    assert.deepEqual(borradas, []);
  } finally {
    g.fetch = original;
    delete g.caches;
  }
});

// G4b (revisión de security-reviewer al lote G): la sesión que muere fuera de la app (caduca, la
// revocan desde otro dispositivo) llevaba a la pantalla de entrada con la caché de la API intacta,
// y sin red se servía sin credenciales: justo el caso para el que existe revocar en remoto.
test('G4b: si el servidor dice que no hay sesión, la caché de la API se vacía', async () => {
  const original = g.fetch;
  const borradas: string[] = [];
  g.caches = { delete: async (n) => (borradas.push(n), true) };
  const me = (cuerpo: object) => (async () => new Response(JSON.stringify(cuerpo), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    g.fetch = me({ auth: true, dentro: true, totp: false, sesiones: true });
    await estadoAuth();
    g.fetch = me({ auth: false, dentro: true, totp: false, sesiones: false });
    await estadoAuth();
    assert.deepEqual(borradas, [], 'con sesión, o sin puerta, no se toca');
    g.fetch = me({ auth: true, dentro: false, totp: false, sesiones: true });
    await estadoAuth();
    assert.deepEqual(borradas, [CACHE_API]);
  } finally {
    g.fetch = original;
    delete g.caches;
  }
});

test('G4b: un 401 de la API (la sesión murió fuera) vacía la caché antes de pedir la entrada', async () => {
  const { instalarDetector401, EVENTO_AUTH } = await import('./auth.ts');
  const w = globalThis as unknown as { window?: EventTarget & { fetch: typeof fetch } };
  const borradas: string[] = [];
  g.caches = { delete: async (n) => (borradas.push(n), true) };
  const ventana = Object.assign(new EventTarget(), { fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch });
  w.window = ventana;
  let avisos = 0;
  ventana.addEventListener(EVENTO_AUTH, () => avisos++);
  try {
    instalarDetector401();
    await ventana.fetch('/api/paper');
    await new Promise((ok) => setTimeout(ok, 0));
    assert.equal(avisos, 1);
    assert.deepEqual(borradas, [CACHE_API]);
  } finally {
    delete w.window;
    delete g.caches;
  }
});
