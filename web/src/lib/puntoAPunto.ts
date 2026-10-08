// Lo que el modo punto a punto apunta de cada punto (Fase 8.4), sin React para poder probarlo:
// el recuento de puntos al saque de hoy y el último juego, con si fue break. El marcador nuevo lo
// calcula el servidor (POST /api/live/avanzar); aquí solo se mira qué cambió.

export interface Marcador {
  sets: [number, number];
  games: [number, number];
  points: [number, number];
  server: 1 | 2;
}
/** [ganados, servidos] de cada jugador con su saque. */
export type Recuento = [[number, number], [number, number]];
export interface UltimoJuego {
  winner: 1 | 2;
  wasBreak: boolean;
}

export function trasPunto(
  antes: Marcador,
  recuento: Recuento,
  ultimo: UltimoJuego | null,
  ganador: 1 | 2,
  despues: Marcador | null,
): { recuento: Recuento; ultimo: UltimoJuego | null } {
  const s = antes.server - 1;
  const nuevo = recuento.map((x, i) => (i === s ? [x[0] + (ganador === antes.server ? 1 : 0), x[1] + 1] : [...x])) as Recuento;
  // Se cerró un juego si cambian los juegos o los sets (o si el partido terminó con este punto).
  const cerro =
    despues == null ||
    despues.games[0] !== antes.games[0] ||
    despues.games[1] !== antes.games[1] ||
    despues.sets[0] !== antes.sets[0] ||
    despues.sets[1] !== antes.sets[1];
  return { recuento: nuevo, ultimo: cerro ? { winner: ganador, wasBreak: ganador !== antes.server } : ultimo };
}
