// El asistente por Telegram (Fase 8.3): el MISMO asistente determinista de /api/ask —las mismas
// plantillas permitidas, ningún modelo de lenguaje, ninguna consulta libre— contestando en un bot.
//
// · Token: el de las notificaciones (TELEGRAM_BOT_TOKEN). Interruptor `asistente.telegram`, apagado.
// · Quién: solo los chats de TELEGRAM_CHAT_ID y de TELEGRAM_ASISTENTE_CHATS (separados por comas).
//   Un mensaje de cualquier otro chat se lee (para avanzar el desplazamiento) y no se contesta: un bot
//   que responde a cualquiera es una puerta a los datos del libro mayor.
// · Cómo: un trabajo programado pide `getUpdates` sin esperar (timeout 0) y contesta lo que haya. El
//   desplazamiento se guarda en el libro mayor (`telegram:offset`) para no contestar dos veces.
// · Texto plano: sin parse_mode, así ningún nombre de equipo con un asterisco rompe el mensaje.
// Nunca lanza: un Telegram caído no puede tumbar el registro de trabajos.

import { getMeta, setMeta } from '../db.ts';
import { featureEncendida } from '../features.ts';
import { responderAgente } from '../ask/agent.ts';
import { responder } from '../ask/router.ts';

export const CLAVE_OFFSET = 'telegram:offset';
const MAX_TEXTO = 3500;

export const AYUDA =
  'Pregúntame por un jugador («Sinner»), un partido («Alcaraz contra Sinner»), los partidos de hoy, el banco de papel o la confianza del sistema. ' +
  'Contesto con los datos de la app y nunca invento cifras; lo que no sé, lo digo.';

export interface Actualizacion {
  update_id: number;
  message?: { message_id: number; chat: { id: number | string }; text?: string };
}

export function chatsPermitidos(e: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    [e.TELEGRAM_CHAT_ID, ...(e.TELEGRAM_ASISTENTE_CHATS ?? '').split(',')]
      .map((x) => String(x ?? '').trim())
      .filter(Boolean),
  );
}

/** La respuesta a un texto: el agente para comparaciones, el enrutador determinista para lo demás. */
export function contestar(texto: string): string {
  const t = texto.trim();
  if (!t || /^\/(start|ayuda|help)\b/i.test(t)) return AYUDA;
  const pregunta = t.replace(/^\/\w+\s*/, '').slice(0, 300);
  const ag = responderAgente(pregunta);
  if (ag.pasos.length > 1) return ag.texto.slice(0, MAX_TEXTO);
  const r = responder(pregunta);
  const filas = (r.filas ?? []).slice(0, 12).map((f) => `· ${f.etiqueta}: ${f.valor}`);
  return [r.texto, ...filas, r.fuente ? `(${r.fuente})` : ''].filter(Boolean).join('\n').slice(0, MAX_TEXTO);
}

export async function cicloAsistenteTelegram(
  opts: { entorno?: NodeJS.ProcessEnv; fetch?: typeof fetch; log?: (m: string) => void } = {},
): Promise<{ leidas: number; respondidas: number; ignoradas: number; error: string | null }> {
  const e = opts.entorno ?? process.env;
  const f = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const vacio = { leidas: 0, respondidas: 0, ignoradas: 0, error: null };
  if (!featureEncendida('asistente.telegram')) return vacio;
  const token = e.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ...vacio, error: 'falta TELEGRAM_BOT_TOKEN' };
  const permitidos = chatsPermitidos(e);
  const base = `https://api.telegram.org/bot${token}`;
  try {
    const offset = Number(getMeta(CLAVE_OFFSET) ?? 0) || 0;
    const res = await f(`${base}/getUpdates?timeout=0&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`);
    const j = (await res.json()) as { ok: boolean; result?: Actualizacion[]; description?: string };
    if (!j.ok) return { ...vacio, error: j.description ?? `HTTP ${res.status}` };
    const xs = j.result ?? [];
    let respondidas = 0;
    let ignoradas = 0;
    for (const u of xs) {
      const m = u.message;
      if (!m?.text || !permitidos.has(String(m.chat.id))) {
        ignoradas++;
        continue;
      }
      const r = await f(`${base}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: m.chat.id, text: contestar(m.text), reply_to_message_id: m.message_id, disable_web_page_preview: true }),
      });
      if (r.ok) respondidas++;
    }
    // Avanzar SIEMPRE el desplazamiento, también por lo ignorado: si no, cada pasada relee lo mismo.
    if (xs.length) setMeta(CLAVE_OFFSET, String(Math.max(...xs.map((u) => u.update_id)) + 1));
    if (respondidas || ignoradas) log(`Asistente de Telegram: ${respondidas} respuesta(s), ${ignoradas} mensaje(s) ignorado(s).`);
    return { leidas: xs.length, respondidas, ignoradas, error: null };
  } catch (err) {
    return { ...vacio, error: (err as Error).message };
  }
}
