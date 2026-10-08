// El estado de cada trabajo programado (libro mayor): cadencia, última ejecución, si está
// habilitado. Lo escribe el registro (registry.ts); la definición del trabajo vive en código.
export const SCHEDULER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS scheduler_jobs (
    name             TEXT PRIMARY KEY,
    cadence_minutes  REAL NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 1,
    last_run_at      TEXT,
    last_duration_ms INTEGER,
    last_status      TEXT,
    last_error       TEXT,
    next_run_at      TEXT,
    runs_ok          INTEGER NOT NULL DEFAULT 0,
    runs_error       INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL
  );
`;
