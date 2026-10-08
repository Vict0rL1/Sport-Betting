// Migraciones numeradas, con registro en cada fichero.
//
// Antes el esquema era `CREATE TABLE IF NOT EXISTS` para todo más un mapa de «columnas que
// faltan» → `ALTER TABLE ADD COLUMN`. Funcionaba y sigue aquí, como migración 1: lo que cambia
// es que ahora cada paso tiene número, nombre y una fila en `schema_version` con cuándo se
// aplicó, y que un paso que falla deja constancia y el servidor NO arranca hasta que alguien
// lo mire. Una migración a medias que pasa desapercibida es una base que miente en silencio.
//
// Cada fichero (historia, libro mayor) lleva su propia tabla `schema_version`: una base de
// historia recién descargada puede ir por detrás del libro mayor, y se pone al día sola.

import type { DatabaseSync } from 'node:sqlite';

export interface Migracion {
  version: number;
  nombre: string;
  /** En qué fichero se aplica. `ambos` corre una vez por fichero. */
  destino: 'history' | 'ledger' | 'ambos';
  up: (db: DatabaseSync, ctx: ContextoMigracion) => void;
}

export interface ContextoMigracion {
  /** `ledger` o `main`: cómo se llama el esquema del libro mayor en esta conexión. */
  ledger: string;
  /** Qué fichero se está migrando ahora. */
  fichero: 'history' | 'ledger';
}

export interface EstadoVersion {
  version: number;
  nombre: string;
  applied_at: string;
  estado: 'ok' | 'failed';
  error: string | null;
}

function tablaVersion(schema: string): string {
  return `${schema}.schema_version`;
}

export function ensureVersionTable(db: DatabaseSync, schema: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tablaVersion(schema)} (
      version     INTEGER NOT NULL,
      nombre      TEXT NOT NULL,
      applied_at  TEXT NOT NULL,
      estado      TEXT NOT NULL CHECK (estado IN ('ok', 'failed')),
      error       TEXT
    );
  `);
}

export function versionesAplicadas(db: DatabaseSync, schema: string): EstadoVersion[] {
  ensureVersionTable(db, schema);
  return db.prepare(`SELECT version, nombre, applied_at, estado, error FROM ${tablaVersion(schema)} ORDER BY version, applied_at`).all() as unknown as EstadoVersion[];
}

/** La última fila de cada versión: `ok` si se aplicó, `failed` si el último intento falló. */
export function estadoPorVersion(db: DatabaseSync, schema: string): Map<number, EstadoVersion> {
  const m = new Map<number, EstadoVersion>();
  for (const v of versionesAplicadas(db, schema)) m.set(v.version, v);
  return m;
}

export class MigracionFallida extends Error {
  readonly version: number;
  readonly nombre: string;
  readonly fichero: string;
  constructor(version: number, nombre: string, fichero: string, causa: string) {
    super(
      `La migración ${version} («${nombre}») falló en ${fichero}: ${causa}\n\n` +
        'El servidor no arranca con una base a medias. Mira el error, arregla la causa y vuelve a\n' +
        'intentarlo con  npm run db:migrate -- --reintentar  (o restaura la última copia de seguridad).',
    );
    this.version = version;
    this.nombre = nombre;
    this.fichero = fichero;
  }
}

/**
 * Aplica las migraciones pendientes de un fichero, cada una en su transacción.
 *
 * Una versión con el último intento en `failed` BLOQUEA: no se sigue ni se reintenta sola.
 * Con `reintentar` se vuelve a probar esa misma versión.
 */
export function migrar(db: DatabaseSync, schema: string, fichero: 'history' | 'ledger', migraciones: Migracion[], ctx: ContextoMigracion, opts: { reintentar?: boolean; ahora?: () => Date } = {}): number[] {
  ensureVersionTable(db, schema);
  const estado = estadoPorVersion(db, schema);
  const aplicadas: number[] = [];
  const pendientes = migraciones.filter((m) => m.destino === 'ambos' || m.destino === fichero).sort((a, b) => a.version - b.version);
  for (const m of pendientes) {
    const previo = estado.get(m.version);
    if (previo?.estado === 'ok') continue;
    if (previo?.estado === 'failed' && !opts.reintentar) throw new MigracionFallida(m.version, m.nombre, fichero, previo.error ?? 'error anterior');
    const t = (opts.ahora ?? (() => new Date()))().toISOString();
    db.exec('BEGIN');
    try {
      m.up(db, ctx);
      db.prepare(`INSERT INTO ${tablaVersion(schema)} (version, nombre, applied_at, estado, error) VALUES (?, ?, ?, 'ok', NULL)`).run(m.version, m.nombre, t);
      db.exec('COMMIT');
      aplicadas.push(m.version);
    } catch (e) {
      db.exec('ROLLBACK');
      // Fuera de la transacción, para que quede constancia aunque todo lo demás se deshaga.
      db.prepare(`INSERT INTO ${tablaVersion(schema)} (version, nombre, applied_at, estado, error) VALUES (?, ?, ?, 'failed', ?)`).run(m.version, m.nombre, t, (e as Error).message.slice(0, 1000));
      throw new MigracionFallida(m.version, m.nombre, fichero, (e as Error).message);
    }
  }
  return aplicadas;
}
