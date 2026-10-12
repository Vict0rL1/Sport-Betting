// La migración única de `tennis.db` (todo junto) a `history.db` + `ledger.db`.
//
// SIN PERDER NADA, POR CONSTRUCCIÓN
// No hay ningún `INSERT … SELECT`: se hacen DOS copias completas del fichero con
// `VACUUM INTO` (una copia física y consistente) y en cada una se quitan con `DROP TABLE` las
// tablas que no le corresponden. Un `DROP` arrastra sus índices y triggers. Ninguna fila se
// transforma, ningún trigger de validación vuelve a evaluar filas viejas, y el original se
// queda al lado con otro nombre hasta que quien quiera lo borre.
//
// Las claves de ESTADO de `meta` (banco de papel, latido del ciclo) se copian a
// `ledger.settings`, que es donde las lee la app desde la Fase 2 (ver tables.ts).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TABLAS_LEDGER, claveEsLedger } from './tables.ts';
import { apartarConLaterales, apartarLateralesHuerfanos, apartarLibroVacio } from './layout.ts';
import { integridadDe, otraConexionAbierta } from './sqliteSeguro.ts';

export interface ResultadoSplit {
  history: string;
  ledger: string;
  original: string;
  tablasHistory: string[];
  tablasLedger: string[];
  settingsCopiadas: number;
  /** WAL/SHM huérfanos que estaban donde iban los ficheros nuevos: apartados, no borrados. */
  apartados: string[];
}

function tablasDe(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
}

/** Copia física del fichero abierto, consistente aunque haya WAL. */
function copiar(origen: string, destino: string): void {
  const db = new DatabaseSync(origen);
  try {
    fs.rmSync(destino, { force: true });
    db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

function quitar(fichero: string, condicion: (tabla: string) => boolean): string[] {
  const db = new DatabaseSync(fichero);
  try {
    const todas = tablasDe(db);
    const fuera = todas.filter(condicion);
    db.exec('BEGIN');
    for (const t of fuera) db.exec(`DROP TABLE IF EXISTS "${t}"`);
    db.exec('COMMIT');
    db.exec('VACUUM');
    return todas.filter((t) => !fuera.includes(t));
  } finally {
    db.close();
  }
}

/** Las claves de estado de `meta` del original → `settings` del libro mayor. */
function copiarSettings(original: string, ledger: string): number {
  const db = new DatabaseSync(ledger);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    db.exec(`ATTACH '${original.replace(/'/g, "''")}' AS old`);
    const filas = db.prepare("SELECT key, value FROM old.meta").all() as { key: string; value: string }[];
    const ins = db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    let n = 0;
    const t = new Date().toISOString();
    for (const f of filas) {
      if (claveEsLedger(f.key)) {
        ins.run(f.key, f.value, t);
        n++;
      }
    }
    db.exec('DETACH old');
    return n;
  } catch {
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Parte `original` en `history` y `ledger`. No toca `original` salvo para renombrarlo al final
 * (`<original>.pre-split-<fecha>`), y solo si todo lo anterior salió bien.
 */
export function partirBase(original: string, history: string, ledger: string, ahora = new Date()): ResultadoSplit {
  if (!fs.existsSync(original)) throw new Error(`No existe ${original}`);
  // Nunca encima de nada: el rename de abajo reemplazaría el fichero sin decir nada.
  for (const f of [history, ledger]) if (fs.existsSync(f)) throw new Error(`Ya existe ${f}: no se parte ${original} encima.`);
  const tmpH = `${history}.partiendo`;
  const tmpL = `${ledger}.partiendo`;
  try {
    copiar(original, tmpH);
    copiar(original, tmpL);
    const tablasHistory = quitar(tmpH, (t) => TABLAS_LEDGER.includes(t));
    const tablasLedger = quitar(tmpL, (t) => !TABLAS_LEDGER.includes(t));
    const settingsCopiadas = copiarSettings(original, tmpL);
    // Un WAL que quedó donde van los ficheros nuevos (de una base que se cortó) se aplicaría encima
    // al abrirlos: SQLite no mira de qué base salió (tercera revisión de data-guardian). Se aparta.
    const apartados = [...apartarLateralesHuerfanos(history, ahora), ...apartarLateralesHuerfanos(ledger, ahora)];
    // Las dos copias están completas: ahora sí, en su sitio y el original apartado.
    fs.renameSync(tmpH, history);
    fs.renameSync(tmpL, ledger);
    const sello = ahora.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const apartado = `${original}.pre-split-${sello}`;
    fs.renameSync(original, apartado);
    for (const suf of ['-wal', '-shm', '-journal']) fs.rmSync(original + suf, { force: true });
    // La marca de que aquí hay libro mayor (lote B, B4): si un día falta, el servidor lo dirá.
    fs.writeFileSync(`${ledger}.existe`, `libro mayor creado al partir ${original} el ${ahora.toISOString()}\n`);
    return { history, ledger, original: apartado, tablasHistory, tablasLedger, settingsCopiadas, apartados };
  } catch (e) {
    fs.rmSync(tmpH, { force: true });
    fs.rmSync(tmpL, { force: true });
    throw e;
  }
}

/**
 * ¿Hace falta partir? Hay original con datos y no hay ninguno de los dos nuevos. Uno de 0 bytes no
 * se abre: SQLite le borraría el WAL, que puede llevar todos sus commits (lo dice comprobarLibroMayor).
 */
export function hayQuePartir(original: string, history: string, ledger: string): boolean {
  return fs.existsSync(original) && fs.statSync(original).size > 0 && !fs.existsSync(history) && !fs.existsSync(ledger);
}

/**
 * ¿Queda un `original` sin partir? `'sin-partir'` si no hay ninguno de los dos nuevos (abrir la base
 * lo parte); `'junto'` si está al lado de alguno: una partición cortada a medias o un libro mayor
 * empezado de cero. Ahí nadie lo parte, y si tenía apuestas siguen DENTRO de él. Uno de 0 bytes no
 * tiene nada que partir.
 */
export function legadoSinPartir(original: string, history: string, ledger: string): 'sin-partir' | 'junto' | null {
  if (!fs.existsSync(original) || fs.statSync(original).size === 0) return null;
  return fs.existsSync(history) || fs.existsSync(ledger) ? 'junto' : 'sin-partir';
}

/**
 * `npm run db:migrate -- --partir-legado`: deja sitio para partir un tennis.db que tiene al lado un
 * history.db (o un ledger.db de 0 bytes) y que por eso no se parte solo. Aparta history.db CON sus
 * laterales, y el ledger.db vacío y su WAL, sin borrar nada. Se niega si no hay tennis.db con
 * datos, si ya hay un ledger.db con datos (eso no se aparta nunca: lo compara el doctor) o si
 * alguien tiene abierta la base.
 */
export function apartarParaPartir(original: string, history: string, ledger: string, ahora = new Date()): string[] {
  if (!fs.existsSync(original) || fs.statSync(original).size === 0) throw new Error(`No hay un ${path.basename(original)} con datos que partir (${original}).`);
  // Antes de mover nada, que sea una base íntegra con algo del libro mayor: si no, history.db quedaría
  // apartado y la partición fallaría igual.
  let integridad: string;
  let tablas: string[] = [];
  try {
    integridad = integridadDe(original);
    const d = new DatabaseSync(original, { readOnly: true });
    try {
      tablas = tablasDe(d);
    } finally {
      d.close();
    }
  } catch (e) {
    integridad = (e as Error).message;
  }
  if (integridad !== 'ok') throw new Error(`${path.basename(original)} no es una base íntegra (${integridad}); no se mueve nada.`);
  if (!tablas.some((t) => TABLAS_LEDGER.includes(t))) throw new Error(`${path.basename(original)} no tiene ninguna tabla del libro mayor; no se mueve nada.`);
  if (fs.existsSync(ledger) && fs.statSync(ledger).size > 0) {
    throw new Error(`Ya hay un ${path.basename(ledger)} con datos: un libro mayor no se aparta. npm run doctor compara los dos.`);
  }
  for (const f of [original, history]) {
    if (otraConexionAbierta(f)) throw new Error(`${f} está abierto por otro proceso (¿el servidor en marcha?). Páralo y vuelve a intentarlo.`);
  }
  const apartados: string[] = [];
  apartarLibroVacio(ledger, ahora, apartados);
  if (fs.existsSync(history)) apartados.push(...apartarConLaterales(history, 'aparte', ahora));
  else apartarLateralesHuerfanos(history, ahora, apartados);
  return apartados;
}

/** Tablas del libro mayor que no son el libro mayor de nadie: sesiones, errores, ejecuciones. */
const TABLAS_DE_OPERACION = new Set(['sessions', 'error_log', 'ingestion_runs', 'scheduler_jobs', 'notification_log']);

/**
 * Para el doctor, con un tennis.db sin partir junto a un ledger.db: cuántas filas de cada tabla del
 * libro mayor que tiene tennis.db (todas menos las de operación) NO están, iguales, en ledger.db.
 * Una tabla que ledger.db no tiene: todas sus filas faltan. 0 en todas: ledger.db salió de ese
 * tennis.db (una partición cortada justo antes de apartarlo). Lo que no se puede leer o comparar
 * es `null` (DESCONOCIDO), nunca 0, y si no se puede ni empezar, una sola fila `null`. Una fila
 * que cambió después (una apuesta liquidada, un ajuste) cuenta como que falta: mejor un «no muevas
 * nada» de más que uno de menos. Solo lee, y no abre un fichero de 0 bytes (SQLite le borraría el WAL).
 */
export function filasDelLegadoQueFaltan(original: string, ledger: string): { tabla: string; faltan: number | null }[] {
  const nada = [{ tabla: path.basename(original), faltan: null }];
  const conDatos = (f: string) => fs.existsSync(f) && fs.statSync(f).size > 0;
  if (!conDatos(original) || !conDatos(ledger)) return nada;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(ledger, { readOnly: true });
  } catch {
    return nada;
  }
  try {
    db.exec(`ATTACH '${original.replace(/'/g, "''")}' AS legado`);
    const tablas = (esquema: string) => new Set((db.prepare(`SELECT name FROM ${esquema}.sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name));
    const enLegado = tablas('legado');
    const enLedger = tablas('main');
    const columnas = (esquema: string, tabla: string) => (db.prepare(`PRAGMA ${esquema}.table_info("${tabla}")`).all() as { name: string }[]).map((c) => c.name);
    const contar = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    const out: { tabla: string; faltan: number | null }[] = [];
    for (const tabla of TABLAS_LEDGER.filter((t) => enLegado.has(t) && !TABLAS_DE_OPERACION.has(t))) {
      let faltan: number | null = null;
      try {
        if (!enLedger.has(tabla)) faltan = contar(`SELECT COUNT(*) AS n FROM legado."${tabla}"`);
        else {
          const delLedger = columnas('main', tabla);
          const comunes = columnas('legado', tabla).filter((c) => delLedger.includes(c));
          const lista = comunes.map((c) => `"${c}"`).join(', ');
          if (comunes.length) faltan = contar(`SELECT COUNT(*) AS n FROM (SELECT ${lista} FROM legado."${tabla}" EXCEPT SELECT ${lista} FROM main."${tabla}")`);
        }
      } catch {
        // DESCONOCIDO
      }
      out.push({ tabla, faltan });
    }
    return out.length ? out : nada;
  } catch {
    // tennis.db no se deja adjuntar ni leer.
    return nada;
  } finally {
    db.close();
  }
}
