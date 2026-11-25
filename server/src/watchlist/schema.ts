// Seguimiento (Fase 5.14): equipos, jugadores y partidos que la persona sigue. Libro mayor:
// es estado de la persona, no procedencia de datos, y una reingesta no debe borrarlo.
export const WATCHLIST_SCHEMA = `
  CREATE TABLE IF NOT EXISTS watchlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL CHECK (kind IN ('equipo', 'jugador', 'partido')),
    sport      TEXT NOT NULL,
    league     TEXT,
    ref_id     TEXT NOT NULL,     -- id del equipo/jugador o match_key del partido
    label      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (kind, sport, ref_id)
  );

  -- Rediseño de noviembre (FAV-3): estimaciones concretas que la persona guarda para mirarlas
  -- después. Es una REFERENCIA a una fila de prediction_snapshots (que no se toca nunca); quitarla
  -- solo borra la referencia. Libro mayor, como el seguimiento.
  CREATE TABLE IF NOT EXISTS saved_predictions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sport       TEXT NOT NULL,
    match_key   TEXT NOT NULL,
    snapshot_id INTEGER NOT NULL,
    label       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    note        TEXT,
    note_updated_at TEXT,
    UNIQUE (sport, snapshot_id)
  );
`;
