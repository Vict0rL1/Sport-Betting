/**
 * Revisión de la Fase 1 (D4): los ejes y la cruz del gráfico salían en formato
 * inglés («123.45», «1.2M»). El canvas usa los mismos formateadores que la app.
 */
import { describe, expect, it } from 'vitest'
import { FORMATO_VOLUMEN, LOCALIZACION } from './PriceChart'

describe('formato del gráfico de precios', () => {
  it('precios con coma decimal y punto de miles', () => {
    expect(LOCALIZACION.priceFormatter(1234.5)).toBe('1.234,50')
  })

  it('el volumen en M y mil M, nunca «B»', () => {
    expect(FORMATO_VOLUMEN.formatter(2_500_000_000)).toBe('2,5\u00a0mil\u00a0M')
  })

  it('una barra diaria (00:00 UTC) es de su día, también al oeste de Greenwich', () => {
    expect(LOCALIZACION.timeFormatter(Date.UTC(2026, 8, 12) / 1000)).toBe('12 sept 2026')
  })
})
