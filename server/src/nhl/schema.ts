// La NHL en sombra (Fase 8.1): partidos jugados. Historia: se vuelve a bajar.
//
// `final_period` es NULL cuando la fuente no dice cómo acabó (el calendario de sportsdataverse trae el
// marcador final pero no si hubo prórroga o tanda): se deja sin dato, no se supone «REG». `fuente`
// dice de dónde salió cada fila.
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
    final_period TEXT CHECK (final_period IS NULL OR final_period IN ('REG', 'OT', 'SO')),
    fuente       TEXT,
    ingested_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nhl_fecha ON nhl_games (game_date);
`;
