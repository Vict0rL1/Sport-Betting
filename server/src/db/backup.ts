// Copias de seguridad del libro mayor.
//
// Solo del libro mayor: la historia se vuelve a bajar o a reconstruir; las apuestas, las
// predicciones registradas y los precios observados, no. La copia es un `VACUUM INTO` del
// esquema `ledger` —un fichero nuevo, consistente aunque haya WAL— que se comprueba con
// `integrity_check` antes de darla por buena. Se guardan las últimas N en local y, si hay
// credenciales, cada una se sube también a un almacén S3 compatible (db/s3.ts).

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb, getMeta, setMeta } from '../db.ts';
import { LEDGER_SCHEMA, LAYOUT, ficherosDe, directorioCopias, PATRON_COPIA, apartarLateralesHuerfanos, apartarLibroVacio, nombreLibre } from './layout.ts';
import { subirS3, configS3 } from './s3.ts';
import { copiaConsistente, integridadDe, otraConexionAbierta, quitarLaterales } from './sqliteSeguro.ts';
import { compararManifiestos, manifiestoDeFichero, type DiferenciaTabla } from './manifiesto.ts';

export const CLAVE_ULTIMA = 'backup:last_at';
export const CLAVE_ULTIMO_FICHERO = 'backup:last_file';
/** La última restauración de prueba (auditoría del 17 de octubre, punto 1): JSON con su resultado. */
export const CLAVE_ULTIMA_VERIFICACION = 'backup:last_verify';
export const COPIAS_LOCALES = 14;

export { directorioCopias };

export interface Copia {
  fichero: string;
  bytes: number;
  integridad: string;
  /** La restauración de prueba de esta copia. */
  verificacion: VerificacionRestauracion;
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
  let verificacion: VerificacionRestauracion;
  try {
    verificacion = verificarRestauracion(fichero);
  } catch (e) {
    verificacion = { fichero, tablas: 0, filas: 0, diferencias: [], error: (e as Error).message };
  }
  if (verificacion.diferencias.length || verificacion.error) {
    // Una copia que no se restaura igual (o que no se pudo comprobar) no entra en la rotación ni se
    // sube: se aparta con un nombre que no es de copia, sin borrarla (puede ser lo único que hay), y
    // solo se guarda la última apartada. El doctor lo enseña como error (revisión data-guardian del
    // 20 de octubre, hallazgo 5).
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.sin-verificar')) fs.rmSync(path.join(dir, f), { force: true });
    const apartada = nombreLibre(`${fichero}.sin-verificar`);
    fs.renameSync(fichero, apartada);
    setMeta(CLAVE_ULTIMA_VERIFICACION, JSON.stringify({ cuando: ahora.toISOString(), ...verificacion, fichero: apartada }));
    throw new Error(
      `La copia ${path.basename(fichero)} ${verificacion.error ? `no se pudo restaurar de prueba (${verificacion.error})` : `no se restaura igual: ${verificacion.diferencias.map((d) => `${d.tabla} ${d.a ?? '—'}→${d.b ?? '—'}${d.contenidoDistinto ? ' (contenido distinto)' : ''}`).join(', ')}`}; apartada como ${path.basename(apartada)}`,
    );
  }
  setMeta(CLAVE_ULTIMA_VERIFICACION, JSON.stringify({ cuando: ahora.toISOString(), ...verificacion }));
  // Rotación: las últimas N.
  const borradas: string[] = [];
  for (const c of copiasLocales(dir).slice(COPIAS_LOCALES)) {
    fs.rmSync(c.fichero, { force: true });
    borradas.push(c.fichero);
  }
  const out: Copia = { fichero, bytes, integridad, verificacion, borradas };
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

export interface VerificacionRestauracion {
  fichero: string;
  tablas: number;
  filas: number;
  /** Tablas en que lo restaurado no es la copia. Vacío (y sin error) = verificada. */
  diferencias: DiferenciaTabla[];
  /** La restauración de prueba no se pudo hacer (disco lleno, la copia no abre…). */
  error?: string;
}

/**
 * Restaura `fichero` en una carpeta de usar y tirar, por el mismo camino que `npm run restore`
 * (restaurarCopia), y compara el manifiesto de lo restaurado con el de la copia. No toca el libro
 * mayor ni BACKUP_DIR: todo pasa en un directorio temporal que se borra al acabar.
 */
export function verificarRestauracion(fichero: string): VerificacionRestauracion {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verificar-restauracion-'));
  try {
    // Ni el manifiesto se lee del original: abrir una base con su -wal al lado le crea un -shm.
    const trabajo = copiaDeTrabajo(fichero, dir);
    const destino = path.join(dir, 'ledger.db');
    restaurarCopia(trabajo, { destino });
    const copia = manifiestoDeFichero(trabajo);
    const restaurada = manifiestoDeFichero(destino);
    return {
      fichero,
      tablas: Object.keys(copia.tablas).length,
      filas: Object.values(copia.tablas).reduce((a, t) => a + t.filas, 0),
      diferencias: compararManifiestos(copia, restaurada),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  // La copia que se restaura no se abre nunca: SQLite volcaría su -wal en ella al cerrar (y le
  // crearía un -shm). Se trabaja sobre una copia suya, con su -wal, junto al destino (revisión
  // data-guardian del 20 de octubre, hallazgo 1).
  const destinoFinal = opts.destino ?? ficherosDe().ledger;
  if (!destinoFinal) throw new Error(`En disposición ${LAYOUT} no hay ledger.db que restaurar.`);
  const dirTrabajo = fs.mkdtempSync(path.join(path.dirname(destinoFinal), '.restaurar-'));
  try {
    return restaurarDesde(copiaDeTrabajo(origen, dirTrabajo), destinoFinal, opts.ahora);
  } finally {
    fs.rmSync(dirTrabajo, { recursive: true, force: true });
  }
}

/** Una copia de `origen` en `dir`, con su -wal si lo tiene (sin -shm: SQLite lo rehace). */
function copiaDeTrabajo(origen: string, dir: string): string {
  const f = path.join(dir, 'origen.db');
  fs.copyFileSync(origen, f);
  if (fs.existsSync(origen + '-wal')) fs.copyFileSync(origen + '-wal', f + '-wal');
  return f;
}

function restaurarDesde(origen: string, destino: string, ahora: Date | undefined): { destino: string; apartado: string | null; aviso: string | null } {
  const opts = { ahora };
  const prueba = new DatabaseSync(origen, { readOnly: true });
  const integridad = (prueba.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const tablas = (prueba.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  prueba.close();
  if (integridad !== 'ok') throw new Error(`La copia no pasa integrity_check (${integridad}).`);
  if (!tablas.includes('paper_bets') || !tablas.includes('prediction_log')) throw new Error('Ese fichero no parece un libro mayor (faltan paper_bets o prediction_log).');
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
