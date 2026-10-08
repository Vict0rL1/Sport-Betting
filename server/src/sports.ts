// Los deportes publicados, UNA vez (seis desde que la NHL pasó su prueba). Antes la lista vivía copiada en la evaluación, la
// validación, el versionado y la ficha de backtests; añadir un deporte obligaba a
// encontrar todas las copias, y la que se olvidara lo dejaba fuera sin avisar.

export const SPORT_IDS = ['tennis', 'football', 'basketball', 'baseball', 'nfl', 'nhl'] as const;

/**
 * Deportes en SOMBRA (Fase 8): tienen ingesta, modelo y backtest, pero no entran en `SPORT_IDS` —ni en
 * las pestañas, ni en Destacados, ni en el banco, ni en la evaluación en vivo— hasta que su backtest
 * esté en el registro de experimentos con la misma evidencia que los cinco de arriba. Pasar uno a
 * `SPORT_IDS` es la decisión de publicarlo, y se toma con esa evidencia delante.
 */
export const DEPORTES_SOMBRA = ['ufc'] as const;

export type SportId = (typeof SPORT_IDS)[number];

/**
 * Resultados posibles del mercado principal (h2h). Solo el fútbol tiene empate que se apuesta; el
 * moneyline de la NHL incluye prórroga y tanda, así que tiene dos.
 */
export const OUTCOMES: Record<SportId, number> = { tennis: 2, football: 3, basketball: 2, baseball: 2, nfl: 2, nhl: 2 };

export function isSportId(s: string): s is SportId {
  return (SPORT_IDS as readonly string[]).includes(s);
}
