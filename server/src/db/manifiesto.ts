// El manifiesto de una base: por tabla, cuántas filas tiene y una huella de su contenido
// (auditoría del 17 de octubre, punto 1).
//
// La huella no depende del orden de las filas: es la suma, módulo 2^256, del SHA-256 de cada fila.
// `VACUUM` puede renumerar los rowid implícitos y cambiar el orden en que salen, y una copia buena
// no puede parecer distinta por eso. Cada valor se serializa con su tipo (entero, real, texto,
// binario o NULL), así que 1 y '1' no se confunden. Los enteros se leen como BigInt: un entero de
// más de 53 bits no pierde precisión por el camino.

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export interface Manifiesto {
  formato: 1;
  tablas: Record<string, { filas: number; huella: string }>;
}

export interface DiferenciaTabla {
  tabla: string;
  /** Filas en el primer manifiesto (null: la tabla no está). */
  a: number | null;
  b: number | null;
  /** Mismo número de filas y distinta huella. */
  contenidoDistinto: boolean;
}

/** Las tablas de la base, sin las internas de SQLite. */
export function tablasDe(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

const MODULO = 1n << 256n;

function valor(v: unknown): string {
  if (v === null || v === undefined) return 'N';
  if (typeof v === 'bigint') return `i${v}`;
  if (typeof v === 'number') return `r${v}`;
  if (typeof v === 'string') return `t${v.length}:${v}`;
  if (v instanceof Uint8Array) return `b${Buffer.from(v).toString('hex')}`;
  return `?${String(v)}`;
}

export function manifiestoDe(db: DatabaseSync): Manifiesto {
  const tablas: Manifiesto['tablas'] = {};
  for (const t of tablasDe(db)) {
    const st = db.prepare(`SELECT * FROM "${t.replace(/"/g, '""')}"`);
    st.setReadBigInts(true);
    let suma = 0n;
    let filas = 0;
    for (const fila of st.iterate() as Iterable<Record<string, unknown>>) {
      const h = createHash('sha256').update(Object.values(fila).map(valor).join('\u0000')).digest('hex');
      suma = (suma + BigInt(`0x${h}`)) % MODULO;
      filas++;
    }
    tablas[t] = { filas, huella: suma.toString(16).padStart(64, '0') };
  }
  return { formato: 1, tablas };
}

export function manifiestoDeFichero(fichero: string): Manifiesto {
  const db = new DatabaseSync(fichero, { readOnly: true });
  try {
    return manifiestoDe(db);
  } finally {
    db.close();
  }
}

/** Las tablas en que dos manifiestos no coinciden (vacío: idénticos). */
export function compararManifiestos(a: Manifiesto, b: Manifiesto): DiferenciaTabla[] {
  const nombres = [...new Set([...Object.keys(a.tablas), ...Object.keys(b.tablas)])].sort();
  const out: DiferenciaTabla[] = [];
  for (const t of nombres) {
    const x = a.tablas[t];
    const y = b.tablas[t];
    if (x && y && x.filas === y.filas && x.huella === y.huella) continue;
    out.push({ tabla: t, a: x?.filas ?? null, b: y?.filas ?? null, contenidoDistinto: !!x && !!y && x.filas === y.filas });
  }
  return out;
}
