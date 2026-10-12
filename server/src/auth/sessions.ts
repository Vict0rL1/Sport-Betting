// Las sesiones de la pantalla: una cookie, una fila.
//
// El token que viaja en la cookie son 32 bytes aleatorios; en la base solo se guarda su
// SHA-256. Quien lea la base (una copia de seguridad, un volcado) no obtiene nada con lo
// que entrar. Caducan a los 30 días sin uso y se pueden revocar una a una desde la propia
// pantalla, que es lo que hace falta si se deja una sesión abierta en un ordenador ajeno.
//
// Y valen solo para la entrada con la que se abrieron (lote H, H2): cada sesión guarda una huella
// del usuario, la contraseña y el secreto TOTP (si está activo), atada a su propio token. Cambiar
// la contraseña porque se filtró, o activar el segundo factor, deja fuera a quien ya estaba dentro.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from '../db.ts';
import { ledgerize } from '../db/ledgerize.ts';
import { LEDGER_SCHEMA } from '../db/layout.ts';

export const SESION_DIAS = 30;

export const SESSIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash    TEXT NOT NULL UNIQUE,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    revoked_at    TEXT,
    user_agent    TEXT,
    ip            TEXT,
    huella        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions (token_hash);
`;

/** La crea la migración 5; esto solo garantiza que está si se llama antes (y en el fichero correcto). */
export function ensureSessionsSchema(): void {
  getDb().exec(ledgerize(SESSIONS_SCHEMA, LEDGER_SCHEMA));
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Lo que, si cambia, deja sin valor las sesiones abiertas: usuario, contraseña y el TOTP si está activo. */
export function materialDeEntrada(c: { usuario: string; password: string; totpSecret: string }, totpActivo: boolean): string {
  return JSON.stringify(['entrada-v1', c.usuario, c.password, totpActivo ? c.totpSecret : '']);
}

/**
 * La huella de la entrada de una sesión: HMAC-SHA256 con el token de la cookie como clave. La base
 * solo guarda el SHA-256 del token, así que con la base sola (una copia, S3) la huella no sirve para
 * comprobar una contraseña: hace falta la cookie. Revisión de `security-reviewer`: la primera
 * versión guardaba un scrypt de la contraseña por sesión, y con una copia se podía adivinar sin
 * límite de intentos.
 */
export function huellaDeEntrada(token: string, material: string): string {
  return `v1$${createHmac('sha256', token).update(material).digest('base64url')}`;
}

/** ¿Se abrió la sesión de este token con esta entrada? Una sesión sin huella (anterior a H2) no. */
export function huellaCasa(huella: string | null | undefined, token: string, material: string): boolean {
  if (!huella) return false;
  const esperada = Buffer.from(huellaDeEntrada(token, material));
  const dada = Buffer.from(huella);
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}

export interface Sesion {
  id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  ip: string | null;
}

/** Abre una sesión para la entrada de ahora (`materialDeEntrada`). */
export function crearSesion(meta: { userAgent?: string | null; ip?: string | null }, entrada: string, ahora = new Date()): { token: string; id: number } {
  ensureSessionsSchema();
  const token = randomBytes(32).toString('base64url');
  const expira = new Date(ahora.getTime() + SESION_DIAS * 86_400_000).toISOString();
  const r = getDb()
    .prepare('INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at, user_agent, ip, huella) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(hash(token), ahora.toISOString(), ahora.toISOString(), expira, meta.userAgent?.slice(0, 200) ?? null, meta.ip?.slice(0, 64) ?? null, huellaDeEntrada(token, entrada));
  return { token, id: Number(r.lastInsertRowid) };
}

/**
 * La sesión del token si existe, no está revocada ni caducada y se abrió con esta entrada. Renueva
 * `last_seen_at` y la caducidad. Una que no casa con la entrada se revoca: si no, volvería a entrar
 * al deshacer el cambio (quitar el TOTP tras perder el móvil), y la lista no la enseñaría para
 * cerrarla a mano. Arrancar con un `.env` equivocado cuesta, como mucho, volver a entrar.
 */
export function sesionDe(token: string | null | undefined, entrada: string, ahora = new Date()): Sesion | null {
  if (!token || token.length < 20 || token.length > 128) return null;
  ensureSessionsSchema();
  const db = getDb();
  const s = db.prepare('SELECT id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip, huella FROM sessions WHERE token_hash = ?').get(hash(token)) as
    | (Sesion & { huella: string | null })
    | undefined;
  if (!s || s.revoked_at || s.expires_at <= ahora.toISOString()) return null;
  if (!huellaCasa(s.huella, token, entrada)) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(ahora.toISOString(), s.id);
    return null;
  }
  // Deslizante: cada uso la prolonga. Se escribe como mucho una vez por minuto para no
  // convertir cada petición en una escritura.
  if (Date.parse(s.last_seen_at) < ahora.getTime() - 60_000) {
    const expira = new Date(ahora.getTime() + SESION_DIAS * 86_400_000).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(ahora.toISOString(), expira, s.id);
  }
  const { huella: _huella, ...sesion } = s;
  return sesion;
}

export function revocarSesion(id: number, ahora = new Date()): boolean {
  ensureSessionsSchema();
  return getDb().prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(ahora.toISOString(), id).changes > 0;
}

export function revocarPorToken(token: string, ahora = new Date()): boolean {
  ensureSessionsSchema();
  return getDb().prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(ahora.toISOString(), hash(token)).changes > 0;
}

/**
 * Las sesiones vivas (ni revocadas ni caducadas), la más reciente primero. Sin el token no se sabe si
 * una vale para la entrada de ahora: se enseñan todas, para poder cerrarlas. Las que se presentan
 * con una entrada distinta ya quedaron revocadas (`sesionDe`).
 */
export function sesionesActivas(ahora = new Date()): Sesion[] {
  ensureSessionsSchema();
  return getDb()
    .prepare('SELECT id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip FROM sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC')
    .all(ahora.toISOString()) as unknown as Sesion[];
}
