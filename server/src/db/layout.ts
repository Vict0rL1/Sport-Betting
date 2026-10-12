// Dónde está cada fichero de la base, y en qué disposición.
//
//   DB_LAYOUT=split  (por defecto)  history.db (principal) + ledger.db (adjunta como `ledger`)
//   DB_LAYOUT=single               todo en tennis.db, como hasta la Fase 2 (compatibilidad)
//
// La principal es la de HISTORIA a propósito: las decenas de `CREATE TABLE` sin prefijo del
// esquema caen en ella, y solo las tablas del libro mayor (pocas, listadas en tables.ts)
// llevan el prefijo, que pone `ledgerize.ts` sin tocar los esquemas.

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_PATH } from '../config.ts';

export type Layout = 'split' | 'single';

export function layoutDesdeEntorno(entorno: NodeJS.ProcessEnv = process.env): Layout {
  return entorno.DB_LAYOUT?.trim().toLowerCase() === 'single' ? 'single' : 'split';
}

export const LAYOUT: Layout = layoutDesdeEntorno();

/** El fichero antiguo, con todo dentro. */
export const LEGACY_DB_PATH = DB_PATH;
export const HISTORY_DB_PATH = path.join(DATA_DIR, 'history.db');
export const LEDGER_DB_PATH = path.join(DATA_DIR, 'ledger.db');
/**
 * La marca de que aquí HUBO un libro mayor (lote B, B4). La escribe la app al crearlo y la
 * partición al partir. Si está y `ledger.db` no, el servidor no arranca con uno vacío: alguien
 * perdió o movió las apuestas y el registro, y eso se dice en vez de taparlo.
 */
export const LEDGER_MARCA_PATH = `${LEDGER_DB_PATH}.existe`;

/** Nombre del esquema SQLite del libro mayor: `ledger` en split, `main` en single. */
export const LEDGER_SCHEMA = LAYOUT === 'split' ? 'ledger' : 'main';

/** El fichero que abre la conexión principal según la disposición. */
export function rutaPrincipal(layout: Layout = LAYOUT): string {
  return layout === 'split' ? HISTORY_DB_PATH : LEGACY_DB_PATH;
}

/** Los ficheros que componen la base en una disposición (para el doctor y los backups). */
export function ficherosDe(layout: Layout = LAYOUT): { history: string; ledger: string | null } {
  return layout === 'split' ? { history: HISTORY_DB_PATH, ledger: LEDGER_DB_PATH } : { history: LEGACY_DB_PATH, ledger: null };
}

/**
 * La carpeta de las copias del libro mayor: BACKUP_DIR o data/backups. Aquí y no en backup.ts
 * para que db.ts (que backup.ts importa) la use sin un ciclo: una sola definición, la de las copias
 * y la de las huellas de un libro mayor perdido.
 */
export function directorioCopias(entorno: NodeJS.ProcessEnv = process.env): string {
  return entorno.BACKUP_DIR?.trim() || path.join(DATA_DIR, 'backups');
}

/** El nombre de una copia del libro mayor en esa carpeta. */
export const PATRON_COPIA = /^ledger-.*\.db$/;

/**
 * Aparta los `-wal`/`-shm` de un fichero que ya no está, en vez de borrarlos: un WAL huérfano
 * puede llevar los últimos commits del libro mayor. Quedan como `<fichero>-wal.huerfano-<fecha>`.
 */
export function apartarLateralesHuerfanos(fichero: string, ahora: Date = new Date(), apartados: string[] = []): string[] {
  for (const suf of ['-wal', '-shm']) {
    if (fs.existsSync(fichero + suf)) apartados.push(apartar(fichero + suf, 'huerfano', ahora));
  }
  return apartados;
}

/** `base`, o `base-2`, `base-3`… si ya existe: un apartado nunca pisa a otro (dos en el mismo segundo). */
export function nombreLibre(base: string): string {
  let destino = base;
  for (let n = 2; fs.existsSync(destino); n++) destino = `${base}-${n}`;
  return destino;
}

const selloDe = (ahora: Date) => ahora.toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Renombra `fichero` a `<fichero>.<motivo>-<fecha>` (con `nombreLibre`) y devuelve el nombre nuevo. */
export function apartar(fichero: string, motivo: string, ahora: Date = new Date()): string {
  const destino = nombreLibre(`${fichero}.${motivo}-${selloDe(ahora)}`);
  fs.renameSync(fichero, destino);
  return destino;
}

/**
 * Aparta una base CON sus `-wal`/`-shm`, emparejados con el nombre nuevo: el WAL se aplica a la
 * base con la que se abra, sin mirar de cuál salió, así que nunca puede quedarse junto a otra.
 */
export function apartarConLaterales(fichero: string, motivo: string, ahora: Date = new Date()): string[] {
  const destino = apartar(fichero, motivo, ahora);
  const apartados = [destino];
  for (const suf of ['-wal', '-shm']) {
    if (!fs.existsSync(fichero + suf)) continue;
    fs.renameSync(fichero + suf, destino + suf);
    apartados.push(destino + suf);
  }
  return apartados;
}

/**
 * Aparta un `ledger.db` que no es un libro mayor (0 bytes) y su WAL, sin abrir nada: SQLite borra
 * el WAL de una base de 0 bytes al abrirla, y ese WAL puede llevar los últimos commits. Va
 * anotando en `apartados` a medida que mueve, para que un fallo a mitad diga lo que ya movió.
 */
export function apartarLibroVacio(fichero: string, ahora: Date = new Date(), apartados: string[] = []): string[] {
  if (fs.existsSync(fichero) && fs.statSync(fichero).size > 0) throw new Error(`${fichero} no está vacío: no se aparta como vacío.`);
  apartarLateralesHuerfanos(fichero, ahora, apartados);
  if (fs.existsSync(fichero)) apartados.push(apartar(fichero, 'vacio', ahora));
  return apartados;
}
