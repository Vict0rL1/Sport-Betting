// Los informes (Fase 6.7–6.9): el resumen diario y el informe semanal, archivados. Libro mayor,
// append-only: un informe dice lo que se sabía el día que se escribió, y reescribirlo después con
// lo que se sabe hoy sería cambiar el pasado. Uno por tipo y periodo.
export const REPORTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo        TEXT NOT NULL CHECK (tipo IN ('diario', 'semanal')),
    periodo     TEXT NOT NULL,      -- YYYY-MM-DD (diario) o YYYY-Www (semanal, ISO)
    created_at  TEXT NOT NULL,
    titulo      TEXT NOT NULL,
    resumen     TEXT NOT NULL,      -- una línea: la lista y la notificación
    markdown    TEXT NOT NULL,
    datos       TEXT NOT NULL,      -- JSON con las cifras
    UNIQUE (tipo, periodo)
  );
  CREATE TRIGGER IF NOT EXISTS reports_no_update
    BEFORE UPDATE ON reports
    BEGIN SELECT RAISE(ABORT, 'reports: un informe archivado no se reescribe'); END;
  CREATE TRIGGER IF NOT EXISTS reports_no_delete
    BEFORE DELETE ON reports
    BEGIN SELECT RAISE(ABORT, 'reports: un informe archivado no se borra'); END;
`;
