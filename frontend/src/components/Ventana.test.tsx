/**
 * V18: con un solo ejercicio de historia el informe decía «Ingresos 5A: 10 %»;
 * la tasa era a un año y el rótulo prometía cinco. Con la respuesta REAL del
 * backend para ACME (`empresa_completa.json`, un año de crecimiento), el rótulo
 * dice la ventana que hay y la marca como parcial.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import { DeepDiveSection } from './ticker/DeepDiveSection'
import { Ventana } from './Ventana'

const rutas = (empresaCompleta as { rutas: Record<string, { status: number; json: unknown }> }).rutas

afterEach(() => vi.unstubAllGlobals())

describe('ventana de las tasas de crecimiento', () => {
  it('una ventana completa no lleva marca; una corta dice «parcial» y cuánto hay', () => {
    const { container, rerender } = render(<Ventana anos={5} />)
    expect(container.textContent).toBe('5A')
    rerender(<Ventana anos={2} />)
    expect(container.textContent).toBe('2Aparcial')
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe(
      'Solo hay 2 años de historia; la ventana completa es de 5.',
    )
    rerender(<Ventana anos={0} />)
    expect(container.textContent).toBe('sin historia')
  })

  it('el informe no rotula «5A» una tasa calculada con un año', async () => {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    const { container } = render(<DeepDiveSection symbol="ACME" />)
    const rotulos = await screen.findAllByText(/^(?:Ingresos|BPA), crec\. anual/, { selector: 'dt' }, { timeout: 3000 })
    const textos = rotulos.map((r) => r.textContent)
    expect(textos).toContain('Ingresos, crec. anual 1Aparcial')
    expect(textos).toContain('BPA, crec. anual 1Aparcial')
    // La de 3A es una ventana fija propia: con un año tampoco hay tasa a 3.
    expect(textos).toContain('Ingresos, crec. anual 3A')
    expect(container.textContent).not.toMatch(/\b5A\b/)
    expect(container.textContent).toContain('a 1 año; ventana corta: la completa es de 5')
  })
})
