// Calendario restante y corridas de simulación (historia: se rehacen de las fuentes).
export const SIMULATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS remaining_fixtures (
    sport        TEXT NOT NULL,
    league       TEXT NOT NULL,
    season       INTEGER NOT NULL,
    fixture_date TEXT NOT NULL,   -- YYYYMMDD
    home_id      TEXT NOT NULL,
    away_id      TEXT NOT NULL,
    neutral      INTEGER NOT NULL DEFAULT 0,
    source       TEXT NOT NULL,   -- openfootball | nflverse | mlb-stats-api | …
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (sport, league, season, fixture_date, home_id, away_id)
  );
  CREATE INDEX IF NOT EXISTS idx_remaining_league ON remaining_fixtures (sport, league, season, fixture_date);

  CREATE TABLE IF NOT EXISTS simulation_runs (
    sport       TEXT NOT NULL,
    league      TEXT NOT NULL,
    day         TEXT NOT NULL,    -- YYYY-MM-DD
    computed_at TEXT NOT NULL,
    result      TEXT NOT NULL,    -- JSON
    PRIMARY KEY (sport, league, day)
  );
`;
