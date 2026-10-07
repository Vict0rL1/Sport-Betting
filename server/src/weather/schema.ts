// Observaciones de clima (libro mayor): lo que Open-Meteo dijo de cada partido a T-24h, T-6h y
// T-1h, y lo que midió después. Inmutables, como todo lo que es «lo que se sabía entonces».
export const WEATHER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS weather_observations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sport         TEXT NOT NULL,                 -- nfl | baseball
    match_key     TEXT NOT NULL,                 -- id de la fila de próximos partidos
    stadium_id    TEXT NOT NULL,                 -- id del equipo local en config/stadiums.json
    kind          TEXT NOT NULL CHECK (kind IN ('prevision', 'observado')),
    horizon       TEXT NOT NULL,                 -- T-24h | T-6h | T-1h | final
    target_time   TEXT NOT NULL,                 -- la hora del partido (UTC)
    fetched_at    TEXT NOT NULL,
    temp_c        REAL,
    wind_mph      REAL,
    precip_mm     REAL,
    precip_prob   REAL,                          -- solo en previsión
    weather_code  INTEGER,                       -- código WMO
    source        TEXT NOT NULL DEFAULT 'open-meteo',
    UNIQUE (sport, match_key, kind, horizon)
  );
  CREATE INDEX IF NOT EXISTS idx_weather_match ON weather_observations (sport, match_key, fetched_at);
  CREATE TRIGGER IF NOT EXISTS weather_no_update
    BEFORE UPDATE ON weather_observations
    BEGIN SELECT RAISE(ABORT, 'weather_observations es inmutable: no se actualiza'); END;
  CREATE TRIGGER IF NOT EXISTS weather_no_delete
    BEFORE DELETE ON weather_observations
    BEGIN SELECT RAISE(ABORT, 'weather_observations es inmutable: no se borra'); END;
`;
