// La NHL en sombra (Fase 8.1): partidos jugados, de la API web de la NHL. Historia: se vuelve a bajar.
export const NHL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS nhl_games (
    id           INTEGER PRIMARY KEY,   -- el id de partido de la NHL
    season       INTEGER NOT NULL,      -- año de inicio: 2023 para la 2023-24
    game_type    INTEGER NOT NULL,      -- 2 temporada regular, 3 playoffs
    game_date    TEXT NOT NULL,         -- YYYY-MM-DD
    home_id      TEXT NOT NULL,         -- abreviatura (TOR, BOS…)
    away_id      TEXT NOT NULL,
    home_name    TEXT,
    away_name    TEXT,
    home_goals   INTEGER NOT NULL,
    away_goals   INTEGER NOT NULL,
    final_period TEXT NOT NULL CHECK (final_period IN ('REG', 'OT', 'SO')),
    ingested_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nhl_fecha ON nhl_games (game_date);
`;
