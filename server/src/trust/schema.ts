// El registro de evaluaciones de confianza. Sin imports: lo ejecuta db.ts al abrir.

export const ASSESSMENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS prediction_assessments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sport           TEXT NOT NULL,
    match_key       TEXT NOT NULL,
    event_id        TEXT,
    commence_time   TEXT NOT NULL,
    assessed_at     TEXT NOT NULL,
    probs           TEXT NOT NULL,
    decision        TEXT NOT NULL CHECK (decision IN ('BET', 'NO BET', 'SIN MERCADO')),
    selection       INTEGER,
    odds            REAL,
    edge            REAL,
    stake_factor    REAL,
    confidence      TEXT NOT NULL,
    data_quality    INTEGER NOT NULL,
    uncertainty_pp  REAL NOT NULL,
    stability       TEXT NOT NULL,
    stability_pp    REAL NOT NULL,
    disagreement    TEXT NOT NULL,
    disagreement_pp REAL NOT NULL,
    market_quality  TEXT NOT NULL,
    edge_vanish     REAL,
    ood             TEXT NOT NULL,
    regime          TEXT NOT NULL,
    reasons         TEXT NOT NULL,
    model_version   TEXT,
    CHECK (assessed_at < commence_time)
  );
  CREATE INDEX IF NOT EXISTS idx_assess_event ON prediction_assessments (sport, match_key, assessed_at);
  CREATE TRIGGER IF NOT EXISTS prediction_assessments_no_update
    BEFORE UPDATE ON prediction_assessments
    BEGIN SELECT RAISE(ABORT, 'prediction_assessments: una evaluación no se reescribe'); END;
  CREATE TRIGGER IF NOT EXISTS prediction_assessments_no_delete
    BEFORE DELETE ON prediction_assessments
    BEGIN SELECT RAISE(ABORT, 'prediction_assessments: una evaluación no se borra'); END;
`;
