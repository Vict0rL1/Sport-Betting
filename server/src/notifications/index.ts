// Notificaciones (Fase 3.6): qué eventos salen, por qué canales, y un registro de cada intento.
//
// La app ya tenía alertas internas (alerts/) y un canal en vivo para la pantalla (latency/
// alert.ts). Esto es lo que llega CUANDO NO ESTÁS MIRANDO: el teléfono, Telegram, el correo,
// Discord. Cada canal se configura con variables de entorno; sin ninguna, todo queda en «no
// configurado» y la app no se queja. Nunca lanza: una notificación que no sale no puede
// tumbar el ciclo que la provocó.

import { createHash } from 'node:crypto';
import { getDb } from '../db.ts';
import { leerAjustes } from '../ajustes/index.ts';
import { enSilencio, finDeSilencio, type Silencio } from './silencio.ts';
import { featureEncendida } from '../features.ts';
import { email, telegram, webhook, webpush, type Canal, type Mensaje, type ResultadoEnvio, type SuscripcionPush } from './channels.ts';
import { guardarEnBandeja, type Severidad } from '../bandeja/index.ts';

export type TipoEvento = 'senal_valor' | 'linea_movida' | 'papel_apostada' | 'papel_liquidada' | 'digest_listo' | 'informe_semanal' | 'trabajo_fallido' | 'deriva' | 'prueba';

export const EVENTOS: Record<TipoEvento, string> = {
  senal_valor: 'el modelo ve valor en un partido',
  linea_movida: 'la línea de un partido seguido se ha movido',
  papel_apostada: 'el banco de papel ha apostado',
  papel_liquidada: 'una apuesta de papel se ha liquidado',
  digest_listo: 'el resumen del día está listo',
  informe_semanal: 'el informe semanal está listo',
  trabajo_fallido: 'un trabajo de datos ha fallado',
  deriva: 'deriva detectada en un modelo',
  prueba: 'mensaje de prueba',
};

let entornoActual: NodeJS.ProcessEnv = process.env;
let fetchActual: typeof fetch = (...a) => fetch(...a);

/** Para los tests: otro entorno y otro fetch. */
export function configurarNotificaciones(opts: { entorno?: NodeJS.ProcessEnv; fetch?: typeof fetch }): void {
  if (opts.entorno) entornoActual = opts.entorno;
  if (opts.fetch) fetchActual = opts.fetch;
}

function suscripciones(): SuscripcionPush[] {
  try {
    return (getDb().prepare('SELECT endpoint, keys_json FROM push_subscriptions WHERE failures < 5').all() as { endpoint: string; keys_json: string }[]).map((r) => ({ endpoint: r.endpoint, keys: JSON.parse(r.keys_json) as SuscripcionPush['keys'] }));
  } catch {
    return [];
  }
}

function falloPush(endpoint: string, definitivo: boolean): void {
  try {
    const db = getDb();
    if (definitivo) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
    else db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?').run(endpoint);
  } catch {
    // nada
  }
}

const CANALES: Canal[] = [telegram, webhook, email, webpush(suscripciones, falloPush)];

export interface EstadoCanal {
  nombre: string;
  configurado: boolean;
  falta: string[];
  descripcion: string;
}

export function canales(): EstadoCanal[] {
  return CANALES.map((c) => {
    const falta = c.falta(entornoActual);
    return { nombre: c.nombre, configurado: falta.length === 0, falta, descripcion: c.descripcion };
  });
}

function anotar(canal: string, evento: TipoEvento, titulo: string, r: ResultadoEnvio, ms: number): void {
  try {
    getDb().prepare('INSERT INTO notification_log (created_at, channel, event_type, title, ok, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(new Date().toISOString(), canal, evento, titulo.slice(0, 200), r.ok ? 1 : 0, r.error, ms);
  } catch {
    // el registro no puede impedir el envío
  }
}

const SEVERIDAD: Partial<Record<TipoEvento, Severidad>> = { trabajo_fallido: 'aviso', deriva: 'importante' };

/**
 * Envía por todos los canales configurados. Nunca lanza.
 *
 * Y antes, a la bandeja de la app (Fase 6.4), haya canales o no: sin canales es el único sitio
 * donde se ve el aviso. `bandeja: false` lo usa quien ya la ha escrito (las alertas).
 */
export async function notificar(
  evento: TipoEvento,
  m: Mensaje,
  opciones: { bandeja?: boolean; sport?: string | null; matchKey?: string | null; severidad?: Severidad; ahora?: Date } = {},
): Promise<{ canal: string; ok: boolean; error: string | null }[]> {
  if (opciones.bandeja !== false && evento !== 'prueba') {
    guardarEnBandeja({ origen: 'notificacion', tipo: evento, severidad: opciones.severidad ?? SEVERIDAD[evento] ?? 'info', sport: opciones.sport, matchKey: opciones.matchKey, titulo: m.titulo, cuerpo: m.cuerpo, url: m.url ?? null });
  }
  if (!featureEncendida('notificaciones.canales')) return [];
  // Horas de silencio (G3): solo los canales externos; la bandeja ya lo tiene.
  // Si algo falla al decidirlo, se envía normal: el silencio nunca puede tumbar un aviso (ni el
  // proceso: los que llaman hacen `void notificar(...)`).
  const ahora = opciones.ahora ?? new Date();
  try {
    const silencio = leerAjustes().silencio;
    if (evento !== 'prueba' && silencio && enSilencio(ahora, silencio)) {
      if (silencio.modo === 'aplazar') {
        const r = aplazar(evento, m, ahora, silencio);
        anotar('silencio', evento, m.titulo, { ok: false, error: r === 'aplazada' ? 'aplazada: horas de silencio' : r === 'desbordada' ? 'descartada: la cola de aplazados está llena' : 'descartada: no se pudo aplazar' }, 0);
      } else anotar('silencio', evento, m.titulo, { ok: false, error: 'suprimida: horas de silencio' }, 0);
      return [];
    }
  } catch {
    // Configuración ilegible: como sin silencio.
  }
  return enviarPorCanales(evento, m);
}

/** Tope de la cola de aplazados (revisión data-guardian de G3): lo que pasa se anota y no se guarda. */
export const MAX_PENDIENTES = 200;

/**
 * Envíos de las últimas horas para el doctor. Las anotaciones del silencio (suprimidas, aplazadas,
 * caducadas) no son envíos fallidos y no cuentan (revisión data-guardian de G3).
 */
export function resumenEnvios(desde: Date): { ok: number; fallidos: number; ultimoError: { canal: string; error: string } | null } {
  const db = getDb();
  const r = db.prepare("SELECT SUM(ok = 1) AS bien, SUM(ok = 0) AS mal FROM notification_log WHERE created_at >= ? AND channel <> 'silencio'").get(desde.toISOString()) as { bien: number | null; mal: number | null };
  const u = db.prepare("SELECT channel, error FROM notification_log WHERE ok = 0 AND channel <> 'silencio' AND created_at >= ? ORDER BY created_at DESC LIMIT 1").get(desde.toISOString()) as { channel: string; error: string | null } | undefined;
  return { ok: r.bien ?? 0, fallidos: r.mal ?? 0, ultimoError: u ? { canal: u.channel, error: u.error ?? 'sin detalle' } : null };
}

/**
 * Guarda un aviso para el final de la ventana; con la misma clave, gana la última versión. Antes,
 * quita lo caducado (con su anotación) y respeta el tope de la cola.
 */
function aplazar(evento: TipoEvento, m: Mensaje, ahora: Date, s: Silencio): 'aplazada' | 'desbordada' | 'error' {
  const fin = finDeSilencio(ahora, s) ?? ahora;
  const clave = `${evento}|${m.titulo}|${m.url ?? ''}`;
  try {
    const db = getDb();
    for (const c of db.prepare('SELECT clave, event_type, title FROM notification_pending WHERE expires_at <= ?').all(ahora.toISOString()) as { clave: string; event_type: TipoEvento; title: string }[]) {
      db.prepare('DELETE FROM notification_pending WHERE clave = ?').run(c.clave);
      anotar('silencio', c.event_type, c.title, { ok: false, error: 'caducada: no se envió tras las horas de silencio' }, 0);
    }
    const ya = db.prepare('SELECT 1 FROM notification_pending WHERE clave = ?').get(clave);
    if (!ya && (db.prepare('SELECT COUNT(*) AS n FROM notification_pending').get() as { n: number }).n >= MAX_PENDIENTES) return 'desbordada';
    db
      .prepare(
        `INSERT INTO notification_pending (clave, created_at, event_type, title, body, url, deliver_after, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (clave) DO UPDATE SET body = excluded.body, deliver_after = excluded.deliver_after, expires_at = excluded.expires_at, created_at = excluded.created_at,
           attempts = 0, last_error = NULL`,
      )
      .run(clave, ahora.toISOString(), evento, m.titulo, m.cuerpo, m.url ?? null, fin.toISOString(), new Date(ahora.getTime() + s.caducaHoras * 3_600_000).toISOString());
    return 'aplazada';
  } catch {
    // Sin la tabla (una base sin migrar): el aviso sigue en la bandeja, y se anota que no se aplazó.
    return 'error';
  }
}

/** Intentos sin que ningún canal acepte un aviso aplazado, antes de descartarlo (fase G del seguimiento del PR #18). */
export const MAX_INTENTOS = 5;
/** La espera tras el intento n (1, 2, …): 5, 10, 20, 40 minutos. */
const espera = (intentos: number) => 5 * 60_000 * 2 ** Math.max(0, intentos - 1);

/**
 * Un rechazo que no se arregla reintentando: un HTTP 4xx salvo 408 (tiempo agotado) y 429 (demasiadas
 * peticiones). Lo demás (5xx, red caída, tiempo agotado) puede ir mejor más tarde.
 */
export function esDefinitivo(error: string | null): boolean {
  const m = /^HTTP (\d{3})/.exec(error ?? '');
  if (!m) return false;
  const c = Number(m[1]);
  return c >= 400 && c < 500 && c !== 408 && c !== 429;
}

/**
 * Una clave de idempotencia para un aviso aplazado: la misma cada vez que se intenta ESA versión (la
 * clave de la cola y cuándo se aplazó), y sin su contenido (es un resumen SHA-256). La lleva el webhook
 * en `Idempotency-Key`: el receptor puede descartar un duplicado. Telegram, el correo y Web Push no
 * tienen dónde ponerla.
 */
export const claveIdempotencia = (clave: string, creadaEn: string) => createHash('sha256').update(`${clave}|${creadaEn}`).digest('hex').slice(0, 32);

/**
 * Envía lo aplazado cuya ventana ya acabó (y que no ha caducado) y anota y quita lo caducado. Lo llama
 * el programador cada pocos minutos.
 *
 * LA GARANTÍA, dicha como es: AL MENOS UNA VEZ, no «exactamente una vez».
 *   · «Enviado» quiere decir ACEPTADO por al menos un canal (el proveedor contestó que sí). Si el
 *     destinatario lo vio, la app no lo sabe: ningún canal lo confirma.
 *   · Si ningún canal lo acepta, no cuenta: se queda, con su intento y su error, y se reintenta con
 *     espera (5, 10, 20, 40 min) hasta MAX_INTENTOS o hasta que caduque. Un rechazo definitivo (4xx) no
 *     se reintenta. Lo que se descarta queda anotado en notification_log.
 *   · Se envía y DESPUÉS se quita de la cola: si el proceso cae entre medias, o se restaura una copia
 *     de antes del envío, el aviso sale otra vez. Es la ventana inevitable sin un acuse del proveedor;
 *     el webhook lleva la misma `Idempotency-Key` las dos veces para que el receptor la descarte.
 *   · Con un aviso aceptado por un canal y rechazado por otro, sale de la cola (no se reenvía a quien
 *     ya lo aceptó) y el rechazo queda anotado en su canal.
 */
export async function enviarAplazadas(ahora = new Date()): Promise<{ enviadas: number; caducadas: number; reintentos: number; fallidas: number }> {
  let filas: { clave: string; created_at: string; event_type: TipoEvento; title: string; body: string; url: string | null; deliver_after: string; expires_at: string; attempts: number; last_error: string | null }[];
  try {
    filas = getDb().prepare('SELECT clave, created_at, event_type, title, body, url, deliver_after, expires_at, attempts, last_error FROM notification_pending ORDER BY created_at').all() as typeof filas;
  } catch {
    return { enviadas: 0, caducadas: 0, reintentos: 0, fallidas: 0 };
  }
  let enviadas = 0;
  let caducadas = 0;
  let reintentos = 0;
  let fallidas = 0;
  // Por clave Y versión (created_at): si mientras se enviaba la vieja llegó otra versión, esa se queda
  // (revisión data-guardian).
  const quitar = (f: { clave: string; created_at: string }) => getDb().prepare('DELETE FROM notification_pending WHERE clave = ? AND created_at = ?').run(f.clave, f.created_at).changes > 0;
  for (const f of filas) {
    const caduca = Date.parse(f.expires_at) <= ahora.getTime();
    if (caduca) {
      if (quitar(f)) {
        caducadas++;
        anotar('silencio', f.event_type, f.title, { ok: false, error: `caducada: no se envió tras las horas de silencio${f.last_error ? ` (último error: ${f.last_error})` : ''}` }, 0);
      }
      continue;
    }
    if (Date.parse(f.deliver_after) > ahora.getTime() || enSilencio(ahora, leerAjustes().silencio)) continue;
    // Con los canales apagados se quedan en la cola (caducarán con su anotación), no se borran sin
    // rastro (revisión data-guardian de G3). Lo mismo si no hay ningún canal configurado.
    if (!featureEncendida('notificaciones.canales')) continue;
    const r = await enviarPorCanales(f.event_type, { titulo: f.title, cuerpo: f.body, url: f.url ?? undefined, id: claveIdempotencia(f.clave, f.created_at) });
    if (r.length === 0) continue;
    if (r.some((x) => x.ok)) {
      // Se envió esta versión aunque otra la haya sustituido entretanto: cuenta como enviada.
      quitar(f);
      enviadas++;
      continue;
    }
    // Nadie lo aceptó: no es un envío.
    const intentos = (f.attempts ?? 0) + 1;
    const error = r.map((x) => `${x.canal}: ${x.error ?? '?'}`).join('; ').slice(0, 300);
    if (r.every((x) => esDefinitivo(x.error))) {
      quitar(f);
      fallidas++;
      anotar('silencio', f.event_type, f.title, { ok: false, error: `descartada: rechazo definitivo (${error})` }, 0);
    } else if (intentos >= MAX_INTENTOS) {
      quitar(f);
      fallidas++;
      anotar('silencio', f.event_type, f.title, { ok: false, error: `descartada tras ${intentos} intentos (${error})` }, 0);
    } else {
      const c = getDb()
        .prepare('UPDATE notification_pending SET attempts = ?, last_error = ?, deliver_after = ? WHERE clave = ? AND created_at = ?')
        .run(intentos, error, new Date(ahora.getTime() + espera(intentos)).toISOString(), f.clave, f.created_at).changes;
      if (c > 0) reintentos++;
    }
  }
  return { enviadas, caducadas, reintentos, fallidas };
}

/**
 * Un error de canal sin secretos, antes de guardarlo o devolverlo (revisión de seguridad). Un transporte
 * puede meter en su mensaje la URL entera del webhook (con `usuario:contraseña@` o un token en la ruta),
 * y ese texto acaba en notification_log, en la cola y en las copias del libro mayor.
 */
export function sinSecretos(error: string | null, entorno: NodeJS.ProcessEnv = entornoActual): string | null {
  if (error == null) return null;
  let s = error;
  for (const k of ['WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN', 'SMTP_PASS', 'SMTP_USER', 'VAPID_PRIVATE_KEY']) {
    const v = entorno[k]?.trim();
    if (v && v.length >= 4) s = s.split(v).join(`[${k}]`);
  }
  return s.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***@');
}

async function enviarPorCanales(evento: TipoEvento, m: Mensaje): Promise<{ canal: string; ok: boolean; error: string | null }[]> {
  const out: { canal: string; ok: boolean; error: string | null }[] = [];
  for (const c of CANALES) {
    if (c.falta(entornoActual).length) continue;
    const t0 = Date.now();
    const crudo = await c.enviar(m, entornoActual, fetchActual).catch((e) => ({ ok: false, error: (e as Error).message }) as ResultadoEnvio);
    const r = { ...crudo, error: sinSecretos(crudo.error) };
    anotar(c.nombre, evento, m.titulo, r, Date.now() - t0);
    out.push({ canal: c.nombre, ok: r.ok, error: r.error });
  }
  return out;
}

/** «Enviar prueba» de la pantalla: por UN canal, configurado o no (si no, dice qué falta). */
export async function probarCanal(nombre: string): Promise<{ ok: boolean; canal: string; error: string | null }> {
  const c = CANALES.find((x) => x.nombre === nombre);
  if (!c) return { ok: false, canal: nombre, error: `canal desconocido: ${nombre}` };
  const falta = c.falta(entornoActual);
  if (falta.length) return { ok: false, canal: nombre, error: `sin configurar: faltan ${falta.join(', ')}` };
  const t0 = Date.now();
  const crudo = await c.enviar({ titulo: 'Sports Predictor: prueba', cuerpo: `Si lees esto, el canal «${nombre}» funciona.`, url: '/' }, entornoActual, fetchActual).catch((e) => ({ ok: false, error: (e as Error).message }) as ResultadoEnvio);
  const r = { ...crudo, error: sinSecretos(crudo.error) };
  anotar(c.nombre, 'prueba', 'prueba', r, Date.now() - t0);
  return { ok: r.ok, canal: nombre, error: r.error };
}

export function ultimosEnvios(limite = 20): { id: number; created_at: string; channel: string; event_type: string; title: string; ok: number; error: string | null; duration_ms: number | null }[] {
  try {
    return getDb().prepare('SELECT * FROM notification_log ORDER BY id DESC LIMIT ?').all(limite) as never;
  } catch {
    return [];
  }
}

export function guardarSuscripcionPush(endpoint: string, keys: Record<string, string>): { guardada: boolean } {
  if (!endpoint || !keys.p256dh || !keys.auth) return { guardada: false };
  getDb().prepare('INSERT INTO push_subscriptions (endpoint, keys_json, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json, failures = 0').run(endpoint, JSON.stringify({ p256dh: keys.p256dh, auth: keys.auth }), new Date().toISOString());
  return { guardada: true };
}

export function borrarSuscripcionPush(endpoint: string): number {
  return Number(getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint).changes);
}

export function clavePublicaVapid(): string | null {
  return entornoActual.VAPID_PUBLIC_KEY?.trim() || null;
}
