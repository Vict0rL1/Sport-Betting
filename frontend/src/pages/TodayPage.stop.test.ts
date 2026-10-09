/**
 * Revisión de la Fase 1 (A1): en una idea nueva el stop salía «+12,8 %» en la
 * tarjeta y «-12,8 %» en el disparador. El signo es el del precio de hoy al stop.
 */
import { describe, expect, it } from 'vitest'
import type { Decision, DecisionLevels } from '../api/types'
import { fmtPct } from '../lib/formato'
import { distanciaAlStop } from './TodayPage'

function decision(owned: boolean, stop_pct: number): Decision {
  const levels = { stop: 87.2, stop_pct, objetivo: 125, objetivo_pct: 25, ratio: 2 } as DecisionLevels
  return { action: 'comprar', label: 'Comprar', reasons: [], levels, escenarios: null, triggers: [],
           confidence: 'sin_calibrar', owned }
}

describe('distancia al stop', () => {
  it('en una idea nueva, por debajo del precio: negativa, como el disparador', () => {
    expect(fmtPct(distanciaAlStop(decision(false, 12.8)), 1, { signo: true, enPuntos: true })).toBe('-12,8\u00a0%')
  })

  it('sobre una posición, el signo del backend se respeta: positiva = perforado', () => {
    expect(distanciaAlStop(decision(true, -8.4))).toBe(-8.4)
    expect(distanciaAlStop(decision(true, 3.1))).toBe(3.1)
  })

  it('sin niveles no hay distancia', () => {
    expect(distanciaAlStop({ ...decision(false, 1), levels: null })).toBeNull()
  })
})
