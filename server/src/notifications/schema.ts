// Notificaciones (libro mayor): cada intento de envío queda registrado, y las suscripciones
// Web Push del navegador.
export const NOTIFICATIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS notification_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT NOT NULL,
    channel     TEXT NOT NULL,       -- webpush | telegram | email | webhook
    event_type  TEXT NOT NULL,
    title       TEXT NOT NULL,
    ok          INTEGER NOT NULL,
    error       TEXT,
    duration_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_notif_log_at ON notification_log (created_at);
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint    TEXT PRIMARY KEY,
    keys_json   TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    last_ok_at  TEXT,
    failures    INTEGER NOT NULL DEFAULT 0
  );
`;
