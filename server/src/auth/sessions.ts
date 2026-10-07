// Las sesiones de la pantalla: una cookie, una fila.
//
// El token que viaja en la cookie son 32 bytes aleatorios; en la base solo se guarda su
// SHA-256. Quien lea la base (una copia de seguridad, un volcado) no obtiene nada con lo
// que entrar. Caducan a los 30 días sin uso y se pueden revocar una a una desde la propia
// pantalla, que es lo que hace falta si se deja una sesión abierta en un ordenador ajeno.

import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db.ts';

export const SESION_DIAS = 30;

export function ensureSessionsSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash    TEXT NOT NULL UNIQUE,
      created_at    TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      revoked_at    TEXT,
      user_agent    TEXT,
      ip            TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions (token_hash);
  `);
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface Sesion {
  id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  ip: string | null;
}

export function crearSesion(meta: { userAgent?: string | null; ip?: string | null }, ahora = new Date()): { token: string; id: number } {
  ensureSessionsSchema();
  const token = randomBytes(32).toString('base64url');
  const expira = new Date(ahora.getTime() + SESION_DIAS * 86_400_000).toISOString();
  const r = getDb()
    .prepare('INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(hash(token), ahora.toISOString(), ahora.toISOString(), expira, meta.userAgent?.slice(0, 200) ?? null, meta.ip?.slice(0, 64) ?? null);
  return { token, id: Number(r.lastInsertRowid) };
}

/** La sesión del token si existe, no está revocada ni caducada. Renueva `last_seen_at` y la caducidad. */
export function sesionDe(token: string | null | undefined, ahora = new Date()): Sesion | null {
  if (!token || token.length < 20 || token.length > 128) return null;
  ensureSessionsSchema();
  const db = getDb();
  const s = db.prepare('SELECT id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip FROM sessions WHERE token_hash = ?').get(hash(token)) as Sesion | undefined;
  if (!s || s.revoked_at || s.expires_at <= ahora.toISOString()) return null;
  // Deslizante: cada uso la prolonga. Se escribe como mucho una vez por minuto para no
  // convertir cada petición en una escritura.
  if (Date.parse(s.last_seen_at) < ahora.getTime() - 60_000) {
    const expira = new Date(ahora.getTime() + SESION_DIAS * 86_400_000).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(ahora.toISOString(), expira, s.id);
  }
  return s;
}

export function revocarSesion(id: number, ahora = new Date()): boolean {
  ensureSessionsSchema();
  return getDb().prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(ahora.toISOString(), id).changes > 0;
}

export function revocarPorToken(token: string, ahora = new Date()): boolean {
  ensureSessionsSchema();
  return getDb().prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(ahora.toISOString(), hash(token)).changes > 0;
}

/** Las sesiones vivas (ni revocadas ni caducadas), la más reciente primero. */
export function sesionesActivas(ahora = new Date()): Sesion[] {
  ensureSessionsSchema();
  return getDb()
    .prepare('SELECT id, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip FROM sessions WHERE revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC')
    .all(ahora.toISOString()) as unknown as Sesion[];
}
