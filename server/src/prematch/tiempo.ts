// «Antes del partido», con fechas parseadas, en un solo sitio (auditoría del 17 de octubre, punto 2).
//
// Los registros de predicciones prometían «escrito ANTES del partido» y nada lo hacía cumplir:
//   · Los próximos de hoy se quedan en la lista hasta medianoche aunque ya hayan empezado
//     (freshness.ts, a propósito: es cuando más se miran). El ciclo pre-partido predice toda la
//     lista, y un partido que no se había registrado antes del inicio (el servidor dormido, o el
//     proveedor lo añadió tarde) se registraba con `predicted_at` de ahora, después del inicio, y
//     se evaluaba como si fuera pre-partido.
//   · Las comprobaciones de orden comparaban TEXTO. Dos horas con distinto formato no se ordenan
//     como instantes: '2026-10-12T23:00:30.000Z' < '2026-10-12T23:00Z' como texto (':' < 'Z'),
//     aunque sea 30 s después; y con un desfase horario ('…-04:00') el error es de horas.
//
// Aquí: `empezado` (JS) y `prepartidoSql` (SQL, con julianday, que entiende 'Z', desfases y
// fracciones de segundo) deciden lo mismo, y los triggers de abajo lo hacen cumplir en la base para
// todo el que escriba, no solo para quien se acuerde.
//
// Una fila tardía no se borra ni se reescribe (el registro es inmutable): se queda, con su
// procedencia, y la evaluación pre-partido no la cuenta.

/** ¿Ya empezó? null si la hora no se sabe o no se entiende: no se supone ni una cosa ni otra. */
export function empezado(commence: string | null | undefined, ahora: Date = new Date()): boolean | null {
  if (!commence) return null;
  const t = Date.parse(commence);
  return Number.isFinite(t) ? t <= ahora.getTime() : null;
}

export type ClasePrepartido = 'prepartido' | 'tardia' | 'sin_hora';

/** Cómo es una fila del registro: anterior al inicio, posterior, o sin hora que comparar. */
export function clasePrepartido(predichoEn: string | null | undefined, commence: string | null | undefined): ClasePrepartido {
  const p = predichoEn ? Date.parse(predichoEn) : NaN;
  const c = commence ? Date.parse(commence) : NaN;
  if (!Number.isFinite(p) || !Number.isFinite(c)) return 'sin_hora';
  return p < c ? 'prepartido' : 'tardia';
}

/**
 * La condición SQL «esta fila se escribió antes del inicio», con instantes parseados. Una hora que
 * no se entiende da NULL y la fila NO cuenta como pre-partido: lo que no se puede comprobar no se da
 * por bueno.
 */
export function prepartidoSql(predichoEn = 'predicted_at', inicio = 'commence_time'): string {
  return `(julianday(${predichoEn}) < julianday(${inicio}))`;
}

/** Los registros de predicciones de cada deporte. */
export const REGISTROS = ['prediction_log', 'fb_prediction_log', 'bb_prediction_log', 'bsb_prediction_log', 'naf_prediction_log', 'nhl_prediction_log', 'ufc_prediction_log'] as const;

/**
 * Triggers que impiden escribir algo «pre-partido» que no lo es, comparando instantes. Se suman a
 * los CHECK de texto que ya había (que no se pueden cambiar sin rehacer la tabla). Una hora que no
 * se entiende no dispara nada: no se rechaza lo que no se puede juzgar, y la evaluación tampoco lo
 * cuenta (ver prepartidoSql).
 *
 * En los registros, IGNORE: la fila tardía no se guarda y quien escribe sigue (siete escritores, y
 * en varios un fallo aquí tumbaría servir la predicción). En instantáneas, finales y apuestas,
 * ABORT: quien escribe ya lo comprueba antes, y si llega aquí es un fallo que tiene que verse.
 */
export const TRIGGERS_PREPARTIDO =
  REGISTROS.map(
    (t) => `
  CREATE TRIGGER IF NOT EXISTS ${t}_prepartido
    BEFORE INSERT ON ${t}
    WHEN julianday(NEW.predicted_at) >= julianday(NEW.commence_time)
    BEGIN SELECT RAISE(IGNORE); END;`,
  ).join('') +
  `
  CREATE TRIGGER IF NOT EXISTS prediction_snapshots_prepartido
    BEFORE INSERT ON prediction_snapshots
    WHEN julianday(NEW.captured_at) >= julianday(NEW.commence_time)
      OR julianday(NEW.odds_at) > julianday(NEW.captured_at)
      OR julianday(NEW.data_as_of) > julianday(NEW.captured_at)
    BEGIN SELECT RAISE(ABORT, 'prediction_snapshots: captura en o después del inicio, o con cuotas o datos posteriores a la captura'); END;
  CREATE TRIGGER IF NOT EXISTS prematch_final_prepartido
    BEFORE INSERT ON prematch_final
    WHEN julianday(NEW.captured_at) >= julianday(NEW.commence_time)
      OR julianday(NEW.frozen_at) < julianday(NEW.commence_time)
    BEGIN SELECT RAISE(ABORT, 'prematch_final: la final pre-partido tiene que ser anterior al inicio y congelarse después'); END;
  CREATE TRIGGER IF NOT EXISTS paper_bets_alta_prepartido
    BEFORE INSERT ON paper_bets
    WHEN julianday(NEW.placed_at) >= julianday(NEW.commence_time)
    BEGIN SELECT RAISE(ABORT, 'paper_bets: alta inválida (apuesta en o después del inicio, comparando instantes)'); END;
  CREATE TRIGGER IF NOT EXISTS strategy_bets_alta_prepartido
    BEFORE INSERT ON strategy_bets
    WHEN julianday(NEW.placed_at) >= julianday(NEW.commence_time)
    BEGIN SELECT RAISE(ABORT, 'strategy_bets: alta inválida (apuesta en o después del inicio, comparando instantes)'); END;
`;
