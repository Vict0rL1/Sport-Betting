import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SourceBadge } from './SourceBadge'

// Principio de la app: toda cifra lleva su fuente y su frescura. La insignia
// es lo que lo enseña, así que es el primer componente con test.
describe('SourceBadge', () => {
  it('enseña la fuente y su frescura', () => {
    render(<SourceBadge data={{ source: 'finnhub', as_of: '2026-10-08T14:00:00Z', cached: false, fetched_at: null }} freshness="delayed" />)
    expect(screen.getByText('finnhub · retrasado ~15 min')).toBeInTheDocument()
  })

  it('un dato viejo se distingue y dice su antigüedad', () => {
    render(
      <SourceBadge
        data={{ source: 'yfinance', as_of: '2026-10-08T14:00:00Z', cached: true, fetched_at: '2026-10-08T14:00:00Z', estado: 'viejo', antiguedad_segundos: 1200 }}
        freshness="live"
      />,
    )
    // Nunca «en vivo» para una copia rescatada.
    expect(screen.getByText(/DATO VIEJO · yfinance · hace 20 min/)).toBeInTheDocument()
    expect(screen.queryByText(/en vivo/)).not.toBeInTheDocument()
  })

  it('un dato viejo sin antigüedad no dice «hace 0 min» (revisión de la Fase 1)', () => {
    render(
      <SourceBadge
        data={{ source: 'yfinance', as_of: '2026-10-08T14:00:00Z', cached: true, fetched_at: null, estado: 'viejo', antiguedad_segundos: null }}
        freshness="live"
      />,
    )
    expect(screen.getByText(/DATO VIEJO · yfinance · antigüedad desconocida/)).toBeInTheDocument()
  })
})
