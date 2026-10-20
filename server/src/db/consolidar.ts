// Una copia de carpeta (ledger.db y history.db con sus `-wal`) → copias autónomas comprobadas.
//
// Una carpeta copiada a mano con la app en marcha lleva cada base partida en dos: el fichero
// principal y su `-wal`, con los últimos commits que aún no se habían volcado. Quien restaure solo
// el principal pierde esas filas sin ningún error: la base abre, pasa `integrity_check` y está
// incompleta (en la copia del 12 de octubre, 133 filas del libro mayor). Aquí:
//
//   1. El original no se toca. Se calcula el SHA-256 de cada fichero antes y después, y se
//      trabaja sobre una copia en una carpeta de trabajo nueva.
//   2. Se cuenta cada tabla dos veces: abriendo solo el principal (lo que vería una restauración
//      ingenua) y con su `-wal` (lo que de verdad había). La diferencia es lo que se perdería.
//   3. Se escribe una copia autónoma con `VACUUM INTO` desde la vista con WAL: un solo fichero,
//      consistente, sin laterales. Se comprueba con `integrity_check` y con su manifiesto: el de
//      la copia escrita tiene que ser idéntico al de la vista con WAL de la que sale.
//
// El `-shm` no se copia: es un índice del `-wal` que SQLite reconstruye al abrir, y uno ajeno o
// viejo no aporta nada que el `-wal` no tenga.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { compararManifiestos, manifiestoDe, manifiestoDeFichero, tablasDe, type DiferenciaTabla, type Manifiesto } from './manifiesto.ts';
import { integridadDe } from './sqliteSeguro.ts';

export const BASES_DE_UNA_COPIA = ['ledger.db', 'history.db'] as const;

/** La raíz del repositorio (este fichero está en server/src/db). */
const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** La ruta real (enlaces resueltos) de `p`, o de su antecesor más cercano que exista, con el resto detrás. */
function rutaReal(p: string): string {
  let abs = path.resolve(p);
  const resto: string[] = [];
  while (!fs.existsSync(abs)) {
    resto.unshift(path.basename(abs));
    const padre = path.dirname(abs);
    if (padre === abs) break;
    abs = padre;
  }
  return path.join(fs.realpathSync(abs), ...resto);
}

/** ¿`hijo` está dentro de `padre` (o es él)? Con enlaces resueltos y, en macOS y Windows, sin distinguir mayúsculas. */
export function dentroDe(hijo: string, padre: string): boolean {
  const norm = (x: string) => (process.platform === 'darwin' || process.platform === 'win32' ? x.toLowerCase() : x);
  const h = norm(rutaReal(hijo));
  const pa = norm(rutaReal(padre));
  return h === pa || h.startsWith(pa + path.sep);
}

/**
 * Las salidas llevan libros mayores enteros: fuera del repositorio, para que un `git add -A` no los
 * suba (revisión data-guardian del 20 de octubre, hallazgo 2). Dentro solo vale data/, que git no
 * versiona.
 */
export function comprobarSalidaFueraDelRepo(salida: string): void {
  if (dentroDe(salida, RAIZ_REPO) && !dentroDe(salida, path.join(RAIZ_REPO, 'data'))) {
    throw new Error(`${salida} está dentro del repositorio y llevaría libros mayores enteros a un posible commit: usa una --salida fuera (por defecto, en tu carpeta personal) o dentro de data/`);
  }
}

export function sha256DeFichero(fichero: string): string {
  return createHash('sha256').update(fs.readFileSync(fichero)).digest('hex');
}

/** Los ficheros de una base que hay en la carpeta: el principal y sus laterales. */
function ficherosDeBase(dir: string, base: string): string[] {
  return ['', '-wal', '-shm', '-journal'].map((s) => path.join(dir, base + s)).filter((f) => fs.existsSync(f));
}

function contar(db: DatabaseSync): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tablasDe(db)) out[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`).get() as { n: number }).n);
  return out;
}

export interface DiferenciaConteo {
  tabla: string;
  soloBase: number | null;
  conWal: number | null;
}

export interface BaseConsolidada {
  base: string;
  /** El `-wal` de la copia: bytes y marcos (páginas) que lleva, o null si no había. */
  wal: { bytes: number; marcos: number } | null;
  /** Lo que da el fichero principal solo; null si no se deja leer sin su -wal (DESCONOCIDO, ver soloBaseError). */
  soloBase: Record<string, number> | null;
  soloBaseError: string | null;
  conWal: Record<string, number>;
  /** Tablas en que abrir solo el principal da otro número de filas. */
  diferencias: DiferenciaConteo[];
  salida: string;
  integridad: string;
  manifiesto: Manifiesto;
  /** Manifiesto de la copia escrita frente al de la vista con WAL: vacío = idénticos. */
  verificacion: DiferenciaTabla[];
}

export interface ResultadoConsolidar {
  origen: string;
  trabajo: string;
  huellasAntes: Record<string, string>;
  huellasDespues: Record<string, string>;
  /** El original quedó exactamente igual (mismos ficheros, mismos SHA-256). */
  origenIntacto: boolean;
  bases: BaseConsolidada[];
}

/**
 * Consolida las bases de `origen` (una carpeta) en `salida`. `trabajo` es una carpeta vacía para
 * las copias de trabajo (se deja: es la prueba de lo que se contó).
 */
export function consolidarCopia(origen: string, salida: string, trabajo: string): ResultadoConsolidar {
  if (!fs.statSync(origen).isDirectory()) throw new Error(`${origen} no es una carpeta`);
  for (const d of [salida, trabajo]) {
    if (dentroDe(d, origen)) throw new Error(`${d} está dentro de la copia original: se escribe fuera, para no tocarla`);
  }
  const presentes = BASES_DE_UNA_COPIA.filter((b) => fs.existsSync(path.join(origen, b)));
  if (presentes.length === 0) throw new Error(`En ${origen} no hay ${BASES_DE_UNA_COPIA.join(' ni ')}`);
  const huellas = () =>
    Object.fromEntries(presentes.flatMap((b) => ficherosDeBase(origen, b)).map((f) => [path.basename(f), sha256DeFichero(f)]));
  const huellasAntes = huellas();
  fs.mkdirSync(salida, { recursive: true });
  const bases: BaseConsolidada[] = [];
  for (const base of presentes) {
    const principal = path.join(origen, base);
    const wal = fs.existsSync(principal + '-wal') ? principal + '-wal' : null;

    // Solo el principal, como lo vería quien copiara un único fichero.
    const dirSolo = path.join(trabajo, 'solo-base');
    fs.mkdirSync(dirSolo, { recursive: true });
    fs.copyFileSync(principal, path.join(dirSolo, base));
    // Un principal a medio volcar puede no dejarse leer sin su -wal: eso es lo que vería quien lo
    // restaurara solo, y se apunta como DESCONOCIDO en vez de parar la consolidación.
    let soloBase: Record<string, number> | null = null;
    let soloBaseError: string | null = null;
    try {
      const solo = new DatabaseSync(path.join(dirSolo, base), { readOnly: true });
      try {
        soloBase = contar(solo);
      } finally {
        solo.close();
      }
    } catch (e) {
      soloBaseError = (e as Error).message;
    }

    // El principal con su -wal: lo que de verdad había.
    const dirWal = path.join(trabajo, 'con-wal');
    fs.mkdirSync(dirWal, { recursive: true });
    fs.copyFileSync(principal, path.join(dirWal, base));
    if (wal) fs.copyFileSync(wal, path.join(dirWal, base + '-wal'));
    const conWalDb = new DatabaseSync(path.join(dirWal, base));
    let conWal: Record<string, number>;
    let manifiestoWal: Manifiesto;
    let tamPagina = 4096;
    const destino = path.join(salida, base.replace(/\.db$/, '.consolidada.db'));
    // Se escribe a un temporal y se renombra al final: a medias no queda nada con el nombre bueno.
    const temporal = destino + '.escribiendo';
    try {
      tamPagina = Number((conWalDb.prepare('PRAGMA page_size').get() as { page_size: number }).page_size);
      conWal = contar(conWalDb);
      manifiestoWal = manifiestoDe(conWalDb);
      fs.rmSync(temporal, { force: true });
      conWalDb.exec(`VACUUM INTO '${temporal.replace(/'/g, "''")}'`);
    } finally {
      conWalDb.close();
    }
    const integridad = integridadDe(temporal);
    const manifiesto = manifiestoDeFichero(temporal);
    const verificacion = compararManifiestos(manifiestoWal, manifiesto);
    // Solo lleva el nombre bueno si pasa las dos comprobaciones; si no, queda como «.no-verificada»
    // para mirarla, y nadie la confunde con una copia lista (revisión data-guardian).
    const salidaFinal = integridad === 'ok' && verificacion.length === 0 ? destino : destino + '.no-verificada';
    fs.writeFileSync(salidaFinal + '.manifiesto.json', JSON.stringify(manifiesto, null, 1));
    fs.renameSync(temporal, salidaFinal);
    const nombres = [...new Set([...Object.keys(soloBase ?? {}), ...Object.keys(conWal)])].sort();
    const sb = soloBase as Record<string, number> | null;
    const walBytes = wal ? fs.statSync(wal).size : 0;
    bases.push({
      base,
      wal: wal ? { bytes: walBytes, marcos: walBytes > 32 ? Math.floor((walBytes - 32) / (tamPagina + 24)) : 0 } : null,
      soloBase,
      soloBaseError,
      conWal,
      diferencias: sb ? nombres.filter((t) => sb[t] !== conWal[t]).map((t) => ({ tabla: t, soloBase: sb[t] ?? null, conWal: conWal[t] ?? null })) : [],
      salida: salidaFinal,
      integridad,
      manifiesto,
      verificacion,
    });
  }
  const huellasDespues = huellas();
  const origenIntacto = JSON.stringify(huellasAntes) === JSON.stringify(huellasDespues);
  return { origen, trabajo, huellasAntes, huellasDespues, origenIntacto, bases };
}
