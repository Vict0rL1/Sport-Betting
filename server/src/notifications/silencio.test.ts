// G3 (revisión del PR 17): horas de silencio. Opcionales; en la zona elegida; una ventana que cruza
// la medianoche; inicio = fin no es una ventana (se rechaza); suprimir o aplazar; lo aplazado caduca
// y se deduplica. Reloj y transportes de mentira: nada sale a la red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { validarSilencio, enSilencio, finDeSilencio } = await import('./silencio.ts');
const { notificar, configurarNotificaciones, enviarAplazadas, probarCanal } = await import('./index.ts');
const { guardarAjustes } = await import('../ajustes/index.ts');
const { getDb } = await import('../db.ts');

const MADRID = { activo: true, desde: '23:00', hasta: '07:00', zona: 'Europe/Madrid', modo: 'aplazar' as const, caducaHoras: 12 };

test('G3: validación: HH:MM, zona IANA, modo, caducidad; inicio = fin no es una ventana', () => {
  assert.deepEqual(validarSilencio(MADRID), MADRID);
  assert.throws(() => validarSilencio({ ...MADRID, hasta: '23:00' }), /iguales/);
  assert.throws(() => validarSilencio({ ...MADRID, desde: '24:00' }), /HH:MM/);
  assert.throws(() => validarSilencio({ ...MADRID, zona: 'Marte/Olympus' }), /zona/);
  assert.throws(() => validarSilencio({ ...MADRID, modo: 'gritar' }), /modo/);
  assert.throws(() => validarSilencio({ ...MADRID, caducaHoras: 0 }), /caduca/);
  assert.equal(validarSilencio(null), null, 'null apaga');
});

test('G3: ventana que cruza la medianoche, en la hora local de la zona (fin excluido)', () => {
  // 21:30 UTC = 22:30 en Madrid (invierno): fuera. 22:30 UTC = 23:30: dentro. 05:59 UTC = 06:59: dentro.
  assert.equal(enSilencio(new Date('2026-11-20T21:30:00Z'), MADRID), false);
  assert.equal(enSilencio(new Date('2026-11-20T22:30:00Z'), MADRID), true);
  assert.equal(enSilencio(new Date('2026-11-21T05:59:00Z'), MADRID), true);
  assert.equal(enSilencio(new Date('2026-11-21T06:00:00Z'), MADRID), false, '07:00 en Madrid: ya no');
  assert.equal(enSilencio(new Date('2026-11-21T12:00:00Z'), { ...MADRID, activo: false }), false, 'apagado: nunca');
  assert.equal(finDeSilencio(new Date('2026-11-20T22:30:00Z'), MADRID)?.toISOString(), '2026-11-21T06:00:00.000Z');
});

test('G3: el cambio de hora (Madrid, 29 de marzo de 2026: 02:00 → 03:00) se mide en hora local', () => {
  const v = { ...MADRID, desde: '01:00', hasta: '03:30' };
  assert.equal(enSilencio(new Date('2026-03-29T00:30:00Z'), v), true, '01:30 CET');
  assert.equal(enSilencio(new Date('2026-03-29T01:15:00Z'), v), true, '03:15 CEST');
  assert.equal(enSilencio(new Date('2026-03-29T01:31:00Z'), v), false, '03:31 CEST');
  assert.equal(finDeSilencio(new Date('2026-03-29T00:30:00Z'), v)?.toISOString(), '2026-03-29T01:30:00.000Z', 'acaba a las 03:30 CEST');
});

test('G3: suprimir: no sale por los canales, sí a la bandeja, y queda anotado', async () => {
  const llamadas: string[] = [];
  configurarNotificaciones({ entorno: { WEBHOOK_URL: 'https://hooks.example/x' } as NodeJS.ProcessEnv, fetch: async (url) => (llamadas.push(String(url)), new Response('ok', { status: 200 })) });
  guardarAjustes({ silencio: { ...MADRID, modo: 'suprimir' } });
  const r = await notificar('informe_semanal', { titulo: 'Informe A', cuerpo: 'x' }, { ahora: new Date('2026-11-20T23:30:00Z') });
  assert.deepEqual(r, []);
  assert.deepEqual(llamadas, []);
  const log = getDb().prepare("SELECT channel, ok, error FROM notification_log WHERE title = 'Informe A'").all() as { channel: string; ok: number; error: string }[];
  assert.deepEqual(log.map((l) => [l.channel, l.error]), [['silencio', 'suprimida: horas de silencio']]);
  const bandeja = getDb().prepare("SELECT COUNT(*) AS n FROM inbox WHERE titulo = 'Informe A'").get() as { n: number } | undefined;
  assert.equal(bandeja?.n, 1, 'la bandeja de la app no se silencia');
  // Fuera de la ventana sale.
  await notificar('informe_semanal', { titulo: 'Informe B', cuerpo: 'x' }, { ahora: new Date('2026-11-21T12:00:00Z') });
  assert.equal(llamadas.length, 1);
  // «Enviar prueba» nunca se silencia.
  assert.equal((await probarCanal('webhook')).ok, true);
});

test('G3: aplazar: se envía al acabar la ventana, una vez por clave (la última), y lo caducado no sale', async () => {
  const enviados: string[] = [];
  configurarNotificaciones({ entorno: { WEBHOOK_URL: 'https://hooks.example/x' } as NodeJS.ProcessEnv, fetch: async (_u, init) => (enviados.push(String((JSON.parse(String(init?.body)) as { content: string }).content)), new Response('ok', { status: 200 })) });
  guardarAjustes({ silencio: { ...MADRID, modo: 'aplazar', caducaHoras: 12 } });
  const noche = new Date('2026-11-20T23:30:00Z');
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'v1', url: '/informes/1' }, { ahora: noche });
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'v2', url: '/informes/1' }, { ahora: new Date(noche.getTime() + 60_000) });
  await notificar('trabajo_fallido', { titulo: 'Fallo viejo', cuerpo: 'x' }, { ahora: new Date('2026-11-19T22:30:00Z') });
  assert.deepEqual(enviados, [], 'nada durante la noche');
  // Antes del final de la ventana, nada; después, lo pendiente y vigente.
  // A las 05:00 UTC (06:00 en Madrid) la ventana sigue: no sale nada; lo de la noche anterior ya
  // pasó de 12 h y se anota como caducado.
  assert.deepEqual(await enviarAplazadas(new Date('2026-11-21T05:00:00Z')), { enviadas: 0, caducadas: 1, reintentos: 0, fallidas: 0 });
  const r = await enviarAplazadas(new Date('2026-11-21T06:05:00Z'));
  assert.equal(r.enviadas, 1, 'la misma clave, una vez');
  assert.equal(r.caducadas, 0);
  assert.match(enviados[0], /v2/, 'la última versión');
  assert.equal((await enviarAplazadas(new Date('2026-11-21T06:10:00Z'))).enviadas, 0, 'no se repite');
  guardarAjustes({ silencio: null });
});

test('G3 (seguridad, medio): la API devuelve las horas de silencio guardadas (el esquema no las quita)', async () => {
  const { buildApp } = await import('../app.ts');
  const { configAuth } = await import('../auth/mode.ts');
  const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  try {
    const put = await app.inject({ method: 'PUT', url: '/api/ajustes', payload: { silencio: MADRID } });
    assert.equal(put.statusCode, 200, put.body);
    assert.deepEqual((put.json() as { ajustes: { silencio: unknown } }).ajustes.silencio, MADRID);
    const get = await app.inject({ method: 'GET', url: '/api/ajustes' });
    assert.deepEqual((get.json() as { ajustes: { silencio: unknown } }).ajustes.silencio, MADRID);
    await app.inject({ method: 'PUT', url: '/api/ajustes', payload: { silencio: null } });
    assert.equal(((await app.inject({ method: 'GET', url: '/api/ajustes' })).json() as { ajustes: { silencio: unknown } }).ajustes.silencio, null);
  } finally {
    await app.close();
  }
});

test('G3 (seguridad, bajo): una configuración guardada a mano con una zona rota no tumba notificar: se envía normal', async () => {
  const { setMeta } = await import('../db.ts');
  const llamadas: string[] = [];
  configurarNotificaciones({ entorno: { WEBHOOK_URL: 'https://hooks.example/x' } as NodeJS.ProcessEnv, fetch: async (url) => (llamadas.push(String(url)), new Response('ok', { status: 200 })) });
  setMeta('ajustes.usuario', JSON.stringify({ silencio: { ...MADRID, zona: 'Marte/Olympus' } }));
  const r = await notificar('informe_semanal', { titulo: 'Con zona rota', cuerpo: 'x' }, { ahora: new Date('2026-11-20T23:30:00Z') });
  assert.equal(r.length, 1);
  assert.equal(llamadas.length, 1);
  guardarAjustes({ silencio: null });
});

test('G3 (data-guardian): lo silenciado no cuenta como envío fallido, y la cola tiene tope', async () => {
  const { resumenEnvios } = await import('./index.ts');
  const desde = new Date('2000-01-01T00:00:00Z');
  const r = resumenEnvios(desde);
  const silenciadas = (getDb().prepare("SELECT COUNT(*) AS n FROM notification_log WHERE channel = 'silencio'").get() as { n: number }).n;
  assert.ok(silenciadas > 0, 'hay anotaciones de silencio');
  const fallidosReales = (getDb().prepare("SELECT COUNT(*) AS n FROM notification_log WHERE ok = 0 AND channel <> 'silencio'").get() as { n: number }).n;
  assert.equal(r.fallidos, fallidosReales, 'el doctor no cuenta lo silenciado como fallo');
  assert.notEqual(r.ultimoError?.canal, 'silencio');
  // Tope de la cola: lo que pasa de MAX_PENDIENTES se anota y no se guarda.
  guardarAjustes({ silencio: { ...MADRID, modo: 'aplazar' } });
  const { MAX_PENDIENTES } = await import('./index.ts');
  const noche = new Date('2026-12-01T23:30:00Z');
  for (let i = 0; i < MAX_PENDIENTES + 5; i++) await notificar('digest_listo', { titulo: `Tope ${i}`, cuerpo: 'x' }, { ahora: noche });
  const enCola = (getDb().prepare('SELECT COUNT(*) AS n FROM notification_pending').get() as { n: number }).n;
  assert.equal(enCola, MAX_PENDIENTES);
  const desbordadas = (getDb().prepare("SELECT COUNT(*) AS n FROM notification_log WHERE channel = 'silencio' AND error LIKE 'descartada%'").get() as { n: number }).n;
  assert.equal(desbordadas, 5);
  guardarAjustes({ silencio: null });
});

test('G3 (data-guardian): con los canales apagados al vaciar la cola, lo aplazado se queda (y caduca con su anotación), no se borra sin rastro', async () => {
  const { reiniciarFeatures } = await import('../features.ts');
  configurarNotificaciones({ entorno: { WEBHOOK_URL: 'https://hooks.example/x' } as NodeJS.ProcessEnv, fetch: async () => new Response('ok', { status: 200 }) });
  getDb().exec('DELETE FROM notification_pending');
  guardarAjustes({ silencio: { ...MADRID, modo: 'aplazar', caducaHoras: 12 } });
  await notificar('digest_listo', { titulo: 'Apagado', cuerpo: 'x' }, { ahora: new Date('2026-12-05T23:30:00Z') });
  reiniciarFeatures(undefined, { 'notificaciones.canales': false });
  try {
    assert.deepEqual(await enviarAplazadas(new Date('2026-12-06T06:30:00Z')), { enviadas: 0, caducadas: 0, reintentos: 0, fallidas: 0 });
    assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM notification_pending WHERE title = 'Apagado'").get() as { n: number }).n, 1, 'sigue en la cola');
    assert.deepEqual(await enviarAplazadas(new Date('2026-12-06T12:00:00Z')), { enviadas: 0, caducadas: 1, reintentos: 0, fallidas: 0 }, 'y caduca anotada');
  } finally {
    reiniciarFeatures();
    guardarAjustes({ silencio: null });
  }
});
