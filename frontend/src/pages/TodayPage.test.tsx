/**
 * Un día sin candidatas (V3): el reparto del tamaño dice que no hay nada que
 * repartir en vez de pintar «undefined %». Con la respuesta REAL del backend
 * para ese día (`hoy_sin_candidatas.json`), que trae un aviso de la cartera y
 * por eso enseña el panel.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import hoySinCandidatas from '../test/fixtures/hoy_sin_candidatas.json'
import { TodayPage } from './TodayPage'

const rutas = (hoySinCandidatas as { rutas: Record<string, { status: number; json: unknown }> }).rutas

afterEach(() => vi.unstubAllGlobals())

describe('Hoy sin candidatas', () => {
  it('el reparto del tamaño dice que no hay candidatas, sin «undefined»', async () => {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    const { container } = render(<MemoryRouter><TodayPage /></MemoryRouter>)
    expect(await screen.findByText('Cómo se repartió el tamaño')).toBeInTheDocument()
    expect(screen.getByText('Hoy no hay candidatas que dimensionar.')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/undefined|NaN/)
  })
})
