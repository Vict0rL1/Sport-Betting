/**
 * V13: el calendario de resultados confundía un fallo con «no hay eventos» y
 * adivinaba la causa («¿falta FINNHUB_API_KEY en .env?»). Un fallo dice lo que
 * pasó; una lista vacía dice que no hay resultados anunciados.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

afterEach(() => vi.unstubAllGlobals())

function servir(calendario: { status: number; json: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    if (url.startsWith('/api/market/calendar'))
      return new Response(JSON.stringify(calendario.json), { status: calendario.status })
    return new Response(JSON.stringify({ detail: 'sin datos en el test' }), { status: 503 })
  }))
}

describe('calendario de resultados del panel de mercado', () => {
  it('un fallo se dice como fallo, con su motivo', async () => {
    servir({ status: 502, json: { detail: 'el proveedor no respondió' } })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(await screen.findByText(/No se pudo cargar el calendario de resultados: el proveedor no respondió/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/FINNHUB_API_KEY/)
  })

  it('la curva y los indicadores de FRED que fallan lo dicen, sin adivinar la clave (revisión F1)', async () => {
    servir({ status: 200, json: { events: [] } })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(await screen.findByText('No se pudo cargar la curva: sin datos en el test')).toBeInTheDocument()
    expect(await screen.findByText('No se pudieron cargar los indicadores: sin datos en el test')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/FRED_API_KEY/)
  })

  it('una lista vacía dice que no hay resultados anunciados', async () => {
    servir({ status: 200, json: { events: [] } })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(await screen.findByText('Ninguna empresa anuncia resultados en los próximos 14 días.')).toBeInTheDocument()
  })
})
