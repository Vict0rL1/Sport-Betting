// Las predicciones de los modelos en sombra. Sin imports: lo ejecuta db.ts al abrir.

export const SHADOW_SCHEMA = `
  CREATE TABLE IF NOT EXISTS shadow_predictions (
    sport            TEXT NOT NULL,
    match_key        TEXT NOT NULL,
    shadow_id        TEXT NOT NULL,
    shadow_name      TEXT NOT NULL,
    commence_time    TEXT NOT NULL,
    predicted_at     TEXT NOT NULL,
    probs            TEXT NOT NULL,
    champion_probs   TEXT NOT NULL,
    odds             TEXT,
    provider_event_id TEXT,
    provider_selections TEXT,
    champion_version TEXT,
    PRIMARY KEY (sport, match_key, shadow_id),
    CHECK (predicted_at < commence_time)
  );
  CREATE TRIGGER IF NOT EXISTS shadow_predictions_no_update
    BEFORE UPDATE ON shadow_predictions
    BEGIN SELECT RAISE(ABORT, 'shadow_predictions: la predicción de una sombra no se reescribe'); END;
  CREATE TRIGGER IF NOT EXISTS shadow_predictions_no_delete
    BEFORE DELETE ON shadow_predictions
    BEGIN SELECT RAISE(ABORT, 'shadow_predictions: la predicción de una sombra no se borra'); END;
`;
