// Copias de seguridad del libro mayor.
//
// Solo del libro mayor: la historia se vuelve a bajar o a reconstruir; las apuestas, las
// predicciones registradas y los precios observados, no. La copia es un `VACUUM INTO` del
// esquema `ledger` —un fichero nuevo, consistente aunque haya WAL— que se comprueba con
// `integrity_check` antes de darla por buena. Se guardan las últimas N en local y, si hay
// credenciales, cada una se sube también a un almacén S3 compatible (db/s3.ts).

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb, getMeta, setMeta } from '../db.ts';
import { LEDGER_SCHEMA, LAYOUT, ficherosDe, directorioCopias, PATRON_COPIA, apartarLateralesHuerfanos, apartarLibroVacio, nombreLibre } from './layout.ts';
import { subirS3, configS3 } from './s3.ts';
import { copiaConsistente, integridadDe, otraConexionAbierta, quitarLaterales } from './sqliteSeguro.ts';

export const CLAVE_ULTIMA = 'backup:last_at';
export const CLAVE_ULTIMO_FICHERO = 'backup:last_file';
export const COPIAS_LOCALES = 14;

export { directorioCopias };

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
    .filter((f) => PATRON_COPIA.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { fichero: path.join(dir, f), bytes: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** Por qué una copia recién escrita no sirve, o 'ok': con algo dentro, íntegra y con pinta de libro mayor. */
function validarCopia(fichero: string): string {
  if (fs.statSync(fichero).size === 0) return 'vacía';
  try {
    const integridad = integridadDe(fichero);
    if (integridad !== 'ok') return integridad;
    const d = new DatabaseSync(fichero, { readOnly: true });
    try {
      const tablas = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
      // La misma regla que restaurarCopia: una copia que restore rechazaría no ocupa sitio en la rotación.
      if (!tablas.includes('paper_bets') || !tablas.includes('prediction_log')) return 'sin paper_bets o prediction_log';
    } finally {
      d.close();
    }
    return 'ok';
  } catch (e) {
    return (e as Error).message;
  }
}

/** `ledger-X.db` → `ledger-X-2.db`, `-3`…: el siguiente nombre si el primero ya está cogido. */
function conSufijo(destino: string, n: number): string {
  const ext = path.extname(destino);
  return `${destino.slice(0, destino.length - ext.length)}-${n}${ext}`;
}

/**
 * Escribe una copia del libro mayor sin que nunca exista a medias con nombre de copia (lote H,
 * H1). `escribir` llena un temporal propio de este escritor, `<destino>.<pid>-<azar>.parcial`, que
 * no casa con `PATRON_COPIA`: ni la rotación, ni `restore`, ni las huellas lo ven. Después se
 * comprueba (con algo dentro, íntegro, con las tablas del libro mayor), se fuerza a disco y se
 * publica con un enlace, que nunca pisa: si el nombre ya está cogido (otro escritor en el mismo
 * segundo), el siguiente libre. Devuelve dónde quedó.
 *
 * Antes se escribía sobre el nombre final, y una copia cortada a mitad parecía buena: la rotación
 * borraba por ella una copia de verdad. Si algo falla, el temporal propio se quita y el error sube;
 * si el proceso muere, queda el `.parcial` (y quizá su `-journal`), que no es una copia.
 */
export function escribirCopiaAtomica(destino: string, escribir: (temporal: string) => void): { fichero: string; integridad: string } {
  const temporal = `${destino}.${process.pid}-${randomBytes(4).toString('hex')}.parcial`;
  try {
    escribir(temporal);
    const integridad = validarCopia(temporal);
    if (integridad !== 'ok') throw new Error(`La copia no sirve (${integridad}); descartada.`);
    const fd = fs.openSync(temporal, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    let fichero = destino;
    for (let n = 2; ; n++) {
      try {
        fs.linkSync(temporal, fichero);
        fs.rmSync(temporal);
        break;
      } catch (e) {
        const codigo = (e as NodeJS.ErrnoException).code;
        if (codigo === 'EEXIST') {
          fichero = conSufijo(destino, n);
          continue;
        }
        // Un disco sin enlaces (FAT, exFAT, algunos montajes de red): renombrar, mirando antes.
        if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS', 'EOPNOTSUPP'].includes(codigo ?? '')) throw e;
        if (fs.existsSync(fichero)) {
          fichero = conSufijo(destino, n);
          continue;
        }
        fs.renameSync(temporal, fichero);
        break;
      }
    }
    try {
      // La publicación también tiene que llegar al disco; no todos los sistemas dejan abrir una carpeta.
      const d = fs.openSync(path.dirname(fichero), 'r');
      try {
        fs.fsyncSync(d);
      } finally {
        fs.closeSync(d);
      }
    } catch {
      // Windows: sin fsync de carpetas.
    }
    return { fichero, integridad };
  } catch (e) {
    fs.rmSync(temporal, { force: true });
    throw e;
  }
}

export async function hacerCopia(opts: { dir?: string; ahora?: Date; entorno?: NodeJS.ProcessEnv; subir?: boolean } = {}): Promise<Copia> {
  const dir = opts.dir ?? directorioCopias(opts.entorno);
  const ahora = opts.ahora ?? new Date();
  fs.mkdirSync(dir, { recursive: true });
  const db = getDb();
  // Dos copias en el mismo segundo no se pisan: la segunda queda como `ledger-<fecha>-2.db`.
  const { fichero, integridad } = escribirCopiaAtomica(path.join(dir, `ledger-${sello(ahora)}.db`), (temporal) =>
    db.exec(`VACUUM ${LEDGER_SCHEMA} INTO '${temporal.replace(/'/g, "''")}'`),
  );
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
 * Restaura una copia como libro mayor (lote B, B1: de verdad, con WAL).
 *
 * Se niega si otro proceso tiene el destino abierto (el servidor en marcha): la conexión vieja
 * seguiría escribiendo en el fichero viejo. Aparta el actual con `VACUUM INTO` —completo, con lo
 * que estuviera en su WAL— como `ledger.db.antes-de-restaurar-<fecha>`; construye el nuevo con
 * `VACUUM INTO` desde la copia a un temporal, lo comprueba, quita los `-wal`/`-shm` del fichero
 * viejo y renombra. Si el actual está tan roto que no se deja copiar, se aparta tal cual (con sus
 * laterales) y se avisa.
 */
export function restaurarCopia(origen: string, opts: { ahora?: Date; destino?: string } = {}): { destino: string; apartado: string | null; aviso: string | null } {
  if (!fs.existsSync(origen)) throw new Error(`No existe ${origen}`);
  const prueba = new DatabaseSync(origen, { readOnly: true });
  const integridad = (prueba.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const tablas = (prueba.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  prueba.close();
  if (integridad !== 'ok') throw new Error(`La copia no pasa integrity_check (${integridad}).`);
  if (!tablas.includes('paper_bets') || !tablas.includes('prediction_log')) throw new Error('Ese fichero no parece un libro mayor (faltan paper_bets o prediction_log).');
  const destino = opts.destino ?? ficherosDe().ledger;
  if (!destino) throw new Error(`En disposición ${LAYOUT} no hay ledger.db que restaurar.`);
  // Un ledger.db de 0 bytes no es un libro mayor, pero abrirlo (para ver si hay otra conexión o para
  // apartarlo) hace que SQLite borre su WAL, que puede llevar los últimos commits: antes de abrir
  // nada se apartan los dos. Una base en uso no tiene 0 bytes (abrirBase escribe la página 1 al
  // pasar a WAL, justo tras el ATTACH): solo un libro truncado en caliente se saltaría la sonda de
  // abajo, y esa sonda también le habría borrado el WAL.
  const sinLibro: string[] = [];
  const avisoSinLibro = () => `no había libro mayor encima (faltaba o tenía 0 bytes); se apartó, sin borrarlo: ${sinLibro.map((f) => path.basename(f)).join(', ')}`;
  try {
    if (fs.existsSync(destino) && fs.statSync(destino).size === 0) apartarLibroVacio(destino, opts.ahora, sinLibro);
    if (otraConexionAbierta(destino)) {
      throw new Error(`${destino} está abierto por otro proceso (el servidor en marcha). Párala y vuelve a intentarlo: restaurar encima de una conexión abierta corrompe el libro mayor.`);
    }
    let apartado: string | null = null;
    let aviso: string | null = null;
    if (fs.existsSync(destino)) {
      // Con nombre libre: dos restauraciones en el mismo segundo no pisan el primer libro apartado.
      apartado = nombreLibre(`${destino}.antes-de-restaurar-${sello(opts.ahora ?? new Date())}`);
      try {
        const ok = copiaConsistente(destino, apartado);
        if (ok !== 'ok') aviso = `el libro mayor apartado no pasa integrity_check (${ok}); se restaura igual`;
      } catch (e) {
        // No se deja copiar como base: se aparta tal cual, con sus laterales, y se dice.
        fs.copyFileSync(destino, apartado);
        for (const suf of ['-wal', '-shm']) if (fs.existsSync(destino + suf)) fs.copyFileSync(destino + suf, apartado + suf);
        aviso = `el libro mayor actual no se pudo copiar como base (${(e as Error).message}); se apartó tal cual`;
      }
    }
    const temporal = `${destino}.restaurando`;
    const ok = copiaConsistente(origen, temporal);
    if (ok !== 'ok') {
      fs.rmSync(temporal, { force: true });
      throw new Error(`La copia reconstruida no pasa integrity_check (${ok}); no se toca el libro mayor.`);
    }
    // Sin libro mayor pero con su WAL: puede llevar los últimos commits; se aparta, no se borra.
    if (!apartado) apartarLateralesHuerfanos(destino, opts.ahora, sinLibro);
    if (sinLibro.length) aviso = avisoSinLibro();
    quitarLaterales(destino);
    fs.renameSync(temporal, destino);
    return { destino, apartado, aviso };
  } catch (e) {
    // Lo que ya se apartó no se pierde de vista aunque la restauración falle a mitad.
    if (sinLibro.length && e instanceof Error) e.message += ` Ojo: ${avisoSinLibro()}.`;
    throw e;
  }
}
