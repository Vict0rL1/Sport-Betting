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
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb } from '../db.ts';
import { ficherosDe } from '../db/layout.ts';
import { TABLAS_LEDGER, claveEsLedger } from '../db/tables.ts';

const destino = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(path.dirname(ficherosDe().history), 'history.export.db');
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
  if (!fs.existsSync(destino)) return null;
  if (!fs.statSync(destino).isFile()) return 'no es un fichero';
  try {
    const d = new DatabaseSync(destino, { readOnly: true });
    try {
      const delLibroMayor = tablasDe(d).filter((t) => TABLAS_LEDGER.includes(t));
      return delLibroMayor.length ? `tiene tablas del libro mayor (${delLibroMayor.join(', ')})` : null;
    } finally {
      d.close();
    }
  } catch {
    return 'ya existe y no es una base SQLite';
  }
}

const motivo = motivoParaNoPisar();
if (motivo) {
  console.error(`✗ No se exporta encima de ${destino}: ${motivo}. Elige otro destino.`);
  process.exit(1);
}

// Todo se construye aparte y se renombra al final (revisión data-guardian del 3 de noviembre): si el
// proceso muere a medias, en `destino` no queda una copia sin limpiar; y si algo falla, los temporales
// (que llevan la meta privada) se borran (revisiones security y data-guardian).
const parcial = `${destino}.parcial`;
const limpia = `${destino}.limpia`;
const quitar = (f: string) => {
  for (const suf of ['', '-journal', '-wal', '-shm']) fs.rmSync(f + suf, { force: true });
};
let copia: DatabaseSync | null = null;
let instalada = false;
try {
  const db = getDb();
  quitar(parcial);
  quitar(limpia);
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
  quitar(parcial);
  const final = new DatabaseSync(limpia, { readOnly: true });
  const integridad = (final.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
  const tablas = tablasDe(final);
  const quedan = clavesDe(final).filter(claveEsLedger);
  final.close();
  const coladas = tablas.filter((t) => TABLAS_LEDGER.includes(t));
  // Y ni sus nombres en los bytes (los valores nunca se imprimen ni se buscan a ciegas: pueden ser cortos).
  const bytes = fs.readFileSync(limpia);
  const restos = privadas.filter((k) => bytes.includes(Buffer.from(k)));
  if (integridad !== 'ok' || coladas.length || quedan.length || restos.length) {
    console.error(
      `✗ Exportación descartada: integridad «${integridad}»${coladas.length ? `, tablas del libro mayor dentro: ${coladas.join(', ')}` : ''}` +
        `${quedan.length || restos.length ? `, claves privadas de meta que no se pudieron quitar: ${[...new Set([...quedan, ...restos])].join(', ')}` : ''}`,
    );
    process.exitCode = 1;
  } else {
    quitar(destino);
    fs.renameSync(limpia, destino);
    instalada = true;
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
  quitar(parcial);
  if (!instalada) quitar(limpia);
}
