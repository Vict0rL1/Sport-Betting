/**
 * Revisión de la Fase 1 (A2): «Sin información posterior: 0 marcas de tiempo
 * comprobadas» vendía como garantía lo que no se había comprobado. UNKNOWN no
 * se convierte en PASS, tampoco en una frase.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Anticipacion } from './HistorialSection'

const REGLA = 'cada dato estaba disponible antes del momento de la decisión'

function texto(marcas: number, sinFecha: string[] = []): string {
  const p = { regla: REGLA, marcas_comprobadas: marcas, retiradas_por_fecha_futura: [], sin_fecha_verificable: sinFecha, nota: '' }
  return render(<Anticipacion p={p} />).container.textContent ?? ''
}

describe('protección contra información posterior en el replay', () => {
  it('sin marcas no se comprobó nada, y se dice', () => {
    const t = texto(0)
    expect(t).toMatch(/^No se pudo comprobar que no hubiera información posterior/)
    expect(t).not.toMatch(/Sin información posterior/)
  })

  it('con marcas, la garantía y su recuento', () => {
    expect(texto(1)).toBe(`Sin información posterior: 1 marca de tiempo comprobada contra «${REGLA}».`)
  })

  it('lo que no tiene fecha verificable se nombra y quita la garantía', () => {
    const t = texto(4, ['consenso'])
    expect(t).not.toMatch(/Sin información posterior/)
    expect(t).toMatch(/Sin fecha verificable, no se pudo comprobar: consenso\./)
  })
})
