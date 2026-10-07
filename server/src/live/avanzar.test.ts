// POST /api/live/avanzar (Fase 8.4): el marcador avanza con la regla del servidor; apagado, 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
const { fijarAnulacion } = await import('../features.ts');

const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
await app.ready();
const avanzar = (payload: unknown) => app.inject({ method: 'POST', url: '/api/live/avanzar', payload: payload as Record<string, unknown> });

test('apagado por defecto', async () => {
  assert.equal((await avanzar({ state: { sets: [0, 0], games: [0, 0], points: [0, 0], server: 1, bestOf: 3 }, winner: 1 })).statusCode, 404);
});

test('un punto, un juego con break, y el final del partido', async () => {
  fijarAnulacion('tenis.enVivo', true, () => {});
  const r = await avanzar({ state: { sets: [0, 0], games: [0, 0], points: [0, 0], server: 1, bestOf: 3 }, winner: 1 });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().state.points, [1, 0]);
  // 0-40 al saque de 1 y gana 2: break, juego para 2 y cambia el saque.
  const b = (await avanzar({ state: { sets: [0, 0], games: [0, 0], points: [0, 3], server: 1, bestOf: 3 }, winner: 2 })).json();
  assert.deepEqual(b.state.games, [0, 1]);
  assert.equal(b.state.server, 2);
  // 1-0 en sets, 5-4 y 40-0 al saque de 1: gana el partido.
  const fin = (await avanzar({ state: { sets: [1, 0], games: [5, 4], points: [3, 0], server: 1, bestOf: 3 }, winner: 1 })).json();
  assert.deepEqual([fin.terminado, fin.ganador, fin.state], [true, 1, null]);
  assert.equal((await avanzar({ state: { sets: [0, 0], games: [0, 0], points: [0, 0], server: 1, bestOf: 3 }, winner: 3 })).statusCode, 400);
  assert.equal((await avanzar({ state: { sets: [5, 0], games: [0, 0], points: [0, 0], server: 1, bestOf: 3 }, winner: 1 })).statusCode, 400, 'marcador imposible');
  fijarAnulacion('tenis.enVivo', null, () => {});
  await app.close();
});
