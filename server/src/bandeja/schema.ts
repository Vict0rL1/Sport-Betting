// La bandeja (Fase 6.4): cada notificación y cada alerta, también dentro de la app, con su
// estado de leída. Libro mayor. Sin imports: lo ejecuta db.ts al migrar.
//
// Lo único que cambia de una fila es si se ha leído. El resto —qué pasó, cuándo y a dónde
// lleva— queda como se escribió, y nada se borra: la bandeja es también el registro de lo que
// la app avisó.
export const INBOX_SCHEMA = `
  CREATE TABLE IF NOT EXISTS inbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    origen      TEXT NOT NULL CHECK (origen IN ('notificacion', 'alerta')),
    tipo        TEXT NOT NULL,      -- el evento de la notificación o el tipo de alerta
    severidad   TEXT NOT NULL DEFAULT 'info' CHECK (severidad IN ('info', 'aviso', 'importante')),
    sport       TEXT,
    match_key   TEXT,
    titulo      TEXT NOT NULL,
    cuerpo      TEXT NOT NULL,
    url         TEXT,
    alert_id    INTEGER,
    leida_at    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_inbox_leida ON inbox (leida_at, id);
  CREATE TRIGGER IF NOT EXISTS inbox_no_delete
    BEFORE DELETE ON inbox
    BEGIN SELECT RAISE(ABORT, 'inbox: la bandeja no se borra; se marca como leída'); END;
  CREATE TRIGGER IF NOT EXISTS inbox_solo_leida
    BEFORE UPDATE ON inbox
    WHEN OLD.created_at IS NOT NEW.created_at OR OLD.origen IS NOT NEW.origen OR OLD.tipo IS NOT NEW.tipo
      OR OLD.severidad IS NOT NEW.severidad OR OLD.sport IS NOT NEW.sport OR OLD.match_key IS NOT NEW.match_key
      OR OLD.titulo IS NOT NEW.titulo OR OLD.cuerpo IS NOT NEW.cuerpo OR OLD.url IS NOT NEW.url OR OLD.alert_id IS NOT NEW.alert_id
    BEGIN SELECT RAISE(ABORT, 'inbox: de un aviso solo cambia si se ha leído'); END;
`;
