// `npm run db:export-history [-- <destino>]` — una copia limpia y consistente de history.db,
// para publicarla (el workflow nocturno) o moverla. Con WAL, el fichero vivo puede tener
// páginas en `history.db-wal`; `VACUUM INTO` produce un solo fichero con todo dentro y
// comprobado. Nunca toca el libro mayor.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb } from '../db.ts';
import { ficherosDe } from '../db/layout.ts';
import { TABLAS_LEDGER } from '../db/tables.ts';

const destino = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : path.join(path.dirname(ficherosDe().history), 'history.export.db');
const db = getDb();
fs.rmSync(destino, { force: true });
db.exec(`VACUUM main INTO '${destino.replace(/'/g, "''")}'`);
const copia = new DatabaseSync(destino);
const integridad = (copia.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
const tablas = (copia.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
copia.close();
const coladas = tablas.filter((t) => TABLAS_LEDGER.includes(t));
if (integridad !== 'ok' || coladas.length) {
  fs.rmSync(destino, { force: true });
  console.error(`✗ Exportación descartada: integridad «${integridad}»${coladas.length ? `, tablas del libro mayor dentro: ${coladas.join(', ')}` : ''}`);
  process.exit(1);
}
console.log(`✓ ${destino} (${(fs.statSync(destino).size / 1048576).toFixed(0)} MB, ${tablas.length} tablas, integridad ok, sin tablas del libro mayor)`);
