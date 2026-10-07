// Cada trabajo de datos deja constancia: qué fuente, cuándo empezó y acabó, cuántas filas y
// si falló con qué error. Es lo que contesta «¿cuándo fue la última vez que se bajaron
// resultados de la NBA y qué pasó?» sin buscar en logs.

import { getDb } from '../db.ts';
import { notificar } from '../notifications/index.ts';

export interface Ejecucion {
  id: number;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'error';
  rows_added: number | null;
  rows_updated: number | null;
  error: string | null;
  detail: string | null;
}

export interface ResultadoIngesta {
  rowsAdded?: number;
  rowsUpdated?: number;
  detail?: string;
}

export function empezarEjecucion(source: string, ahora = new Date()): number {
  const r = getDb().prepare("INSERT INTO ingestion_runs (source, started_at, status) VALUES (?, ?, 'running')").run(source, ahora.toISOString());
  return Number(r.lastInsertRowid);
}

export function terminarEjecucion(id: number, resultado: ResultadoIngesta | { error: string }, ahora = new Date()): void {
  if ('error' in resultado) {
    getDb().prepare("UPDATE ingestion_runs SET finished_at = ?, status = 'error', error = ? WHERE id = ?").run(ahora.toISOString(), resultado.error.slice(0, 1000), id);
    return;
  }
  getDb()
    .prepare("UPDATE ingestion_runs SET finished_at = ?, status = 'ok', rows_added = ?, rows_updated = ?, detail = ? WHERE id = ?")
    .run(ahora.toISOString(), resultado.rowsAdded ?? null, resultado.rowsUpdated ?? null, resultado.detail?.slice(0, 1000) ?? null, id);
}

/** Envuelve un trabajo: fila `running` al empezar, `ok` o `error` al acabar. Relanza el error. */
export async function conRegistro<T extends ResultadoIngesta | void>(source: string, fn: () => Promise<T> | T): Promise<T> {
  const id = empezarEjecucion(source);
  try {
    const r = await fn();
    terminarEjecucion(id, (r ?? {}) as ResultadoIngesta);
    return r;
  } catch (e) {
    terminarEjecucion(id, { error: (e as Error).message });
    void notificar('trabajo_fallido', { titulo: `Trabajo de datos fallido: ${source}`, cuerpo: (e as Error).message.slice(0, 500) });
    throw e;
  }
}

/** La última ejecución de cada fuente. */
export function ultimasEjecuciones(): Ejecucion[] {
  return getDb()
    .prepare(
      `SELECT r.* FROM ingestion_runs r
        WHERE r.id = (SELECT MAX(x.id) FROM ingestion_runs x WHERE x.source = r.source)
        ORDER BY r.source`,
    )
    .all() as unknown as Ejecucion[];
}

export function ejecuciones(opts: { source?: string; limite?: number } = {}): Ejecucion[] {
  return getDb()
    .prepare('SELECT * FROM ingestion_runs WHERE (? IS NULL OR source = ?) ORDER BY id DESC LIMIT ?')
    .all(opts.source ?? null, opts.source ?? null, Math.min(500, opts.limite ?? 100)) as unknown as Ejecucion[];
}

/** Una ejecución que lleva `running` más de este tiempo se considera muerta (proceso caído). */
export const MUERTA_TRAS_MIN = 180;

export function marcarMuertas(ahora = new Date()): number {
  const limite = new Date(ahora.getTime() - MUERTA_TRAS_MIN * 60_000).toISOString();
  return Number(getDb().prepare("UPDATE ingestion_runs SET status = 'error', finished_at = ?, error = 'el proceso no terminó (marcada al arrancar)' WHERE status = 'running' AND started_at < ?").run(ahora.toISOString(), limite).changes);
}
