// Serie diaria de monitorización por deporte (historia: se reconstruye entera a partir de
// las predicciones puntuadas, así que no es inmutable ni va al libro mayor).
export const MONITORING_SCHEMA = `
  CREATE TABLE IF NOT EXISTS monitoring_series (
    day         TEXT NOT NULL,   -- YYYY-MM-DD: el último día de la ventana
    sport       TEXT NOT NULL,
    metric      TEXT NOT NULL,   -- logloss_4s | brier_4s | n_4s | psi
    value       REAL,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (day, sport, metric)
  );
`;
