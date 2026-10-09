/**
 * Los tokens de color cumplen lo que prometen (ítem 1.1): todo color de texto,
 * sobre toda superficie, con contraste ≥ 4,5:1 (WCAG AA). Se leen del propio
 * `index.css`, no de una copia: si alguien cambia un valor allí, esto lo mide.
 */
import { afterEach, describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { conOpacidad, leerToken, TOKENS } from './tokens'

function valores(): Record<string, string> {
  const salida: Record<string, string> = {}
  for (const bloque of css.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const [, nombre, valor] of bloque[1].matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) salida[nombre] = valor
  }
  return salida
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (oscuro + 0.05)
}

const SUPERFICIES = ['surface-page', 'surface-card', 'surface-sunken']
const TEXTOS = ['text-muted', 'text', 'text-strong', 'buy', 'sell', 'warn', 'info', 'ai', 'indicador']
// Los tintes de fondo se usan con su propio color de texto encima.
const PAREJAS: [string, string][] = [
  ['warn', 'warn-bg'],
  ['ai', 'ai-bg'],
  ['text-strong', 'warn-bg'],
  ['text-strong', 'ai-bg'],
  // El cuerpo de un bloque de IA (BloqueIA) es texto normal sobre su tinte.
  ['text', 'ai-bg'],
]

// El violeta de la IA marca lo generado por IA (§3); el SMA 200 y el RSI lo
// usaban siendo cálculos (revisión de la Fase 1). Solo lo pinta esto:
const PUEDEN_USAR_IA = ['../components/ia/ContenidoIA.tsx', '../components/ApiUsageBar.tsx']
const FUENTES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../lib/tokens.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const USO_IA = /(?:token:\s*|leerToken\(|\bc\()\s*['"]ai(?:-bg)?['"]|--ai\b/

describe('tokens de color', () => {
  const v = valores()

  it('index.css define exactamente los tokens de tokens.ts', () => {
    expect(Object.keys(v).sort()).toEqual([...TOKENS].sort())
  })

  it('todo texto sobre toda superficie llega a 4,5:1', () => {
    const malos = []
    for (const t of TEXTOS)
      for (const s of SUPERFICIES) {
        const c = contraste(v[t], v[s])
        if (c < 4.5) malos.push(`${t} sobre ${s}: ${c.toFixed(2)}:1`)
      }
    for (const [t, s] of PAREJAS) {
      const c = contraste(v[t], v[s])
      if (c < 4.5) malos.push(`${t} sobre ${s}: ${c.toFixed(2)}:1`)
    }
    expect(malos).toEqual([])
  })

  it('el color de la IA solo lo usa lo generado por IA', () => {
    expect(Object.keys(FUENTES).length).toBeGreaterThan(40) // que el glob ve el código
    const usos = Object.entries(FUENTES).filter(([f, src]) => !PUEDEN_USAR_IA.includes(f) && USO_IA.test(src))
    expect(usos.map(([f]) => f)).toEqual([])
  })

  it('la medida de contraste es la de WCAG', () => {
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contraste('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })
})

describe('leerToken', () => {
  afterEach(() => document.documentElement.removeAttribute('style'))

  it('lee el valor vigente del documento', () => {
    document.documentElement.style.setProperty('--surface-card', ' #111a2e ')
    expect(leerToken('surface-card')).toBe('#111a2e')
  })

  it('pone opacidad a un color de canvas', () => {
    expect(conOpacidad('#4ade9c', 0.35)).toBe('rgba(74, 222, 156, 0.35)')
    expect(conOpacidad('no-es-hex', 0.5)).toBe('no-es-hex')
  })
})
