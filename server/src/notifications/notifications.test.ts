// Notificaciones: sin variables nada sale y se dice qué falta; con Telegram y webhook
// simulados sale, queda en el registro, y un fallo no lanza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { canales, notificar, probarCanal, ultimosEnvios, configurarNotificaciones, guardarSuscripcionPush, borrarSuscripcionPush, EVENTOS } = await import('./index.ts');

test('sin variables: ningún canal configurado, notificar no envía, probar dice qué falta', async () => {
  configurarNotificaciones({ entorno: {} as NodeJS.ProcessEnv, fetch: async () => { throw new Error('no debería llamar'); } });
  const c = canales();
  assert.deepEqual(c.map((x) => x.nombre), ['telegram', 'webhook', 'email', 'webpush']);
  assert.ok(c.every((x) => !x.configurado));
  assert.deepEqual(c.find((x) => x.nombre === 'telegram')!.falta, ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']);
  assert.deepEqual(await notificar('senal_valor', { titulo: 't', cuerpo: 'b' }), []);
  const p = await probarCanal('telegram');
  assert.equal(p.ok, false);
  assert.match(p.error ?? '', /faltan TELEGRAM_BOT_TOKEN/);
  assert.match((await probarCanal('otro')).error ?? '', /desconocido/);
  assert.ok(Object.keys(EVENTOS).length >= 7);
});

test('telegram y webhook simulados: formato correcto, registro con ok/error, un fallo no lanza', async () => {
  const llamadas: { url: string; body: unknown }[] = [];
  configurarNotificaciones({
    entorno: { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '42', WEBHOOK_URL: 'https://hooks.example/x' } as NodeJS.ProcessEnv,
    fetch: async (url, init) => {
      llamadas.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      if (String(url).includes('hooks.example')) return new Response('bad', { status: 500 });
      return new Response('{"ok":true}', { status: 200 });
    },
  });
  const r = await notificar('papel_apostada', { titulo: 'Apuesta de papel', cuerpo: 'Arsenal 2.10 · 12 €', url: '/?tab=football' });
  assert.deepEqual(r.map((x) => [x.canal, x.ok]), [['telegram', true], ['webhook', false]]);
  assert.match(r[1].error ?? '', /HTTP 500/);
  assert.equal(llamadas[0].url, 'https://api.telegram.org/bottok/sendMessage');
  assert.deepEqual((llamadas[0].body as { chat_id: string }).chat_id, '42');
  assert.match((llamadas[0].body as { text: string }).text, /\*Apuesta de papel\*\nArsenal/);
  assert.match((llamadas[1].body as { content: string }).content, /\*\*Apuesta de papel\*\*/);
  const log = ultimosEnvios(5);
  assert.equal(log.length, 2);
  assert.deepEqual(log.map((l) => [l.channel, l.ok]), [['webhook', 0], ['telegram', 1]]);
  assert.equal(log[1].event_type, 'papel_apostada');
  // fetch que explota: tampoco lanza.
  configurarNotificaciones({ fetch: async () => { throw new Error('ECONNRESET'); } });
  const r2 = await notificar('trabajo_fallido', { titulo: 'x', cuerpo: 'y' });
  assert.ok(r2.every((x) => !x.ok && /ECONNRESET/.test(x.error ?? '')));
});

test('suscripciones Web Push: se guardan con sus claves, se reemplazan y se borran', () => {
  assert.deepEqual(guardarSuscripcionPush('https://push.example/1', { p256dh: 'a', auth: 'b' }), { guardada: true });
  assert.deepEqual(guardarSuscripcionPush('https://push.example/1', { p256dh: 'a2', auth: 'b2' }), { guardada: true });
  assert.deepEqual(guardarSuscripcionPush('', { p256dh: 'a', auth: 'b' }), { guardada: false });
  assert.equal(borrarSuscripcionPush('https://push.example/1'), 1);
  assert.equal(borrarSuscripcionPush('https://push.example/1'), 0);
});
