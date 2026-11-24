// Fase E: las rutas nuevas responden con sus definiciones y no tocan las de siempre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

test('las rutas de calibración y rendimiento responden; la fiabilidad de siempre sigue igual', async () => {
  const { buildApp } = await import('../app.ts');
  const { configAuth } = await import('../auth/mode.ts');
  const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
  const e = { NODE_ENV: 'test', APP_TIMEZONE: 'Europe/Madrid' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  const c = (await app.inject({ method: 'GET', url: '/api/evaluation/calibracion?sport=football&cohorte=final' })).json();
  assert.equal(c.definicion, 'calibracion-partido-v1');
  assert.equal(c.politica, 'final-congelada-v1');
  assert.deepEqual(c.paneles.map((p: { clase: string }) => p.clase), ['local', 'empate', 'visitante']);
  const r = await app.inject({ method: 'GET', url: '/api/evaluation/rendimiento?sport=nhl&periodo=semana' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().definicion, 'rendimiento-periodo-v1');
  assert.equal(r.json().referencia.uniforme, 0.25);
  assert.equal((await app.inject({ method: 'GET', url: '/api/evaluation/rendimiento/partidos?sport=nhl' })).statusCode, 400, 'el desglose necesita el periodo');
  assert.equal((await app.inject({ method: 'GET', url: '/api/evaluation/calibracion?sport=nhl&desde=ayer' })).statusCode, 400, 'una fecha que no es AAAA-MM-DD no entra');
  const f = (await app.inject({ method: 'GET', url: '/api/evaluation/reliability?sport=nhl' })).json();
  assert.ok('live' in f && 'cubetas' in f.live && 'ece' in f.live, 'la de siempre conserva su forma: de ella cuelgan el PSI y la deriva');
  await app.close();
});
