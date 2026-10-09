/**
 * El frontend etiqueta EXACTAMENTE como el backend (ítem 1.8): los casos los
 * calcula `backend/app/etiquetas.py` al exportar, y aquí se repiten.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import datos from './etiquetas.json'
import { etiqueta } from './etiquetas'

afterEach(() => vi.restoreAllMocks())

describe('etiquetas', () => {
  for (const [codigo, mayuscula, esperado] of datos.casos as [string, boolean, string][])
    it(`${codigo}${mayuscula ? ' (mayúscula)' : ''} → ${esperado}`, () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(etiqueta(codigo, { mayuscula })).toBe(esperado)
    })

  it('un código desconocido avisa en la consola, una vez', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(etiqueta('codigo_solo_de_este_test')).toBe('codigo solo de este test')
    etiqueta('codigo_solo_de_este_test')
    expect(aviso).toHaveBeenCalledTimes(1)
  })

  it('una clave del prototipo no es una etiqueta (revisión de la Fase 1)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(etiqueta('constructor')).toBe('constructor')
    expect(etiqueta('toString')).toBe('tostring') // la reserva legible, no la función del prototipo
  })

  it('lo ausente es una raya', () => {
    expect(etiqueta(null)).toBe('—')
    expect(etiqueta(undefined)).toBe('—')
  })
})
