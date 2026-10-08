// Compresión y ETag: lo que el cliente acepta, 304 cuando no ha cambiado, y nada roto por el camino.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import '../test/setup.ts';

const { codificacionPara, coincide, etagDe } = await import('./compresion.ts');
const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');

test('codificacionPara: br antes que gzip; q=0 es no', () => {
  assert.equal(codificacionPara('gzip, deflate, br'), 'br');
  assert.equal(codificacionPara('gzip'), 'gzip');
  assert.equal(codificacionPara('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(codificacionPara('identity'), null);
  assert.equal(codificacionPara(undefined), null);
  assert.equal(codificacionPara('*'), 'gzip');
});

test('coincide: débil o fuerte, lista y comodín', () => {
  const e = etagDe('hola');
  assert.ok(coincide(e, e));
  assert.ok(coincide(`"x", ${e.replace('W/', '')}`, e));
  assert.ok(coincide('*', e));
  assert.ok(!coincide('"otro"', e));
  assert.ok(!coincide(undefined, e));
});

test('de punta a punta: ETag y 304, Brotli y gzip que se descomprimen al mismo JSON', async () => {
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  await app.ready();
  const plano = await app.inject({ method: 'GET', url: '/api/features' });
  assert.equal(plano.statusCode, 200);
  assert.equal(plano.headers['content-encoding'], undefined, 'sin Accept-Encoding no se comprime');
  const etag = plano.headers.etag as string;
  assert.match(etag, /^W\/"/);
  assert.equal(plano.headers['cache-control'], 'no-cache');
  const otra = await app.inject({ method: 'GET', url: '/api/features', headers: { 'if-none-match': etag } });
  assert.equal(otra.statusCode, 304);
  assert.equal(otra.body, '');
  const br = await app.inject({ method: 'GET', url: '/api/features', headers: { 'accept-encoding': 'gzip, br' } });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.match(String(br.headers.vary), /Accept-Encoding/);
  assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(br.rawPayload).toString()), plano.json());
  assert.ok(br.rawPayload.length < plano.rawPayload.length / 3, `${br.rawPayload.length} < ${plano.rawPayload.length}/3`);
  const gz = await app.inject({ method: 'GET', url: '/api/features', headers: { 'accept-encoding': 'gzip' } });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(JSON.parse(zlib.gunzipSync(gz.rawPayload).toString()), plano.json());
  // Lo pequeño no se comprime, y un POST no lleva ETag.
  const salud = await app.inject({ method: 'GET', url: '/healthz', headers: { 'accept-encoding': 'br' } });
  assert.equal(salud.headers['content-encoding'], undefined);
  const post = await app.inject({ method: 'POST', url: '/api/bandeja/marcar', payload: { todas: true } });
  assert.equal(post.headers.etag, undefined);
  await app.close();
});
