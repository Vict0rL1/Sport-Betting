// Notificaciones (Fase 3.6): qué eventos salen, por qué canales, y un registro de cada intento.
//
// La app ya tenía alertas internas (alerts/) y un canal en vivo para la pantalla (latency/
// alert.ts). Esto es lo que llega CUANDO NO ESTÁS MIRANDO: el teléfono, Telegram, el correo,
// Discord. Cada canal se configura con variables de entorno; sin ninguna, todo queda en «no
// configurado» y la app no se queja. Nunca lanza: una notificación que no sale no puede
// tumbar el ciclo que la provocó.

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
         ON CONFLICT (clave) DO UPDATE SET body = excluded.body, deliver_after = excluded.deliver_after, expires_at = excluded.expires_at, created_at = excluded.created_at`,
      )
      .run(clave, ahora.toISOString(), evento, m.titulo, m.cuerpo, m.url ?? null, fin.toISOString(), new Date(ahora.getTime() + s.caducaHoras * 3_600_000).toISOString());
    return 'aplazada';
  } catch {
    // Sin la tabla (una base sin migrar): el aviso sigue en la bandeja, y se anota que no se aplazó.
    return 'error';
  }
}

/**
 * Envía lo aplazado cuya ventana ya acabó (y que no ha caducado), una vez, y anota y quita lo
 * caducado. Lo llama el programador cada pocos minutos.
 */
export async function enviarAplazadas(ahora = new Date()): Promise<{ enviadas: number; caducadas: number }> {
  let filas: { clave: string; event_type: TipoEvento; title: string; body: string; url: string | null; deliver_after: string; expires_at: string }[];
  try {
    filas = getDb().prepare('SELECT clave, event_type, title, body, url, deliver_after, expires_at FROM notification_pending ORDER BY created_at').all() as typeof filas;
  } catch {
    return { enviadas: 0, caducadas: 0 };
  }
  let enviadas = 0;
  let caducadas = 0;
  for (const f of filas) {
    const caduca = Date.parse(f.expires_at) <= ahora.getTime();
    if (caduca) {
      getDb().prepare('DELETE FROM notification_pending WHERE clave = ?').run(f.clave);
      caducadas++;
      anotar('silencio', f.event_type, f.title, { ok: false, error: 'caducada: no se envió tras las horas de silencio' }, 0);
      continue;
    }
    if (Date.parse(f.deliver_after) > ahora.getTime() || enSilencio(ahora, leerAjustes().silencio)) continue;
    // Con los canales apagados se quedan en la cola (caducarán con su anotación), no se borran sin
    // rastro (revisión data-guardian de G3).
    if (!featureEncendida('notificaciones.canales')) continue;
    // Se envía y después se quita: si el proceso cae entre medias, como mucho se repite un aviso,
    // nunca se pierde en silencio.
    await enviarPorCanales(f.event_type, { titulo: f.title, cuerpo: f.body, url: f.url ?? undefined });
    getDb().prepare('DELETE FROM notification_pending WHERE clave = ?').run(f.clave);
    enviadas++;
  }
  return { enviadas, caducadas };
}

async function enviarPorCanales(evento: TipoEvento, m: Mensaje): Promise<{ canal: string; ok: boolean; error: string | null }[]> {
  const out: { canal: string; ok: boolean; error: string | null }[] = [];
  for (const c of CANALES) {
    if (c.falta(entornoActual).length) continue;
    const t0 = Date.now();
    const r = await c.enviar(m, entornoActual, fetchActual).catch((e) => ({ ok: false, error: (e as Error).message }) as ResultadoEnvio);
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
  const r = await c.enviar({ titulo: 'Sports Predictor: prueba', cuerpo: `Si lees esto, el canal «${nombre}» funciona.`, url: '/' }, entornoActual, fetchActual).catch((e) => ({ ok: false, error: (e as Error).message }) as ResultadoEnvio);
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
