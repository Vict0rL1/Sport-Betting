// La tabla de alertas internas. Sin imports: lo ejecuta db.ts al abrir.

export const ALERTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    type        TEXT NOT NULL,
    severity    TEXT NOT NULL CHECK (severity IN ('info', 'aviso', 'importante')),
    sport       TEXT,
    match_key   TEXT,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    data        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_key ON alerts (sport, match_key, type, created_at);
  CREATE TRIGGER IF NOT EXISTS alerts_no_update
    BEFORE UPDATE ON alerts
    BEGIN SELECT RAISE(ABORT, 'alerts: una alerta no se reescribe'); END;
  CREATE TRIGGER IF NOT EXISTS alerts_no_delete
    BEFORE DELETE ON alerts
    BEGIN SELECT RAISE(ABORT, 'alerts: una alerta no se borra'); END;
`;
