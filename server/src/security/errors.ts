// Los errores no controlados, guardados con su id de petición.
//
// Un `500` que solo vive en el log de la terminal desaparece con la terminal. Aquí cada
// error no esperado deja una fila con el id de la petición —el mismo que recibe quien hizo
// la petición en la respuesta— para que «me salió un error» se pueda buscar. La pila se
// guarda recortada y NO se envía al cliente: una pila de servidor en una respuesta pública
// cuenta rutas de ficheros y versiones a quien no tiene por qué saberlas.
//
// Los errores esperados (400 de validación, 404, 401, 413) no se apuntan: no son fallos
// del servidor sino respuestas correctas a peticiones malas.

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getDb } from '../db.ts';

export function ensureErrorLogSchema(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS error_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT NOT NULL,
      request_id  TEXT,
      method      TEXT,
      url         TEXT,
      status      INTEGER NOT NULL,
      message     TEXT NOT NULL,
      stack       TEXT,
      user_agent  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log (created_at);
  `);
}

export interface ErrorRegistrado {
  id: number;
  created_at: string;
  request_id: string | null;
  method: string | null;
  url: string | null;
  status: number;
  message: string;
  stack: string | null;
}

export function registrarError(e: { requestId?: string | null; method?: string; url?: string; status: number; message: string; stack?: string | null; userAgent?: string | null }, ahora = new Date()): void {
  try {
    ensureErrorLogSchema();
    getDb()
      .prepare('INSERT INTO error_log (created_at, request_id, method, url, status, message, stack, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ahora.toISOString(), e.requestId ?? null, e.method ?? null, e.url?.slice(0, 500) ?? null, e.status, e.message.slice(0, 1000), e.stack?.slice(0, 4000) ?? null, e.userAgent?.slice(0, 200) ?? null);
  } catch {
    // Que falle el registro del error no puede tapar la respuesta del error.
  }
}

export function leerErrores(limite = 50, desde?: string): ErrorRegistrado[] {
  ensureErrorLogSchema();
  return getDb()
    .prepare('SELECT id, created_at, request_id, method, url, status, message, stack FROM error_log WHERE (? IS NULL OR created_at >= ?) ORDER BY id DESC LIMIT ?')
    .all(desde ?? null, desde ?? null, Math.min(500, Math.max(1, limite))) as unknown as ErrorRegistrado[];
}

export function contarErrores(desde: string): number {
  ensureErrorLogSchema();
  return (getDb().prepare('SELECT COUNT(*) AS n FROM error_log WHERE created_at >= ?').get(desde) as { n: number }).n;
}

export function registerErrorHandler(app: FastifyInstance, opts: { guardar: boolean }): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    const esperado = status < 500;
    if (!esperado) {
      req.log.error({ err, requestId: req.id }, 'error no controlado');
      if (opts.guardar) {
        registrarError({ requestId: String(req.id), method: req.method, url: req.url, status, message: err.message || 'error', stack: err.stack, userAgent: req.headers['user-agent'] ?? null });
      }
    }
    reply.code(status).send({
      error: esperado ? err.message : 'Error interno del servidor',
      requestId: String(req.id),
      ...(err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' ? { detalle: 'el cuerpo de la petición supera el límite' } : {}),
    });
  });
}
