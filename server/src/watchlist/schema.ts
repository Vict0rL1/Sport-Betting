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
`;
