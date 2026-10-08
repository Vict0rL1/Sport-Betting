/**
 * Ninguna pantalla enseña tripas (ítem 0.5 del plan de correcciones).
 *
 * Los componentes clave se renderizan con respuestas REALES del backend sobre
 * el paquete de casos extremos (`backend/tests/fixtures/exportar_frontend.py`
 * las exporta a `fixtures/`): una empresa completa con historia, una sin un solo
 * dato, una con deuda parcial y un tipo de cambio invertido, un día de lista con
 * candidatas y otro sin ninguna. Se simula `fetch`, no la API: el componente
 * hace sus peticiones de verdad.
 *
 * Sobre cada nodo de texto visible se buscan las mismas familias que en el
 * backend: «undefined», «NaN», «-0 %», códigos internos, claves como
 * «analisis:03:09:37» y plurales «dato(s)». Mismo trinquete que en el backend,
 * por SITIO (la pantalla o sección) y con RECUENTO: una fuga en un sitio nuevo,
 * o más apariciones de las anotadas, rompe; menos apariciones también, para que
 * quien arregle baje el número. La lista solo encoge.
 *
 * El reloj va congelado en el momento de las capturas: «hace 5 min» no puede
 * depender del día en que se pasa el test.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ContribucionAlRiesgoPanel, CosteOportunidadPanel } from '../components/cartera/RiesgoYOportunidad'
import { CalidadSection } from '../components/ticker/CalidadSection'
import { DeepDiveSection } from '../components/ticker/DeepDiveSection'
import { ExpectativasSection } from '../components/ticker/ExpectativasSection'
import { HistorialSection } from '../components/ticker/HistorialSection'
import { QueCambioSection } from '../components/ticker/QueCambioSection'
import { ValuationSection } from '../components/ticker/ValuationSection'
import { PortfolioPage } from '../pages/PortfolioPage'
import { TickerPage } from '../pages/TickerPage'
import { TodayPage } from '../pages/TodayPage'
import empresaCompleta from './fixtures/empresa_completa.json'
import empresaDeudaParcial from './fixtures/empresa_deuda_parcial.json'
import empresaVacia from './fixtures/empresa_vacia.json'
import hoyCompleto from './fixtures/hoy_completo.json'
import hoySinCandidatas from './fixtures/hoy_sin_candidatas.json'

// El gráfico de precios dibuja en un canvas (jsdom no tiene ni canvas ni
// matchMedia) y su texto no está en el DOM: aquí no hay nada que leer.
vi.mock('../components/PriceChart', () => ({ PriceChart: () => null }))

type Escenario = { symbol?: string; rutas: Record<string, { status: number; json: unknown }> }

export const PATRONES: Record<string, RegExp> = {
  vacio: /\b(?:undefined|NaN|nan|None|null)\b/g,
  menos_cero: /(?<![\d.,])[-−]0(?:[.,]0+)?(?!\d)(?![.,]\d)/g,
  snake: /\b[a-z]+_[a-z0-9_]+\b/g,
  upper_snake: /\b[A-Z]+_[A-Z_]+\b/g,
  clave_interna: /\b[a-z_]+:\d{2}:\d{2}/g,
  plural_parentesis: /\((?:es|s)\)/g,
  // Un decimal con punto inglés («31.2 %», «EPS estimado 0.52», V4); no toca el
  // punto de miles es-ES («6.000», «1.234.567»), al que siempre siguen tres cifras.
  decimal_punto: /(?<![\w.,])(?:0\.\d+|\d+\.\d{1,2}|\d+\.\d{4,})(?![\w.,]?\d)/g,
}

// Legítimos para siempre (los mismos que en el backend).
const PERMITIDOS = new Set(['snake w_i', 'snake componente_i'])
const PERMITIDOS_RE: [string, RegExp][] = [['upper_snake', /^[A-Z]+_(?:API_KEY|USER_AGENT|MODEL)$/]]

// Fugas conocidas: «sitio · tipo token» → [apariciones, ítem del plan que las arregla].
// Cuando el test falla, su mensaje trae la tabla actual lista para pegar aquí.
const PENDIENTES: Record<string, [number, string]> = {
}

// El momento de las capturas (los datos del backend son de las 14:35 UTC).
const AHORA = new Date('2026-09-12T14:40:00Z')

function servir(e: Escenario) {
  const pedidas: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.pathname + entrada.search : entrada.url
      pedidas.push(url)
      const r = e.rutas[url]
      return new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), {
        status: r ? r.status : 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  return pedidas
}

function textosVisibles(raiz: Node): string[] {
  const salida: string[] = []
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = (n.textContent ?? '').trim()
    if (t) salida.push(t)
  }
  return salida
}

function fugas(sitio: string, textos: string[]): Map<string, string[]> {
  const salida = new Map<string, string[]>()
  for (const t of textos) {
    for (const [tipo, re] of Object.entries(PATRONES)) {
      for (const m of t.matchAll(re)) {
        if (PERMITIDOS.has(`${tipo} ${m[0]}`) || PERMITIDOS_RE.some(([tt, r]) => tt === tipo && r.test(m[0]))) continue
        const clave = `${sitio} · ${tipo} ${m[0]}`
        salida.set(clave, [...(salida.get(clave) ?? []), t])
      }
    }
  }
  return salida
}

const CARGANDO = /Cargando|Analizando|Calculando…|Calculando\.\.\./

async function pintar(e: Escenario, ui: ReactElement, despues?: () => Promise<void>, ruta?: string) {
  const pedidas = servir(e)
  const { container } = render(
    ruta ? (
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/ticker/:symbol" element={ui} />
        </Routes>
      </MemoryRouter>
    ) : (
      <MemoryRouter>{ui}</MemoryRouter>
    ),
  )
  await waitFor(() => expect(container.textContent ?? '').not.toMatch(CARGANDO), { timeout: 4000 })
  if (despues) await despues()
  const sinFixture = pedidas.filter((u) => !e.rutas[u])
  return { textos: textosVisibles(container), sinFixture }
}

const EMPRESAS: [string, Escenario][] = [
  ['completa', empresaCompleta as Escenario],
  ['vacía', empresaVacia as Escenario],
  ['deuda parcial', empresaDeudaParcial as Escenario],
]

const encontradas = new Map<string, string[]>()
const anotar = (sitio: string, textos: string[]) => {
  for (const [k, v] of fugas(sitio, textos)) encontradas.set(k, [...(encontradas.get(k) ?? []), ...v])
}

beforeAll(() => {
  // Solo la fecha: los temporizadores siguen siendo reales para que `waitFor` funcione.
  vi.useFakeTimers({ toFake: ['Date'], now: AHORA })
})

afterAll(() => {
  vi.useRealTimers()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('fugas de texto en pantalla', () => {
  for (const [nombre, e] of EMPRESAS) {
    const s = e.symbol!
    it(`ficha · ${nombre}`, async () => {
      const secciones: [string, ReactElement][] = [
        ['ficha/Qué cambió', <QueCambioSection symbol={s} />],
        ['ficha/Calidad', <CalidadSection symbol={s} />],
        ['ficha/Expectativas', <ExpectativasSection symbol={s} />],
        ['ficha/Informe', <DeepDiveSection symbol={s} />],
        ['ficha/Valoración', <ValuationSection symbol={s} />],
        ['cartera/Contribución al riesgo', <ContribucionAlRiesgoPanel />],
        ['cartera/Coste de oportunidad', <CosteOportunidadPanel />],
        ['cartera/Portafolio', <PortfolioPage />],
      ]
      for (const [sitio, ui] of secciones) {
        const r = await pintar(e, ui)
        expect(r.sinFixture, sitio).toEqual([])
        anotar(sitio, r.textos)
        cleanup()
      }
      // La cabecera de la ficha (pestaña Resumen), con su ruta.
      const cabecera = await pintar(e, <TickerPage />, undefined, `/ticker/${s}`)
      expect(cabecera.sinFixture).toEqual([])
      anotar('ficha/Cabecera', cabecera.textos)
      cleanup()
      // El historial, y el replay de CADA instantánea: si el botón cambia de
      // nombre, el bucle no puede quedarse callado sin probar nada.
      const historial = e.rutas[`/api/empresa/${s}/historial`].json as { decisiones?: unknown[] }
      const r = await pintar(e, <HistorialSection symbol={s} />, async () => {
        const botones = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === 'Replay')
        expect(botones.length).toBe((historial.decisiones ?? []).length)
        for (const b of botones) {
          await act(async () => fireEvent.click(b))
          await waitFor(() => expect(document.body.textContent).toMatch(/Replay del|replay/i))
          anotar('ficha/Replay', textosVisibles(document.body))
        }
      })
      expect(r.sinFixture).toEqual([])
      anotar('ficha/Historial', r.textos)
    })
  }

  for (const [nombre, e] of [['con candidatas', hoyCompleto], ['sin candidatas', hoySinCandidatas]] as const) {
    it(`Hoy · ${nombre}`, async () => {
      const r = await pintar(e as Escenario, <TodayPage />)
      expect(r.sinFixture).toEqual([])
      anotar('Hoy', r.textos)
    })
  }

  it('nada nuevo enseña tripas y las pendientes siguen igual', () => {
    const tabla = [...encontradas]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `  '${k}': [${v.length}, '${PENDIENTES[k]?.[1] ?? '?'}'],`)
      .join('\n')
    const nuevas = [...encontradas]
      .filter(([k, v]) => !(k in PENDIENTES) || v.length > PENDIENTES[k][0])
      .map(([k, v]) => `${k} ×${v.length} (anotadas ${PENDIENTES[k]?.[0] ?? 0}) — «${v[v.length - 1].slice(0, 100)}»`)
    const arregladas = Object.entries(PENDIENTES)
      .filter(([k, [n]]) => (encontradas.get(k)?.length ?? 0) < n)
      .map(([k, [n, item]]) => `${k} (ítem ${item}): anotadas ${n}, quedan ${encontradas.get(k)?.length ?? 0}`)
    expect(nuevas, `Tabla actual de PENDIENTES:\n${tabla}\n`).toEqual([])
    expect(arregladas, `Tabla actual de PENDIENTES:\n${tabla}\n`).toEqual([])
  })
})
