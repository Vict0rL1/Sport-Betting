// Copias de seguridad del libro mayor.
//
// Solo del libro mayor: la historia se vuelve a bajar o a reconstruir; las apuestas, las
// predicciones registradas y los precios observados, no. La copia es un `VACUUM INTO` del
// esquema `ledger` —un fichero nuevo, consistente aunque haya WAL— que se comprueba con
// `integrity_check` antes de darla por buena. Se guardan las últimas N en local y, si hay
// credenciales, cada una se sube también a un almacén S3 compatible (db/s3.ts).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../config.ts';
import { getDb, getMeta, setMeta } from '../db.ts';
import { LEDGER_SCHEMA, LAYOUT, ficherosDe } from './layout.ts';
import { subirS3, configS3 } from './s3.ts';

export const CLAVE_ULTIMA = 'backup:last_at';
export const CLAVE_ULTIMO_FICHERO = 'backup:last_file';
export const COPIAS_LOCALES = 14;

export function directorioCopias(entorno: NodeJS.ProcessEnv = process.env): string {
  return entorno.BACKUP_DIR?.trim() || path.join(DATA_DIR, 'backups');
}

export interface Copia {
  fichero: string;
  bytes: number;
  integridad: string;
  s3?: { subido: boolean; destino?: string; error?: string };
  borradas: string[];
}

function sello(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Lo que hay en el directorio, lo más nuevo primero. */
export function copiasLocales(dir = directorioCopias()): { fichero: string; bytes: number; mtime: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^ledger-.*\.db$/.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { fichero: path.join(dir, f), bytes: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export async function hacerCopia(opts: { dir?: string; ahora?: Date; entorno?: NodeJS.ProcessEnv; subir?: boolean } = {}): Promise<Copia> {
  const dir = opts.dir ?? directorioCopias(opts.entorno);
  const ahora = opts.ahora ?? new Date();
  fs.mkdirSync(dir, { recursive: true });
  const fichero = path.join(dir, `ledger-${sello(ahora)}.db`);
  const db = getDb();
  fs.rmSync(fichero, { force: true });
  db.exec(`VACUUM ${LEDGER_SCHEMA} INTO '${fichero.replace(/'/g, "''")}'`);
  const copia = new DatabaseSync(fichero);
  const integridad = (copia.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  copia.close();
  if (integridad !== 'ok') {
    fs.rmSync(fichero, { force: true });
    throw new Error(`La copia no pasa integrity_check (${integridad}); descartada.`);
  }
  const bytes = fs.statSync(fichero).size;
  // Rotación: las últimas N.
  const borradas: string[] = [];
  for (const c of copiasLocales(dir).slice(COPIAS_LOCALES)) {
    fs.rmSync(c.fichero, { force: true });
    borradas.push(c.fichero);
  }
  const out: Copia = { fichero, bytes, integridad, borradas };
  const s3 = configS3(opts.entorno);
  if (s3 && opts.subir !== false) {
    try {
      const destino = await subirS3(s3, fichero, `ledger/${path.basename(fichero)}`);
      out.s3 = { subido: true, destino };
    } catch (e) {
      out.s3 = { subido: false, error: (e as Error).message };
    }
  }
  setMeta(CLAVE_ULTIMA, ahora.toISOString());
  setMeta(CLAVE_ULTIMO_FICHERO, fichero);
  return out;
}

/** Cuándo fue la última copia (null si nunca). */
export function ultimaCopia(): { cuando: string; fichero: string | null } | null {
  const cuando = getMeta(CLAVE_ULTIMA);
  return cuando ? { cuando, fichero: getMeta(CLAVE_ULTIMO_FICHERO) } : null;
}

/**
 * Restaura una copia como libro mayor. Comprueba la integridad de la copia, aparta el actual
 * como `ledger.db.antes-de-restaurar-<fecha>` y copia. El servidor tiene que estar parado:
 * una conexión abierta seguiría escribiendo en el fichero viejo.
 */
export function restaurarCopia(origen: string, opts: { ahora?: Date; destino?: string } = {}): { destino: string; apartado: string | null } {
  if (!fs.existsSync(origen)) throw new Error(`No existe ${origen}`);
  const prueba = new DatabaseSync(origen, { readOnly: true });
  const integridad = (prueba.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const tablas = (prueba.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  prueba.close();
  if (integridad !== 'ok') throw new Error(`La copia no pasa integrity_check (${integridad}).`);
  if (!tablas.includes('paper_bets') || !tablas.includes('prediction_log')) throw new Error('Ese fichero no parece un libro mayor (faltan paper_bets o prediction_log).');
  const destino = opts.destino ?? ficherosDe().ledger;
  if (!destino) throw new Error(`En disposición ${LAYOUT} no hay ledger.db que restaurar.`);
  let apartado: string | null = null;
  if (fs.existsSync(destino)) {
    apartado = `${destino}.antes-de-restaurar-${sello(opts.ahora ?? new Date())}`;
    fs.copyFileSync(destino, apartado);
  }
  fs.copyFileSync(origen, destino);
  for (const suf of ['-wal', '-shm']) fs.rmSync(destino + suf, { force: true });
  return { destino, apartado };
}
