// Versiones de la política de apuestas (libro mayor, append-only): cada edición es una fila
// nueva; nada se reescribe ni se borra. Las apuestas y las señales referencian la suya.
export const POLICY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS policy_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    parent_id   INTEGER,
    config      TEXT NOT NULL,      -- JSON con la política entera
    hash        TEXT NOT NULL,      -- sha-256 del JSON canónico
    nota        TEXT,
    origen      TEXT NOT NULL       -- seed | api | cli
  );
  CREATE TRIGGER IF NOT EXISTS policy_versions_no_update
    BEFORE UPDATE ON policy_versions
    BEGIN SELECT RAISE(ABORT, 'policy_versions: una versión de la política no se reescribe'); END;
  CREATE TRIGGER IF NOT EXISTS policy_versions_no_delete
    BEFORE DELETE ON policy_versions
    BEGIN SELECT RAISE(ABORT, 'policy_versions: una versión de la política no se borra'); END;
`;
