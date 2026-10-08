/**
 * Una coordenada de un trazo SVG con un decimal («12.3»). No es texto para
 * leer, así que no pasa por `formato.ts`; tampoco usa `toFixed`, que ESLint
 * reserva a ese módulo para que no vuelva a aparecer un «21.3 %» suelto.
 */
export const coord = (n: number): string => String(Math.round(n * 10) / 10)
