// Lote J, J1: una página de otro sitio no puede hacer que el navegador cambie nada en la app.
//
// Sin contraseña (lo normal en el portátil), un POST «simple» (text/plain, sin preflight de CORS)
// desde cualquier web que visites llegaba a 127.0.0.1 y se ejecutaba: el navegador no necesita
// ninguna cookie. Con contraseña, solo protegía la cookie SameSite=Strict. Ahora los métodos que
// cambian algo (POST, PUT, PATCH, DELETE) en /api se niegan si el navegador dice que vienen de
// otro sitio (Sec-Fetch-Site) o si su Origin no es el de la app ni uno de CORS_ORIGINS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');

async function appAbierta(entorno: Partial<NodeJS.ProcessEnv> = {}) {
  const e = { NODE_ENV: 'test', ...entorno } as NodeJS.ProcessEnv;
  return buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
}

// Un POST sin cuerpo que cambia algo y existe siempre, con o sin contraseña.
const post = (app: Awaited<ReturnType<typeof appAbierta>>, headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/api/auth/logout', headers: { host: '127.0.0.1:7374', 'content-type': 'text/plain', ...headers }, payload: '' });

test('J1: un POST de otro sitio (Sec-Fetch-Site: cross-site) se niega con 403, sin contraseña', async () => {
  const app = await appAbierta();
  const r = await post(app, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  assert.equal(r.statusCode, 403, r.body);
  // Y un subdominio hermano tampoco (same-site no es same-origin).
  assert.equal((await post(app, { origin: 'https://otra.ejemplo.dev', 'sec-fetch-site': 'same-site' })).statusCode, 403);
  await app.close();
});

test('J1: sin Sec-Fetch-Site (un navegador viejo), un Origin de otro sitio también se niega', async () => {
  const app = await appAbierta();
  assert.equal((await post(app, { origin: 'https://evil.example' })).statusCode, 403);
  await app.close();
});

test('J1: lo de la propia app, curl y los orígenes de CORS_ORIGINS pasan; GET no se mira', async () => {
  const app = await appAbierta({ CORS_ORIGINS: 'https://panel.mio.example' });
  assert.equal((await post(app, { origin: 'http://127.0.0.1:7374', 'sec-fetch-site': 'same-origin' })).statusCode, 200, 'la pantalla');
  assert.equal((await post(app, {})).statusCode, 200, 'curl o un script: sin Origin ni Sec-Fetch-Site');
  assert.equal((await post(app, { origin: 'https://panel.mio.example', 'sec-fetch-site': 'cross-site' })).statusCode, 200, 'un origen permitido');
  // El proxy de Vite en desarrollo ya no cambia el Host (scripts/proxy-api.mjs): el navegador
  // dice same-origin y, si es viejo, su Origin es el mismo host:puerto que el Host.
  assert.equal((await post(app, { host: 'localhost:7373', origin: 'http://localhost:7373', 'sec-fetch-site': 'same-origin' })).statusCode, 200, 'el proxy de Vite');
  assert.equal((await post(app, { host: 'localhost:7373', origin: 'http://localhost:7373' })).statusCode, 200, 'navegador viejo detrás del proxy');
  const get = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  assert.equal(get.statusCode, 200, 'leer no cambia nada');
  await app.close();
});

test('J1: con contraseña, el bloqueo va antes que la puerta (ni siquiera se intenta entrar)', async () => {
  const app = await appAbierta({ APP_AUTH: 'on', APP_PASSWORD: 'una-frase-larga-y-propia' });
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { host: '127.0.0.1:7374', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
    payload: { password: 'una-frase-larga-y-propia' },
  });
  assert.equal(r.statusCode, 403, r.body);
  assert.equal(r.headers['set-cookie'], undefined, 'no abre sesión');
  await app.close();
});

// Revisión de security-reviewer al lote J.
test('J1: una ruta escrita con escapes (/%61pi/…) no se salta la comprobación', async () => {
  const app = await appAbierta();
  for (const url of ['/%61pi/auth/logout', '/%61%70%69/auth/logout']) {
    const r = await app.inject({ method: 'POST', url, headers: { host: '127.0.0.1:7374', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' }, payload: '' });
    assert.equal(r.statusCode, 403, `${url}: ${r.body}`);
  }
  await app.close();
});

test('J1: sin Sec-Fetch-Site, el Origin tiene que ser el mismo host Y puerto (otra app en otro puerto, no)', async () => {
  const app = await appAbierta();
  assert.equal((await post(app, { origin: 'http://127.0.0.1:3000' })).statusCode, 403);
  // El móvil en la misma wifi, por HTTP a la IP: sin Sec-Fetch-Site, Origin igual al Host.
  assert.equal((await post(app, { host: '192.168.1.5:7373', origin: 'http://192.168.1.5:7373' })).statusCode, 200);
  await app.close();
});

test('J1: sin contraseña, solo se atiende a localhost, a una IP o a APP_HOSTS (rebinding de DNS)', async () => {
  const app = await appAbierta({ APP_HOSTS: 'mi-mac.local' });
  const get = (host: string) => app.inject({ method: 'GET', url: '/api/health', headers: { host } });
  assert.equal((await get('evil.example:7374')).statusCode, 403, 'un dominio que apunta a 127.0.0.1');
  for (const host of ['127.0.0.1:7374', 'localhost:7374', '192.168.1.5:7374', '[::1]:7374', 'mi-mac.local:7374']) assert.equal((await get(host)).statusCode, 200, host);
  await app.close();
  // Con contraseña no hace falta (y en producción el Host es el dominio público): decide la puerta.
  const conClave = await appAbierta({ APP_AUTH: 'on', APP_PASSWORD: 'una-frase-larga-y-propia' });
  assert.equal((await conClave.inject({ method: 'GET', url: '/api/health', headers: { host: 'app.example' } })).statusCode, 401);
  await conClave.close();
});

test('J1: el proxy de Vite hacia la API local no cambia el Host; hacia otra máquina (VITE_API_BASE), sí', async () => {
  const { proxyDeApi } = await import('../../../scripts/proxy-api.mjs');
  assert.deepEqual(proxyDeApi({ PORT: '7380' } as NodeJS.ProcessEnv, 7374), { target: 'http://127.0.0.1:7380', changeOrigin: false });
  assert.deepEqual(proxyDeApi({ VITE_API_BASE: 'https://api.otra.example' } as NodeJS.ProcessEnv, 7374), { target: 'https://api.otra.example', changeOrigin: true });
  // VITE_API_BASE apuntando a esta misma máquina sigue siendo la API local: el Host no se toca.
  for (const local of ['http://127.0.0.1:7374', 'http://localhost:7374', 'http://[::1]:7374']) {
    assert.equal(proxyDeApi({ VITE_API_BASE: local } as NodeJS.ProcessEnv, 7374).changeOrigin, false, local);
  }
});
