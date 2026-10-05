// Las predicciones antes del partido, en el tiempo, y la final congelada.
//
// ===========================================================================
// DOS TABLAS, Y LO QUE CADA UNA NO PUEDE HACER
// ===========================================================================
//   prediction_snapshots   cada vez que la predicción de un partido CAMBIA (o cruza una
//                          marca T-24h / T-6h / T-1h), una fila nueva. Nunca se reescribe
//                          una vieja ni se borra. La base rechaza:
//                            · una instantánea tomada a la hora del inicio o después;
//                            · una instantánea que diga usar cuotas o datos POSTERIORES a
//                              su propia hora de captura.
//                          Con eso, «la predicción de T-24h» (la última capturada antes de
//                          esa marca) no puede contener nada que se supiera a T-1h.
//
//   prematch_final         una fila por partido, escrita cuando el partido ya empezó: la
//                          última instantánea anterior al inicio (o, si el servidor no
//                          tomó ninguna, la del registro de predicciones). Clave primaria
//                          por partido, sin UPDATE ni DELETE: la final pre-partido no cambia
//                          aunque el modelo se vuelva a ejecutar mil veces.
//
// Las predicciones en vivo, si algún día las hay, irían a otra tabla con otra categoría;
// nunca pueden sobrescribir esta.

export const PREMATCH_SCHEMA = `
  CREATE TABLE IF NOT EXISTS prediction_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sport           TEXT NOT NULL,
    match_key       TEXT NOT NULL,
    event_id        TEXT,
    commence_time   TEXT NOT NULL,
    captured_at     TEXT NOT NULL,
    outcomes        TEXT NOT NULL,
    probs           TEXT NOT NULL,
    probs_raw       TEXT,
    market_probs    TEXT,
    odds            TEXT,
    odds_at         TEXT,
    data_as_of      TEXT,
    inputs          TEXT NOT NULL,
    model_version   TEXT,
    calibration_version TEXT,
    data_version    TEXT,
    git_commit      TEXT,
    CHECK (captured_at < commence_time),
    CHECK (odds_at IS NULL OR odds_at <= captured_at),
    CHECK (data_as_of IS NULL OR data_as_of <= captured_at)
  );
  CREATE INDEX IF NOT EXISTS idx_psnap_event ON prediction_snapshots (sport, match_key, captured_at);

  CREATE TRIGGER IF NOT EXISTS prediction_snapshots_no_update
    BEFORE UPDATE ON prediction_snapshots
    BEGIN SELECT RAISE(ABORT, 'prediction_snapshots: una instantánea no se reescribe'); END;
  CREATE TRIGGER IF NOT EXISTS prediction_snapshots_no_delete
    BEFORE DELETE ON prediction_snapshots
    BEGIN SELECT RAISE(ABORT, 'prediction_snapshots: una instantánea no se borra'); END;

  CREATE TABLE IF NOT EXISTS prematch_final (
    sport           TEXT NOT NULL,
    match_key       TEXT NOT NULL,
    commence_time   TEXT NOT NULL,
    frozen_at       TEXT NOT NULL,
    source          TEXT NOT NULL CHECK (source IN ('snapshot', 'prediction_log')),
    snapshot_id     INTEGER,
    captured_at     TEXT NOT NULL,
    outcomes        TEXT NOT NULL,
    probs           TEXT NOT NULL,
    market_probs    TEXT,
    model_version   TEXT,
    PRIMARY KEY (sport, match_key),
    CHECK (captured_at < commence_time),
    CHECK (frozen_at >= commence_time)
  );
  CREATE TRIGGER IF NOT EXISTS prematch_final_no_update
    BEFORE UPDATE ON prematch_final
    BEGIN SELECT RAISE(ABORT, 'prematch_final: la predicción final pre-partido está congelada'); END;
  CREATE TRIGGER IF NOT EXISTS prematch_final_no_delete
    BEFORE DELETE ON prematch_final
    BEGIN SELECT RAISE(ABORT, 'prematch_final: la predicción final pre-partido no se borra'); END;
`;
