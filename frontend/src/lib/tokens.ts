/**
 * Los tokens semánticos de color (`src/index.css`), para lo que no puede usar
 * una clase: lo que se dibuja en un canvas (el gráfico de precios) recibe un
 * color como texto, y uno escrito a mano no se entera del tema (V1).
 */
export const TOKENS = [
  'surface-page',
  'surface-card',
  'surface-sunken',
  'border',
  'text-muted',
  'text',
  'text-strong',
  'buy',
  'sell',
  'warn',
  'warn-bg',
  'info',
  'ai',
  'ai-bg',
] as const

export type Token = (typeof TOKENS)[number]

/** El valor actual de un token («#111a2e»), leído del documento. */
export function leerToken(nombre: Token, elemento: Element = document.documentElement): string {
  return getComputedStyle(elemento).getPropertyValue(`--${nombre}`).trim()
}

/** El mismo color con opacidad (`#4ade9c` → `rgba(74, 222, 156, 0.35)`), para canvas. */
export function conOpacidad(hex: string, alfa: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return hex
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16))
  return `rgba(${r}, ${g}, ${b}, ${alfa})`
}
