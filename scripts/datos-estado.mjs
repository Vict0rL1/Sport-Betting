// ¿Hay historia en una base? Por FILAS, no por tamaño ni por si el fichero existe.
//
// `npm run setup` corre db:migrate antes de bajar los datos, y eso deja un history.db solo
// con esquema. Antes fetch-data veía que el fichero existía y no descargaba, y setup decía
// «Listo» con la base vacía (lote A, A7). Esto lo usan los dos.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** Las tablas que dicen si hay historia; basta con que una tenga filas. */
export const TABLAS_PRINCIPALES = ['matches', 'fb_matches', 'naf_games', 'player_ratings', 'bb_games', 'bsb_games', 'nhl_games', 'ufc_fights'];

/** Filas por tabla principal, o null si el fichero no existe o no es una base que abra. */
export function filasDeHistoria(fichero) {
  if (!fs.existsSync(fichero)) return null;
  let db = null;
  try {
    db = new DatabaseSync(fichero);
    const tablas = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const out = {};
    for (const t of TABLAS_PRINCIPALES) out[t] = tablas.has(t) ? db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n : 0;
    return out;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Ya cerrada o nunca abierta.
    }
  }
}

export function hayHistoria(fichero) {
  const filas = filasDeHistoria(fichero);
  return !!filas && Object.values(filas).some((n) => n > 0);
}
