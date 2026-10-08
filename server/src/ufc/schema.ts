// La UFC en sombra (seguimiento: NHL y UFC). Historia: se vuelve a bajar.
//
// Las peleas guardan a los dos luchadores en el orden de la fuente (A y B) y quién ganó. Ese orden NO
// es información para el modelo: medido en octubre de 2026, hasta ~2009 la fuente pone siempre primero
// al ganador y después, la esquina roja. El modelo es simétrico y no lo mira.
//
// `ambigua` = 1 cuando alguno de los dos nombres lo comparten varios luchadores (ufcstats solo da
// nombres en las peleas): esas peleas no se atribuyen a nadie ni se puntúan.
export const UFC_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ufc_events (
    id        TEXT PRIMARY KEY,          -- id de ufcstats (de la URL del evento)
    nombre    TEXT NOT NULL,
    fecha     TEXT NOT NULL,             -- YYYY-MM-DD
    lugar     TEXT
  );
  CREATE TABLE IF NOT EXISTS ufc_fighters (
    id          TEXT PRIMARY KEY,        -- id de ufcstats (de la URL del luchador)
    nombre      TEXT NOT NULL,
    apodo       TEXT,
    altura_cm   REAL,
    alcance_cm  REAL,
    guardia     TEXT,
    nacimiento  TEXT,                    -- YYYY-MM-DD o NULL
    ambiguo     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ufc_fights (
    id          TEXT PRIMARY KEY,        -- id de ufcstats (de la URL de la pelea)
    evento_id   TEXT NOT NULL,
    fecha       TEXT NOT NULL,
    orden       INTEGER NOT NULL,        -- posición en la cartelera de la fuente: 0 = la estelar (la última)
    luchador_a  TEXT,                    -- id del luchador, NULL si el nombre es ambiguo o desconocido
    luchador_b  TEXT,
    nombre_a    TEXT NOT NULL,
    nombre_b    TEXT NOT NULL,
    resultado   TEXT NOT NULL CHECK (resultado IN ('A', 'B', 'EMPATE', 'NC')),
    categoria   TEXT,
    metodo      TEXT,
    asalto      INTEGER,
    tiempo      TEXT,
    ambigua     INTEGER NOT NULL DEFAULT 0,
    ingested_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ufc_fecha ON ufc_fights (fecha, orden);
`;
