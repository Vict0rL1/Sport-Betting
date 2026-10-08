/**
 * Toda pieza de texto que entra en una URL va codificada (revisión de la Fase 0).
 *
 * El backend valida el ticker, pero si el cliente pega `${symbol}` tal cual,
 * un «/», «?» o «#» tecleados cambian la ruta o la query ANTES de llegar a la
 * validación: «A/B» pide otra ruta y «A?x=1» mete un parámetro. De 32 sitios,
 * 23 iban sin codificar. Aquí se recorren todas las URL de `client.ts` y solo se
 * permite sin codificar lo que no puede llevar texto libre: números, booleanos
 * y el rango del gráfico (un tipo cerrado).
 */
import { describe, expect, it } from 'vitest'
import fuente from './client.ts?raw'

const SIN_TEXTO_LIBRE = /^(?:id|thesisId|years|days|descargar|range|tipoImpositivo|resp\.status|Math\.round\(.*\))$/
// `${refresh ? '&refresh=true' : ''}`: las dos ramas son texto fijo.
const RAMAS_FIJAS = /^\w+ \? '[^'$]*' : '[^'$]*'$/

describe('URLs del cliente', () => {
  it('codifican cualquier texto que interpolan', () => {
    const urls = [...fuente.matchAll(/`([^`]*\/api\/[^`]*)`/g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThan(40)
    const sinCodificar: string[] = []
    for (const url of urls) {
      for (const [, expr] of url.matchAll(/\$\{([^}]*)\}/g)) {
        const limpia = expr.replace(/\s+/g, ' ').trim()
        if (limpia.startsWith('encodeURIComponent(') || SIN_TEXTO_LIBRE.test(limpia) || RAMAS_FIJAS.test(limpia)) continue
        sinCodificar.push(`${limpia} en «${url.slice(0, 60)}»`)
      }
    }
    expect(sinCodificar).toEqual([])
  })

  // Un condicional que abre su propio literal (`${symbol ? `?symbol=${…}` : ''}`)
  // corta la URL en dos para la expresión de arriba: su parámetro se mira aquí.
  it('los condicionales también codifican', () => {
    const condicionales = [...fuente.matchAll(/\?(symbol|tipo_impositivo)=\$\{([^}]*)\}/g)].map((m) => [m[1], m[2]])
    expect(condicionales.length).toBeGreaterThan(0)
    for (const [param, expr] of condicionales) {
      if (param === 'symbol') expect(expr).toMatch(/^encodeURIComponent\(/)
    }
  })
})
