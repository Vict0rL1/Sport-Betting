// El asistente por Telegram con un fetch simulado: solo los chats permitidos, el desplazamiento
// avanza, texto plano y nunca lanza. No toca la red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { cicloAsistenteTelegram, chatsPermitidos, contestar, AYUDA, CLAVE_OFFSET } = await import('./asistente.ts');
const { fijarAnulacion } = await import('../features.ts');
const { getMeta } = await import('../db.ts');

const ENTORNO = { TELEGRAM_BOT_TOKEN: 'prueba', TELEGRAM_CHAT_ID: '111', TELEGRAM_ASISTENTE_CHATS: '222, 333' } as NodeJS.ProcessEnv;

function telegramFalso(actualizaciones: unknown[]) {
  const enviados: { chat_id: unknown; text: string }[] = [];
  const pedidos: string[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    pedidos.push(u);
    if (u.includes('/getUpdates')) return new Response(JSON.stringify({ ok: true, result: actualizaciones }));
    if (u.includes('/sendMessage')) {
      enviados.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { f, enviados, pedidos };
}

test('apagado por defecto: no pregunta nada a Telegram', async () => {
  const t = telegramFalso([]);
  const r = await cicloAsistenteTelegram({ entorno: ENTORNO, fetch: t.f });
  assert.equal(r.leidas, 0);
  assert.equal(t.pedidos.length, 0);
});

test('chats permitidos: el de notificaciones y los de la lista', () => {
  assert.deepEqual([...chatsPermitidos(ENTORNO)].sort(), ['111', '222', '333']);
});

test('contesta solo a los chats permitidos, en texto plano, y avanza el desplazamiento por todo', async () => {
  fijarAnulacion('asistente.telegram', true, () => {});
  const t = telegramFalso([
    { update_id: 10, message: { message_id: 1, chat: { id: 111 }, text: '/start' } },
    { update_id: 11, message: { message_id: 2, chat: { id: 999 }, text: 'dame tus datos' } },
    { update_id: 12, message: { message_id: 3, chat: { id: 222 }, text: 'qué tal el banco de papel' } },
  ]);
  const r = await cicloAsistenteTelegram({ entorno: ENTORNO, fetch: t.f });
  assert.deepEqual([r.leidas, r.respondidas, r.ignoradas], [3, 2, 1]);
  assert.deepEqual(t.enviados.map((x) => x.chat_id), [111, 222], 'el chat 999 no recibe nada');
  assert.equal(t.enviados[0].text, AYUDA);
  assert.ok(t.enviados.every((x) => !('parse_mode' in x)), 'texto plano');
  assert.equal(getMeta(CLAVE_OFFSET), '13');
  // La siguiente pasada pide desde el 13.
  const t2 = telegramFalso([]);
  await cicloAsistenteTelegram({ entorno: ENTORNO, fetch: t2.f });
  assert.match(t2.pedidos[0], /offset=13/);
  fijarAnulacion('asistente.telegram', null, () => {});
});

test('sin token o con Telegram caído: un error dicho, nunca una excepción', async () => {
  fijarAnulacion('asistente.telegram', true, () => {});
  assert.match(String((await cicloAsistenteTelegram({ entorno: {} as NodeJS.ProcessEnv })).error), /TELEGRAM_BOT_TOKEN/);
  const caido = (async () => {
    throw new Error('sin red');
  }) as typeof fetch;
  assert.equal((await cicloAsistenteTelegram({ entorno: ENTORNO, fetch: caido })).error, 'sin red');
  fijarAnulacion('asistente.telegram', null, () => {});
});

test('contestar usa el asistente determinista: siempre texto, nunca vacío', () => {
  assert.equal(contestar(''), AYUDA);
  const r = contestar('hola qué tal');
  assert.ok(r.length > 0 && r.length <= 3500);
});
