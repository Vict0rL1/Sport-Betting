/**
 * Lo generado por IA se ve, y se ve como IA (V9). La demo de las capturas no
 * tiene IA salvo en un escenario, así que aquí se pinta Noticias con una
 * interpretación de verdad: botón, petición y bloque, con los tokens violeta y
 * ni rastro del `bg-violet-50` que salía como una mancha blanca.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewsPage } from '../../pages/NewsPage'

const NOTICIAS = {
  source: 'finnhub', as_of: '2026-09-12T14:35:00Z', cached: false, fetched_at: null, symbol: null,
  items: [{ headline: 'Acme presenta resultados', summary: 'Resumen.', url: 'https://example.com/1',
            published_at: '2026-09-12T12:00:00Z', source: 'Demo', related: 'ACME,PARC' }],
}
const LECTURA = {
  generated_by: 'llm', content_md: 'Esto importa porque los márgenes suben.', model: 'modelo-de-prueba',
  created_at: null, cached: false, disclaimer: 'Generado por IA: puede contener errores.',
}

afterEach(() => vi.unstubAllGlobals())

describe('contenido de IA', () => {
  it('Noticias pinta la interpretación con los colores de IA y el primer ticker', async () => {
    const cuerpos: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (init?.method === 'POST') cuerpos.push(JSON.parse(String(init.body)))
      const json = url.startsWith('/api/news?') ? NOTICIAS : url === '/api/meta/llm'
        ? { configured: true, model: 'modelo-de-prueba' } : url === '/api/news/interpret' ? LECTURA : { detail: 'no' }
      return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const { container } = render(<MemoryRouter><NewsPage /></MemoryRouter>)
    const boton = await screen.findByRole('button', { name: /Por qué importa/ })
    expect(boton.className).toContain('text-(--ai)')
    await act(async () => fireEvent.click(boton))
    const bloque = await waitFor(() => {
      const b = container.querySelector('[data-contenido="ia"]')
      expect(b).not.toBeNull()
      return b as HTMLElement
    })
    expect(bloque.textContent).toContain('Generado por IA')
    expect(bloque.textContent).toContain('modelo-de-prueba')
    expect(bloque.textContent).toContain('los márgenes suben')
    expect(bloque.textContent).toContain('puede contener errores')
    expect(bloque.className).toContain('bg-(--ai-bg)')
    expect(container.innerHTML).not.toMatch(/violet-\d/)
    // `related` traía dos tickers; a la API va uno (la API valida uno por campo).
    expect(cuerpos).toEqual([{ headline: 'Acme presenta resultados', summary: 'Resumen.', symbol: 'ACME' }])
  })
})
