// Reescribe un esquema SQL para que las tablas del libro mayor se creen en la base adjunta.
//
// Con `ATTACH ledger.db AS ledger`, un `CREATE TABLE x` sin prefijo cae en `main` (la
// historia). Para que `paper_bets` o `odds_snapshots` nazcan en el libro mayor hay que
// escribir `CREATE TABLE ledger.paper_bets`, y —medido con node:sqlite— sus índices y
// triggers también exigen el prefijo en SU nombre (`CREATE INDEX ledger.idx ON paper_bets`,
// `CREATE TRIGGER ledger.t … ON paper_bets`); sin él SQLite busca la tabla en `main` y falla.
//
// Hacerlo aquí, sobre el texto, deja los ocho ficheros de esquema tal cual y pone la regla en
// un solo sitio con su test. En disposición `single` es la identidad.

import { esLedger } from './tables.ts';

const TABLA = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?!ledger\.)([A-Za-z_][A-Za-z0-9_]*)/g;
const INDICE = /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(?!ledger\.)([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)/g;
// El nombre del trigger y, más adelante en la misma sentencia, `ON tabla`.
const TRIGGER = /CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+(?!ledger\.)([A-Za-z_][A-Za-z0-9_]*)([\s\S]*?\bON\s+)([A-Za-z_][A-Za-z0-9_]*)/g;

export function ledgerize(sql: string, schema: string): string {
  if (schema === 'main') return sql;
  const pref = `${schema}.`;
  return sql
    .replace(TABLA, (m, tabla: string) => (esLedger(tabla) ? m.replace(tabla, pref + tabla) : m))
    .replace(INDICE, (m, unique: string | undefined, idx: string, tabla: string) =>
      esLedger(tabla) ? `CREATE ${unique ?? ''}INDEX IF NOT EXISTS ${pref}${idx} ON ${tabla}` : m,
    )
    .replace(TRIGGER, (m, trg: string, medio: string, tabla: string) => (esLedger(tabla) ? `CREATE TRIGGER IF NOT EXISTS ${pref}${trg}${medio}${tabla}` : m));
}

/** `sqlite_master` del esquema donde vive una tabla. */
export function masterDe(tabla: string, schema: string): string {
  return schema !== 'main' && esLedger(tabla) ? `${schema}.sqlite_master` : 'sqlite_master';
}
