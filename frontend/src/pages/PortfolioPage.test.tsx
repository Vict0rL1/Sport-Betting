/**
 * Cifras de la cartera (ítem 1.7). Parte de la respuesta REAL del backend para
 * la cartera de ACME (`empresa_completa.json`, todo en USD) y le añade una
 * posición en CAD para el caso de dos divisas, que el paquete no trae.
 *
 * - V5: un importe de cuatro cifras se agrupa como uno de cinco («6.000,00»
 *   junto a «17.400,00», no «6000,00»).
 * - Con dos divisas, cada importe lleva su código: «120,00» a secas no dice si
 *   son dólares o dólares canadienses. Con una sola divisa, sin código.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import { PortfolioPage } from './PortfolioPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Cartera = {
  positions: Record<string, unknown>[]
  divisas: Record<string, unknown>
  summary: Record<string, unknown>
}

vi.mock('../components/PriceChart', () => ({ PriceChart: () => null }))

const base = (empresaCompleta as { rutas: Rutas }).rutas

function conDosDivisas(): Rutas {
  const rutas: Rutas = structuredClone(base)
  const cartera = rutas['/api/portfolio'].json as Cartera
  const usd = cartera.positions[0]
  cartera.positions.push({
    ...usd,
    id: 2,
    symbol: 'RY.TO',
    name: 'Royal Bank',
    currency: 'CAD',
    quantity: 50,
    cost_basis: 120,
    invested: 6000,
    price: 130,
    market_value: 6500,
    unrealized_pnl: 500,
    unrealized_pct: 500 / 6000,
  })
  cartera.divisas = { ...cartera.divisas, mezcla_de_divisas: true, monedas: { USD: 18000, CAD: 4745 } }
  return rutas
}

function servir(rutas: Rutas) {
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
  }))
}

const fila = (simbolo: string) =>
  screen.getAllByRole('row').find((r) => r.querySelector('a')?.textContent?.includes(simbolo))

afterEach(() => vi.unstubAllGlobals())

describe('cifras de la cartera', () => {
  it('con una sola divisa, importes sin código y agrupados en es-ES', async () => {
    servir(base)
    render(<MemoryRouter><PortfolioPage /></MemoryRouter>)
    expect(await screen.findByText('Invertido')).toBeInTheDocument()
    const ko = fila('KO')!
    expect(ko.textContent).toContain('58,00')
    expect(ko.textContent).toContain('18.000,00')
    expect(ko.textContent).not.toMatch(/USD|CAD/)
  })

  it('con dos divisas, cada importe dice la suya y los totales la base', async () => {
    servir(conDosDivisas())
    render(<MemoryRouter><PortfolioPage /></MemoryRouter>)
    expect(await screen.findByText('Invertido')).toBeInTheDocument()
    const ry = fila('RY.TO')!
    expect(ry.textContent).toContain('120,00\u00a0CAD')
    expect(ry.textContent).toContain('6.500,00\u00a0CAD') // V5: cuatro cifras, con punto
    expect(ry.textContent).toContain('+500,00\u00a0CAD')
    expect(fila('KO')!.textContent).toContain('58,00\u00a0USD')
    expect(screen.getByText('Invertido').parentElement?.textContent).toBe('Invertido17.400,00\u00a0USD')
  })
})
