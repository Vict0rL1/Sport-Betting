/**
 * Revisión de la Fase 1: la distancia que falta para cambiar de decisión se
 * escribía `{fmtNum(d, 2)} {unidad}`, con un espacio normal antes de «%» (el
 * signo podía quedarse solo en la línea siguiente) y, sin unidad, con un
 * espacio suelto antes del paréntesis: «falta +3,00 )».
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CondicionDecision } from '../api/types'
import { QueLaCambiaria } from './DecisionExplicada'

const NBSP = '\u00a0'

function texto(c: Partial<CondicionDecision>): string {
  const condicion: CondicionDecision = {
    regla: 'r', condicion: 'condición', actual: 1, umbral: 2, distancia: null, unidad: null, ...c,
  }
  const { container } = render(
    <QueLaCambiaria cambiaria={[{ hacia: 'mantener', requiere: 'todas', condiciones: [condicion] }]} />,
  )
  return container.querySelector('li li span')?.textContent ?? ''
}

describe('distancia de una condición que cambiaría la decisión', () => {
  it('en %, con espacio duro y signo', () => {
    expect(texto({ distancia: 2.5, unidad: '%' })).toBe(`(ahora 1,00; falta +2,50${NBSP}%)`)
  })

  it('en otra unidad, con espacio duro', () => {
    expect(texto({ distancia: -1, unidad: 'puntos' })).toBe(`(ahora 1,00; falta -1,00${NBSP}puntos)`)
  })

  it('sin unidad, sin espacio suelto antes del paréntesis', () => {
    expect(texto({ distancia: 3, unidad: null })).toBe('(ahora 1,00; falta +3,00)')
  })
})
