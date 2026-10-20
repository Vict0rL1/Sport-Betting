import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simularFetch } from './setup.ts';

test('la preparación aísla la base de datos y la clave', async () => {
  assert.match(process.env.DATA_DIR ?? '', /predicciones-test-/);
  const { env, DB_PATH } = await import('../config.ts');
  assert.equal(env.oddsApiKey, 'clave-de-test-0000000000000000000');
  assert.ok(!DB_PATH.includes('/data/tennis.db'), `la base de test no puede ser la real: ${DB_PATH}`);
});

test('fetch sin simular falla en vez de salir a la red', async () => {
  simularFetch(null);
  await assert.rejects(() => fetch('https://api.the-odds-api.com/v4/sports'), /intentó salir a la red/);
});

test('git tampoco sale a la red: un clon por https falla sin intentarlo', async () => {
  // La ingesta del tenis cae a `git clone` cuando ninguna descarga por HTTP vale; el fetch simulado
  // no lo para, y un test sin todas sus respuestas clonaba el repositorio real (revisión del 20 de
  // octubre, tercera vuelta).
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const destino = path.join(process.env.DATA_DIR!, 'clon-de-prueba');
  const r = spawnSync('git', ['clone', '--depth', '1', 'https://127.0.0.1:9/no-existe.git', destino], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 20_000,
    cwd: os.tmpdir(),
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /transport 'https' not allowed/);
});
