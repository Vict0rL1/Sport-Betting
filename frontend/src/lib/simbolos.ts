/**
 * Finnhub puede mandar en `related` varios tickers separados por comas
 * («AAPL,MSFT»), o una cadena vacía. La API valida un solo ticker por campo,
 * así que mandar `related` tal cual convertía «¿Por qué importa?» en un 422.
 * Se manda el primero; si no hay ninguno, `null`.
 */
export function primerSimbolo(texto: string | null | undefined): string | null {
  return (texto ?? '').split(',').map((s) => s.trim()).find(Boolean) ?? null
}
