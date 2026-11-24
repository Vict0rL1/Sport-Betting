// Fase G del seguimiento del PR #18: la entrega de lo aplazado por las horas de silencio, con
// transportes de mentira (nada sale a la red). Antes, un aviso aplazado se borraba de la cola y contaba
// como «enviado» aunque TODOS los canales lo rechazaran: un fallo se volvía un éxito y el aviso se perdía.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { notificar, configurarNotificaciones, enviarAplazadas, MAX_INTENTOS } = await import('./index.ts');
const { guardarAjustes } = await import('../ajustes/index.ts');
const { getDb } = await import('../db.ts');

const db = getDb();
const SILENCIO = { activo: true, desde: '23:00', hasta: '07:00', zona: 'Europe/Madrid', modo: 'aplazar' as const, caducaHoras: 12 };
const NOCHE = new Date('2026-11-20T23:30:00Z'); // 00:30 en Madrid: dentro de la ventana
const MANANA = new Date('2026-11-21T06:05:00Z'); // 07:05 en Madrid: fuera

/** Un webhook de mentira que contesta lo que se le diga y apunta lo que recibe (cabeceras incluidas). */
function webhook(respuesta: () => Response) {
  const recibidos: { cuerpo: string; clave: string | null }[] = [];
  configurarNotificaciones({
    entorno: { WEBHOOK_URL: 'https://hooks.example/x' } as NodeJS.ProcessEnv,
    fetch: async (_u, init) => {
      recibidos.push({ cuerpo: String(init?.body), clave: new Headers(init?.headers).get('idempotency-key') });
      return respuesta();
    },
  });
  return recibidos;
}

const pendiente = () => db.prepare('SELECT clave, attempts, last_error, deliver_after FROM notification_pending').all() as { clave: string; attempts: number; last_error: string | null; deliver_after: string }[];
const notas = () => (db.prepare("SELECT error FROM notification_log WHERE channel = 'silencio' ORDER BY id").all() as { error: string }[]).map((r) => r.error);

beforeEach(() => {
  db.exec('DELETE FROM notification_pending; DELETE FROM notification_log');
  guardarAjustes({ silencio: SILENCIO });
});

test('si ningún canal lo acepta, no cuenta como enviado: se queda, se reintenta con espera y, tras el máximo, se descarta con su nota', async () => {
  const recibidos = webhook(() => new Response('caído', { status: 503 }));
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'x', url: '/informes/1' }, { ahora: NOCHE });
  const r1 = await enviarAplazadas(MANANA);
  assert.equal(r1.enviadas, 0, 'un 503 no es un envío');
  assert.equal(r1.reintentos, 1);
  assert.equal(pendiente()[0].attempts, 1);
  assert.match(pendiente()[0].last_error ?? '', /503/);
  assert.ok(Date.parse(pendiente()[0].deliver_after) > MANANA.getTime(), 'el siguiente intento, más tarde');
  assert.equal((await enviarAplazadas(new Date(MANANA.getTime() + 60_000))).reintentos, 0, 'antes de la espera, nada');
  // Intento a intento hasta el máximo (cada vez después de su espera).
  let ahora = MANANA;
  for (let i = 1; i < MAX_INTENTOS; i++) {
    ahora = new Date(Date.parse(pendiente()[0].deliver_after) + 1000);
    await enviarAplazadas(ahora);
  }
  assert.equal(pendiente().length, 0, 'tras el máximo de intentos sale de la cola');
  assert.equal(recibidos.length, MAX_INTENTOS);
  assert.ok(notas().some((n) => /descartada tras \d+ intentos/.test(n)), notas().join(' | '));
});

test('un rechazo definitivo (HTTP 4xx) no se reintenta: se descarta con su nota', async () => {
  webhook(() => new Response('malo', { status: 400 }));
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'x' }, { ahora: NOCHE });
  const r = await enviarAplazadas(MANANA);
  assert.deepEqual([r.enviadas, r.reintentos, r.fallidas], [0, 0, 1]);
  assert.equal(pendiente().length, 0);
  assert.ok(notas().some((n) => /rechazo definitivo/.test(n)));
});

test('aceptado por al menos un canal: sale de la cola y cuenta; los fallos de los demás quedan anotados', async () => {
  configurarNotificaciones({
    entorno: { WEBHOOK_URL: 'https://hooks.example/x', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' } as NodeJS.ProcessEnv,
    fetch: async (u) => new Response('', { status: String(u).includes('telegram') ? 502 : 200 }),
  });
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'x' }, { ahora: NOCHE });
  const r = await enviarAplazadas(MANANA);
  assert.equal(r.enviadas, 1);
  assert.equal(pendiente().length, 0);
  const canales = db.prepare("SELECT channel, ok FROM notification_log WHERE channel <> 'silencio' ORDER BY channel").all() as { channel: string; ok: number }[];
  assert.deepEqual(canales.map((c) => [c.channel, c.ok]), [['telegram', 0], ['webhook', 1]]);
});

test('reiniciar el proceso no pierde la cola: está en la base, y sale al acabar la ventana', async () => {
  webhook(() => new Response('ok', { status: 200 }));
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'x' }, { ahora: NOCHE });
  // «Reinicio»: transportes nuevos, la misma base. Durante la ventana, nada; después, una vez.
  const recibidos = webhook(() => new Response('ok', { status: 200 }));
  assert.equal((await enviarAplazadas(new Date('2026-11-21T05:00:00Z'))).enviadas, 0);
  assert.equal((await enviarAplazadas(MANANA)).enviadas, 1);
  assert.equal(recibidos.length, 1);
});

test('la entrega es «al menos una vez»: si la fila vuelve (una copia restaurada, o una caída tras enviar), se envía otra vez con la MISMA clave de idempotencia', async () => {
  const recibidos = webhook(() => new Response('ok', { status: 200 }));
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'x' }, { ahora: NOCHE });
  const fila = db.prepare('SELECT * FROM notification_pending').get() as Record<string, string | number | null>;
  assert.equal((await enviarAplazadas(MANANA)).enviadas, 1);
  // La copia de seguridad de antes del envío vuelve a traer la fila.
  db.prepare('INSERT INTO notification_pending (clave, created_at, event_type, title, body, url, deliver_after, expires_at, attempts, last_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    fila.clave, fila.created_at, fila.event_type, fila.title, fila.body, fila.url, fila.deliver_after, fila.expires_at, fila.attempts, fila.last_error,
  );
  assert.equal((await enviarAplazadas(new Date(MANANA.getTime() + 60_000))).enviadas, 1, 'se repite: no hay «exactamente una vez»');
  assert.equal(recibidos.length, 2);
  assert.ok(recibidos[0].clave, 'el webhook recibe una clave de idempotencia');
  assert.equal(recibidos[0].clave, recibidos[1].clave, 'la misma: el receptor puede descartar el duplicado');
  assert.ok(!String(recibidos[0].clave).includes('Resumen'), 'la clave no lleva el contenido del aviso');
});

test('data-guardian: si llega una versión nueva mientras se envía la vieja, la nueva no se borra ni hereda sus intentos', async () => {
  let nueva = false;
  configurarNotificaciones({
    entorno: { WEBHOOK_URL: 'https://hooks.example/x' } as NodeJS.ProcessEnv,
    fetch: async () => {
      // Durante el envío de v1 (la ventana vuelve a empezar), llega v2 con la misma clave.
      if (!nueva) {
        nueva = true;
        await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'v2' }, { ahora: new Date('2026-11-21T22:30:00Z') });
      }
      return new Response('ok', { status: 200 });
    },
  });
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'v1' }, { ahora: NOCHE });
  assert.equal((await enviarAplazadas(MANANA)).enviadas, 1);
  const quedan = db.prepare('SELECT body, attempts FROM notification_pending').all() as { body: string; attempts: number }[];
  assert.deepEqual(quedan.map((q) => ({ ...q })), [{ body: 'v2', attempts: 0 }], 'v2 sigue en la cola, con sus intentos a cero');
});

test('data-guardian: una versión nueva de un aviso que fallaba empieza con cero intentos', async () => {
  webhook(() => new Response('caído', { status: 503 }));
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'v1' }, { ahora: NOCHE });
  db.prepare("UPDATE notification_pending SET attempts = 4, last_error = 'webhook: HTTP 503'").run();
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'v2' }, { ahora: new Date(NOCHE.getTime() + 60_000) });
  assert.deepEqual({ ...(db.prepare('SELECT attempts, last_error FROM notification_pending').get() as object) }, { attempts: 0, last_error: null });
});

test('seguridad: un error de canal no guarda secretos (URL del webhook, token, contraseña) en el registro ni en la cola', async () => {
  const URL_SECRETA = 'https://bot:S3CR3T-PASS@hooks.example.invalid/in/XOXB-SECRET-TOKEN';
  configurarNotificaciones({
    entorno: { WEBHOOK_URL: URL_SECRETA, TELEGRAM_BOT_TOKEN: '123:TG-SECRET', TELEGRAM_CHAT_ID: '1' } as NodeJS.ProcessEnv,
    // Como undici: construir la petición falla y el mensaje lleva la URL entera.
    fetch: async (u) => {
      new Request(String(u));
      return new Response('', { status: 502 });
    },
  });
  await notificar('digest_listo', { titulo: 'Resumen', cuerpo: 'x' }, { ahora: NOCHE });
  await enviarAplazadas(MANANA);
  const todo = JSON.stringify([db.prepare('SELECT error FROM notification_log').all(), db.prepare('SELECT last_error FROM notification_pending').all()]);
  for (const s of ['S3CR3T-PASS', 'XOXB-SECRET-TOKEN', 'TG-SECRET']) assert.ok(!todo.includes(s), `se guardó ${s}: ${todo}`);
  assert.match(todo, /webhook/, 'el fallo se sigue anotando');
});
