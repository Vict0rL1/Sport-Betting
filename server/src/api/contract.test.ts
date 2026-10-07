// Contrato de la API (Fase 3.3): la especificación lista cada ruta registrada, y las rutas
// con esquema de respuesta responden algo que lo cumple. Si una respuesta cambia de forma,
// esto falla antes de que lo descubra la pantalla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
const { validar, ESQUEMA_HEALTH, ESQUEMA_READY, ESQUEMA_FEATURES, ESQUEMA_DATOS_ESTADO, ESQUEMA_INGESTION_RUNS, ESQUEMA_SCHEDULER, ESQUEMA_POLICY, ESQUEMA_CANALES, ESQUEMA_EXPORT_JSON, ESQUEMA_FIABILIDAD, ESQUEMA_SEGMENTOS, ESQUEMA_MONITORIZACION, ESQUEMA_SIMULACION, ESQUEMA_TORNEO, ESQUEMA_COMBINADA, ESQUEMA_INTEL } = await import('./schemas.ts');
const { reiniciarRegistro, registrar, arrancar, parar } = await import('../scheduler/registry.ts');

const rutas: { method: string | string[]; url: string }[] = [];
const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e, onRoute: (r) => rutas.push(r) });
await app.ready();

test('validar: tipos, required, nullable, items y enum', () => {
  assert.deepEqual(validar({ ok: true }, ESQUEMA_HEALTH), []);
  assert.match(validar({ ok: 'sí' }, ESQUEMA_HEALTH).join(), /es string, se esperaba boolean/);
  assert.match(validar({}, ESQUEMA_HEALTH).join(), /\$\.ok: falta/);
  assert.match(validar({ ok: true, extra: 1 }, ESQUEMA_HEALTH).join(), /no prevista/);
  assert.deepEqual(validar({ layout: 'split', history: { ruta: 'x', mb: null }, ledger: null, backup: {}, retencion: { ultima: null, borradas: 0 } }, ESQUEMA_DATOS_ESTADO), []);
  assert.match(validar({ layout: 'otro', history: { ruta: 'x', mb: 1 }, ledger: null, backup: {}, retencion: { ultima: null, borradas: 0 } }, ESQUEMA_DATOS_ESTADO).join(), /no está en/);
});

test('la especificación OpenAPI lista todas las rutas registradas (salvo las del propio visor)', async () => {
  const res = await app.inject({ method: 'GET', url: '/openapi.json' });
  assert.equal(res.statusCode, 200);
  const spec = res.json() as { openapi: string; paths: Record<string, Record<string, unknown>> };
  assert.match(spec.openapi, /^3\./);
  const enSpec = new Set<string>();
  const sinBarra = (p: string) => (p.length > 1 ? p.replace(/\/$/, '') : p);
  for (const [p, metodos] of Object.entries(spec.paths)) for (const m of Object.keys(metodos)) enSpec.add(`${m.toUpperCase()} ${sinBarra(p)}`);
  const faltan: string[] = [];
  for (const r of rutas) {
    if (r.url.startsWith('/docs')) continue;
    const metodos = (Array.isArray(r.method) ? r.method : [r.method]).filter((m) => m !== 'HEAD' && m !== 'OPTIONS');
    const url = sinBarra(r.url.replace(/:([a-zA-Z_]+)/g, '{$1}').replace(/\*$/, '{*}'));
    for (const m of metodos) if (!enSpec.has(`${m} ${url}`)) faltan.push(`${m} ${url}`);
  }
  assert.deepEqual(faltan, [], 'rutas fuera de la especificación');
  assert.ok(Object.keys(spec.paths).length > 60, `${Object.keys(spec.paths).length} rutas documentadas`);
});

test('cada ruta con esquema responde algo que lo cumple', async () => {
  reiniciarRegistro();
  registrar({ nombre: 'contrato', descripcion: 'de prueba', cadenciaMin: 0, primeraEnMin: 0, fn: () => {} });
  arrancar();
  const casos: [string, unknown][] = [
    ['/health', ESQUEMA_HEALTH],
    ['/ready', ESQUEMA_READY],
    ['/api/features', ESQUEMA_FEATURES],
    ['/api/datos/estado', ESQUEMA_DATOS_ESTADO],
    ['/api/ingestion-runs', ESQUEMA_INGESTION_RUNS],
    ['/api/scheduler', ESQUEMA_SCHEDULER],
    ['/api/policy', ESQUEMA_POLICY],
    ['/api/notifications/canales', ESQUEMA_CANALES],
    ['/api/export/papel?formato=json', ESQUEMA_EXPORT_JSON],
    ['/api/evaluation/reliability?sport=nfl', ESQUEMA_FIABILIDAD],
    ['/api/evaluation/segmentos?sport=nfl', ESQUEMA_SEGMENTOS],
    ['/api/monitoring?sport=nfl', ESQUEMA_MONITORIZACION],
    ['/api/simulation/season/football/epl', ESQUEMA_SIMULACION],
    ['/api/simulation/torneo', ESQUEMA_TORNEO],
    ['/api/odds/intel', ESQUEMA_INTEL],
  ];
  for (const [url, esquema] of casos) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, `${url} → ${res.statusCode} ${res.body.slice(0, 120)}`);
    assert.deepEqual(validar(res.json(), esquema as never), [], url);
  }
  const parlay = await app.inject({ method: 'POST', url: '/api/picks/parlay', payload: { patas: [{ sport: 'football', matchKey: 'a', cuando: '2026-10-10T15:00:00Z', p: 0.5, cuota: 2 }, { sport: 'football', matchKey: 'b', cuando: '2026-10-11T15:00:00Z', p: 0.4 }] } });
  assert.equal(parlay.statusCode, 200, parlay.body);
  assert.deepEqual(validar(parlay.json(), ESQUEMA_COMBINADA), [], '/api/picks/parlay');
  const malo = await app.inject({ method: 'POST', url: '/api/picks/parlay', payload: { patas: [] } });
  assert.equal(malo.statusCode, 400);
  parar();
  const r = await app.inject({ method: 'GET', url: '/ready' });
  assert.equal(r.statusCode, 503, 'sin el registro de trabajos, no está listo');
  await app.close();
});
