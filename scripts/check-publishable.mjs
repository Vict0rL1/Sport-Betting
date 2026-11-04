// ¿Se puede publicar esta base sin filtrar nada de nadie?
//
// CLI: `npm run check-publishable [-- <fichero>]`  (corre con tsx: importa la lista de tablas del
// libro mayor del servidor, server/src/db/tables.ts, en vez de llevar una copia a mano; lote B, B5)
//
// ===========================================================================
// POR QUÉ ESTO EXISTE
// ===========================================================================
// El workflow de datos sube la base a una release de un repositorio PÚBLICO. Para datos
// deportivos está bien —son públicos de origen— y para el registro de apuestas de
// alguien estaría muy mal.
//
// En un runner limpio no hay apuestas, porque las apuestas solo las crea la persona en
// su máquina. Pero «no debería haber» no es una garantía. Bastaría un cambio futuro que
// restaurara una caché o copiara una base local al runner para publicar el historial de
// apuestas de alguien, y el fallo sería completamente silencioso: un fichero de 9 MB
// que se sube igual de bien con o sin esas filas dentro.
//
// Así que se comprueba antes de subir y se falla si hay algo. Una comprobación que corre
// siempre y no cuesta nada, contra un fallo que no se puede deshacer — una vez publicado,
// está publicado.
//
// ===========================================================================
// LO QUE NO HACE
// ===========================================================================
// No borra nada. Si encuentra datos personales, PARA y lo dice; no los limpia y sigue.
// Limpiar automáticamente convertiría «hay algo raro en esta base» en un aviso que nadie
// lee, y la pregunta de por qué había apuestas en el runner merece una respuesta.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAVES_LEDGER, PREFIJOS_LEDGER, TABLAS_LEDGER, claveEsLedger } from '../server/src/db/tables.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Desde la Fase 2 la base publicable es history.db (o la exportación limpia que produce
// `npm run db:export-history`). El libro mayor (ledger.db) NUNCA se publica.
const DB_PATH = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(HERE, '..', 'data', 'history.db');

/**
 * Lo que no debe salir, y el motivo de cada cosa — que NO es el mismo.
 *
 * `bets` es privacidad de verdad: importes, beneficios y en qué acertó alguien con su
 * dinero. Publicarlo en un repositorio público es el fallo que este script existe para
 * impedir.
 *
 * Los `*_prediction_log` son otra cosa: el track record de la app. Publicarlos no
 * filtraría nada delicado —«el modelo dijo 62 % y acertó»— pero solo se escriben cuando
 * las rutas HTTP sirven una predicción, así que si están llenos en un runner es que esta
 * base NO es una construcción limpia. Bloquean por integridad, no por privacidad, y
 * decirlo con precisión importa: quien lea el error tiene que saber qué está mirando.
 */
const FORBIDDEN = [
  {
    table: 'bets',
    why: 'privacidad',
    message:
      'es el registro de apuestas de una persona (importes y beneficios). Esta base NO ' +
      'puede publicarse en un repositorio público.',
  },
  ...['prediction_log', 'fb_prediction_log', 'bb_prediction_log', 'bsb_prediction_log', 'naf_prediction_log', 'nhl_prediction_log', 'ufc_prediction_log'].map(
    (table) => ({
      table,
      why: 'integridad',
      message:
        'es el track record de la app y solo se escribe al servir predicciones por HTTP. ' +
        'Que tenga filas significa que esta base no es una construcción limpia: alguien ' +
        'arrancó la app sobre ella.',
    }),
  ),
];

/**
 * Tablas que TIENEN que traer datos. Una base «limpia» y una base vacía se publican
 * igual de bien, y la segunda rompe la app de quien la descargue.
 */
const REQUIRED = [
  { table: 'matches', min: 10_000 },
  { table: 'fb_matches', min: 10_000 },
  { table: 'naf_games', min: 5_000 },
  { table: 'player_ratings', min: 500 },
  { table: 'fb_team_ratings', min: 100 },
];

if (!fs.existsSync(DB_PATH)) {
  console.error(`✗ No hay base en ${DB_PATH}. Nada que publicar.`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const tables = new Set(
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).map((r) => r.name),
);
const count = (t) =>
  tables.has(t) ? db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n : null;

const problems = [];

console.log('¿Se puede publicar esta base?\n');

// ---- Nada personal ----
console.log('Lo que NO debe salir:');
for (const { table, why, message } of FORBIDDEN) {
  const n = count(table);
  if (n == null) {
    console.log(`  · ${table.padEnd(22)} la tabla no existe`);
    continue;
  }
  console.log(`  ${n === 0 ? '✓' : '✗'} ${table.padEnd(22)} ${String(n).padStart(6)} filas  (${why})`);
  if (n > 0) problems.push(`[${why}] ${table} tiene ${n} fila(s): ${message}`);
}

// ---- Y datos de sobra ----
console.log('\nTablas del libro mayor (no deben existir en una base de historia):');
for (const t of TABLAS_LEDGER) {
  if (!tables.has(t)) continue;
  const n = count(t);
  console.log(`  ✗ ${t.padEnd(22)} presente (${n} filas)`);
  if (!FORBIDDEN.some((f) => f.table === t)) problems.push(`[libro mayor] ${t} está en la base de historia: esta base no se ha partido (npm run db:migrate) o no es history.db.`);
}
// ---- Ni estado del dueño en la meta ----
// Auditoría paralela del 3 de noviembre: la migración 27 deja en `main.meta` de la base original una
// copia de `ajustes.usuario` (el banco personal) y `features.anulaciones` para recuperarlas, y antes
// esto solo miraba tablas. Cualquier clave que el servidor clasifica como estado del libro mayor
// (nombres y prefijos de server/src/db/tables.ts) es privada: no se publica. Se dice la clave, nunca
// su valor.
console.log('\nClaves de meta del libro mayor (no deben estar en una base publicable):');
if (tables.has('meta')) {
  const privadas = db.prepare('SELECT key FROM meta ORDER BY key').all().map((r) => r.key).filter(claveEsLedger);
  if (privadas.length === 0) console.log('  ✓ ninguna');
  for (const k of privadas) {
    console.log(`  ✗ ${k}`);
    problems.push(`[privacidad] meta tiene la clave «${k}», estado del dueño (libro mayor). Publica la exportación de npm run db:export-history, que la deja fuera.`);
  }
} else console.log('  · la tabla meta no existe');
// Y en los bytes del fichero, que es lo que se publica (revisión data-guardian del 3 de noviembre): una
// fila borrada sin `secure_delete` ni VACUUM sigue dentro, aunque la meta viva ya no la tenga. Ninguna
// de estas cadenas está en el esquema de la historia; si aparece, se para.
const vivas = new Set(tables.has('meta') ? db.prepare('SELECT key FROM meta').all().map((r) => r.key) : []);
const bytes = fs.readFileSync(DB_PATH);
const restos = [...CLAVES_LEDGER, ...PREFIJOS_LEDGER].filter((s) => bytes.includes(Buffer.from(s)) && ![...vivas].some((k) => k === s || (s.endsWith(':') && k.startsWith(s))));
for (const s of restos) {
  console.log(`  ✗ restos de «${s}» en los bytes del fichero`);
  problems.push(`[privacidad] el fichero contiene restos de «${s}» fuera de la meta viva (filas borradas sin VACUUM, u otra tabla). Publica la exportación de npm run db:export-history.`);
}

// Lo que se publica es el fichero (gzip), no lo que ve una conexión: con un -wal con cambios, lo
// comprobado por SQL (fichero + WAL) no es lo publicado (revisión data-guardian del 3 de noviembre).
const wal = `${DB_PATH}-wal`;
if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
  console.log(`  ✗ ${path.basename(wal)} con cambios sin pasar al fichero`);
  problems.push(`[integridad] hay un ${path.basename(wal)} con cambios sin pasar al fichero: lo que se publica no es lo que se ha comprobado. Publica la exportación de npm run db:export-history.`);
}

console.log('\nDatos que SÍ tiene que traer:');
for (const { table, min } of REQUIRED) {
  const n = count(table);
  const ok = n != null && n >= min;
  console.log(`  ${ok ? '✓' : '✗'} ${table.padEnd(22)} ${n ?? 'no existe'} (mínimo ${min})`);
  if (!ok) {
    problems.push(
      `${table} tiene ${n ?? 'la tabla ausente'} y debería tener al menos ${min}. ` +
        'Publicar una base a medias es peor que no publicar: quien la descargue no ' +
        'tiene forma de saber que le falta la mitad.',
    );
  }
}

console.log();
if (problems.length === 0) {
  const mb = (fs.statSync(DB_PATH).size / 1048576).toFixed(0);
  console.log(`✅ Publicable. ${mb} MB sin comprimir.`);
  process.exit(0);
}
console.log(`❌ NO publicable — ${problems.length} problema(s):\n`);
for (const p of problems) console.log(`  × ${p}`);
process.exitCode = 1;
