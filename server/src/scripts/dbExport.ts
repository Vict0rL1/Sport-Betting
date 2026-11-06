// `npm run db:export-history [-- <destino>]` — una copia limpia y consistente de history.db,
// para publicarla (el workflow nocturno) o moverla. Con WAL, el fichero vivo puede tener
// páginas en `history.db-wal`; `VACUUM INTO` produce un solo fichero con todo dentro y
// comprobado. Nunca toca el libro mayor.
//
// Ni la meta privada (auditoría paralela del 3 de noviembre): la migración 27 deja en `main.meta`
// una copia de `ajustes.usuario` (el banco personal del dueño) y `features.anulaciones` para
// recuperarlas si se restaura un libro mayor de antes. Esa copia se queda en la base original; en la
// exportación se quita toda clave que `claveEsLedger` clasifica como estado del libro mayor: se borran
// con `secure_delete` en una copia intermedia, y el fichero final lo escribe `VACUUM INTO` desde esa
// copia ya limpia, así que no quedan ni sus bytes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb } from '../db.ts';
import { ficherosDe } from '../db/layout.ts';
import { TABLAS_LEDGER, claveEsLedger } from '../db/tables.ts';
import { otraConexionAbierta } from '../db/sqliteSeguro.ts';

// Un destino relativo se resuelve desde donde se llamó a npm (INIT_CWD), como restore.ts: `npm run
// db:export-history -- data/history.export.db` (el workflow) corre en server/ y apuntaba a server/data
// (revisión data-guardian del 5 de noviembre).
const destino =
  process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2]) : path.join(path.dirname(ficherosDe().history), 'history.export.db');
const tablasDe = (d: DatabaseSync) => (d.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as { name: string }[]).map((r) => r.name);
const clavesDe = (d: DatabaseSync) => (tablasDe(d).includes('meta') ? (d.prepare('SELECT key FROM meta').all() as { key: string }[]).map((r) => r.key) : []);

/**
 * Por qué no se puede exportar encima de `destino`, o null si se puede (revisión data-guardian del 3
 * de noviembre: `db:export-history -- data/ledger.db` reemplazaba el libro mayor por una historia).
 * Ni la base viva, ni el libro mayor, ni un tennis.db sin partir, ni sus laterales; y si ya hay algo,
 * solo una base sin tablas del libro mayor (una exportación anterior).
 */
function motivoParaNoPisar(): string | null {
  const real = (f: string) => {
    try {
      return fs.realpathSync(f);
    } catch {
      return path.resolve(f);
    }
  };
  const { history, ledger } = ficherosDe();
  const vivas = [history, ledger, path.join(path.dirname(history), 'tennis.db')].filter((f): f is string => f !== null);
  const destinoReal = real(destino);
  for (const f of vivas) for (const suf of ['', '-wal', '-shm', '-journal']) if (destinoReal === real(f + suf)) return `es ${path.basename(f + suf)}, una base de la instalación`;
  // Un -wal o -journal con algo junto al destino es de otra base, o de él mismo con cambios sin pasar
  // (revisión data-guardian del 5 de noviembre: un ledger.db a 0 bytes con sus apuestas en el -wal
  // perdía el WAL y quedaba reemplazado). Ni se borra ni se exporta encima.
  for (const suf of ['-wal', '-journal']) {
    const f = destino + suf;
    if (fs.existsSync(f) && fs.statSync(f).size > 0) return `tiene al lado un ${path.basename(f)} con contenido`;
  }
  if (!fs.existsSync(destino)) return null;
  if (!fs.statSync(destino).isFile()) return 'no es un fichero';
  if (fs.statSync(destino).size === 0) return 'está vacío (0 bytes): no es una exportación anterior';
  // Las copias con fecha de la instalación (fetch-data, restaurar, partir) no son exportaciones.
  if (/\.(backup|sin-filas|ilegible|pre-split|antes-de-restaurar)-/.test(path.basename(destino))) return 'es una copia con fecha de la instalación';
  try {
    const d = new DatabaseSync(destino, { readOnly: true });
    try {
      const delLibroMayor = tablasDe(d).filter((t) => TABLAS_LEDGER.includes(t));
      if (delLibroMayor.length) return `tiene tablas del libro mayor (${delLibroMayor.join(', ')})`;
      // Una exportación nunca lleva meta privada: si la tiene, es otra cosa (una historia viva o copiada).
      if (clavesDe(d).some(claveEsLedger)) return 'lleva meta privada: no es una exportación';
    } finally {
      d.close();
    }
  } catch {
    return 'ya existe y no es una base SQLite';
  }
  // Una conexión de verdad (un servidor, otra herramienta) sigue abierta; la sonda de otra exportación
  // al mismo destino dura un instante: se reintenta un poco antes de rendirse (revisión data-guardian).
  for (let intento = 0; intento < 5; intento++) {
    if (!otraConexionAbierta(destino)) return null;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return 'está abierta por otro proceso';
}

const motivo = motivoParaNoPisar();
if (motivo) {
  console.error(`✗ No se exporta encima de ${destino}: ${motivo}. Elige otro destino.`);
  process.exit(1);
}

// Todo se construye aparte y se renombra al final (revisión data-guardian del 3 de noviembre): si el
// proceso muere a medias, en `destino` no queda una copia sin limpiar; y si algo falla, los temporales
// (que llevan la meta privada) se borran (revisiones security y data-guardian).
//
// En un directorio PROPIO de esta exportación, creado con mkdtemp junto al destino (mismo sistema de
// ficheros, así el rename final es atómico), y solo ese directorio se borra (auditoría del 5 de
// noviembre): con nombres fijos (`<destino>.parcial`, `<destino>.limpia`), una base ajena con ese
// nombre se borraba sin aviso, y dos exportaciones a la vez se pisaban los temporales.
const dirDestino = path.dirname(destino);
const prefijo = `${path.basename(destino)}.tmp-`;
const MARCA = 'propietario.json';
const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};
// Restos de otras exportaciones (revisión data-guardian del 5 de noviembre: llevan meta privada, y
// dejarlos para siempre era peor que antes). Se borran solo los que su marca dice que son de una
// exportación de ESTA máquina cuyo proceso ya no existe y que empezó hace más de una hora (un
// contenedor con el mismo nombre de máquina y otros pids podría ver muerto un proceso vivo); los demás
// (otra en marcha, otra máquina con el directorio compartido, recientes o sin marca) se avisan y no se
// tocan.
const UNA_HORA = 3_600_000;
const avisar: string[] = [];
for (const f of fs.readdirSync(dirDestino).filter((x) => x.startsWith(prefijo))) {
  let marca: { pid?: unknown; host?: unknown; inicio?: unknown } | null = null;
  try {
    marca = JSON.parse(fs.readFileSync(path.join(dirDestino, f, MARCA), 'utf8')) as { pid?: unknown; host?: unknown; inicio?: unknown };
  } catch {
    marca = null;
  }
  const antigua = marca && typeof marca.inicio === 'string' && Date.now() - Date.parse(marca.inicio) > UNA_HORA;
  if (marca && antigua && marca.host === os.hostname() && typeof marca.pid === 'number' && !vivo(marca.pid)) {
    fs.rmSync(path.join(dirDestino, f), { recursive: true, force: true });
    console.warn(`⚠ Restos de una exportación interrumpida (proceso ${marca.pid}, ya terminado) borrados: ${f}`);
  } else avisar.push(f);
}
// Los temporales de antes de este cambio, con nombre fijo: tampoco se sabe de quién son.
for (const suf of ['.parcial', '.limpia']) if (fs.existsSync(destino + suf)) avisar.push(path.basename(destino + suf));
if (avisar.length) {
  console.warn(
    `⚠ Junto al destino hay temporales de otra exportación (${avisar.join(', ')}). No se tocan: si no hay ninguna en marcha, ` +
      'son restos de una interrumpida y pueden llevar meta privada; bórralos a mano.',
  );
}
let propio: string | null = null;
let copia: DatabaseSync | null = null;
try {
  // mkdtemp lo crea solo para este proceso (0700), y la marca dice de quién es por si muere a medias.
  propio = fs.mkdtempSync(path.join(dirDestino, prefijo));
  fs.writeFileSync(path.join(propio, MARCA), JSON.stringify({ pid: process.pid, host: os.hostname(), inicio: new Date().toISOString() }));
  const parcial = path.join(propio, 'parcial.db');
  const limpia = path.join(propio, 'limpia.db');
  const db = getDb();
  db.exec(`VACUUM main INTO '${parcial.replace(/'/g, "''")}'`);
  // Solo en la COPIA: la original conserva su copia de recuperación.
  copia = new DatabaseSync(parcial);
  const privadas = clavesDe(copia).filter(claveEsLedger);
  copia.exec('PRAGMA secure_delete = ON');
  const borrar = copia.prepare('DELETE FROM meta WHERE key = ?');
  copia.exec('BEGIN');
  for (const k of privadas) borrar.run(k);
  copia.exec('COMMIT');
  // El fichero final lo escribe VACUUM INTO desde la copia ya limpia: solo lleva filas vivas.
  copia.exec(`VACUUM INTO '${limpia.replace(/'/g, "''")}'`);
  copia.close();
  copia = null;
  const final = new DatabaseSync(limpia, { readOnly: true });
  const integridad = (final.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const tablas = tablasDe(final);
  const quedan = clavesDe(final).filter(claveEsLedger);
  final.close();
  const coladas = tablas.filter((t) => TABLAS_LEDGER.includes(t));
  // Y ni sus nombres en los bytes (los valores nunca se imprimen ni se buscan a ciegas: pueden ser cortos).
  const bytes = fs.readFileSync(limpia);
  const restos = privadas.filter((k) => bytes.includes(Buffer.from(k)));
  // Lo que haya en el destino se vuelve a mirar justo antes de reemplazarlo: pudo cambiar mientras se exportaba.
  const motivoAhora = motivoParaNoPisar();
  if (integridad !== 'ok' || coladas.length || quedan.length || restos.length) {
    console.error(
      `✗ Exportación descartada: integridad «${integridad}»${coladas.length ? `, tablas del libro mayor dentro: ${coladas.join(', ')}` : ''}` +
        `${quedan.length || restos.length ? `, claves privadas de meta que no se pudieron quitar: ${[...new Set([...quedan, ...restos])].join(', ')}` : ''}`,
    );
    process.exitCode = 1;
  } else if (motivoAhora) {
    console.error(`✗ No se exporta encima de ${destino}: ${motivoAhora}. Elige otro destino.`);
    process.exitCode = 1;
  } else {
    // Los laterales del fichero que se reemplaza (un WAL viejo junto al nuevo se aplicaría encima; la
    // comprobación de arriba ya garantiza que no llevan nada), y el rename, que reemplaza el destino de
    // una vez.
    for (const suf of ['-journal', '-wal', '-shm']) fs.rmSync(destino + suf, { force: true });
    fs.renameSync(limpia, destino);
    console.log(
      `✓ ${destino} (${(fs.statSync(destino).size / 1048576).toFixed(0)} MB, ${tablas.length} tablas, integridad ok, sin tablas del libro mayor` +
        `${privadas.length ? `; ${privadas.length} clave(s) privada(s) de meta fuera (${privadas.join(', ')}): siguen en la base original para recuperarlas` : ''})`,
    );
  }
} finally {
  try {
    copia?.close();
  } catch {
    // ya cerrada
  }
  // Solo lo que creó esta exportación.
  if (propio) fs.rmSync(propio, { recursive: true, force: true });
}
