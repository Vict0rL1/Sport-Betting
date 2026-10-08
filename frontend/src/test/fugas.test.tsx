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
 * «analisis:03:09:37» y plurales «dato(s)». Mismo trinquete: lo que ya existía
 * está en PENDIENTES con el ítem que lo arregla, y la lista solo encoge.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContribucionAlRiesgoPanel, CosteOportunidadPanel } from '../components/cartera/RiesgoYOportunidad'
import { CalidadSection } from '../components/ticker/CalidadSection'
import { ExpectativasSection } from '../components/ticker/ExpectativasSection'
import { HistorialSection } from '../components/ticker/HistorialSection'
import { QueCambioSection } from '../components/ticker/QueCambioSection'
import { TodayPage } from '../pages/TodayPage'
import empresaCompleta from './fixtures/empresa_completa.json'
import empresaDeudaParcial from './fixtures/empresa_deuda_parcial.json'
import empresaVacia from './fixtures/empresa_vacia.json'
import hoyCompleto from './fixtures/hoy_completo.json'
import hoySinCandidatas from './fixtures/hoy_sin_candidatas.json'

type Escenario = { symbol?: string; rutas: Record<string, { status: number; json: unknown }> }

export const PATRONES: Record<string, RegExp> = {
  vacio: /\b(?:undefined|NaN|nan|None|null)\b/g,
  menos_cero: /(?<![\d.,])[-−]0(?:[.,]0+)?(?!\d)(?![.,]\d)/g,
  snake: /\b[a-z]+_[a-z0-9_]+\b/g,
  upper_snake: /\b[A-Z]+_[A-Z_]+\b/g,
  clave_interna: /\b[a-z_]+:\d{2}:\d{2}/g,
  plural_parentesis: /\((?:es|s)\)/g,
}

// Legítimos para siempre (los mismos que en el backend).
const PERMITIDOS = new Set(['snake w_i', 'snake componente_i'])
const PERMITIDOS_RE: [string, RegExp][] = [['upper_snake', /^[A-Z]+_(?:API_KEY|USER_AGENT|MODEL)$/]]

// Fugas conocidas a 8-oct-2026 → ítem del plan que las arregla.
const PENDIENTES: Record<string, string> = {
  'vacio undefined': '1.4', // «undefined %» en «Cómo se repartió el tamaño» (V3)
  'menos_cero -0': '1.7', // «-0 %» (V8)
  'menos_cero -0,00': '1.7',
  'plural_parentesis (s)': '1.9', // «1 dato(s) desconocido(s)»
  'plural_parentesis (es)': '1.9', // «cambio(s) material(es)»
  'snake sin_datos': '1.8', // «La señal de ACME es «sin_datos»»
  'upper_snake SIN_DATOS': '1.8',
  'snake sin_tesis': '1.8',
  'snake us_sp500': '1.8', // «lista diaria «us_sp500»»
  'clave_interna analisis:14:35': '1.8', // origen del replay «analisis:14:35:00»
  'snake information_available_at': '1.8', // regla del replay en inglés
  'snake decision_timestamp': '1.8',
  'snake gross_margin': '1.8', // métricas en crudo en «lo que falta» y en la mejor prevista
  'snake operating_margin': '1.8',
  'snake net_margin': '1.8',
  'snake fcf_growth': '1.8',
  'snake eps_diluted': '1.8',
  'snake deuda_neta': '1.8',
  'snake revenue_growth': '1.8',
}

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

function fugas(textos: string[]): Map<string, string[]> {
  const salida = new Map<string, string[]>()
  for (const t of textos) {
    for (const [tipo, re] of Object.entries(PATRONES)) {
      for (const m of t.matchAll(re)) {
        const clave = `${tipo} ${m[0]}`
        if (PERMITIDOS.has(clave) || PERMITIDOS_RE.some(([tt, r]) => tt === tipo && r.test(m[0]))) continue
        salida.set(clave, [...(salida.get(clave) ?? []), t])
      }
    }
  }
  return salida
}

const CARGANDO = /Cargando|Analizando|Calculando…|Calculando\.\.\./

async function pintar(e: Escenario, ui: ReactElement, despues?: () => Promise<void>) {
  const pedidas = servir(e)
  const { container } = render(<MemoryRouter>{ui}</MemoryRouter>)
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
const anotar = (textos: string[]) => {
  for (const [k, v] of fugas(textos)) encontradas.set(k, [...(encontradas.get(k) ?? []), ...v])
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('fugas de texto en pantalla', () => {
  for (const [nombre, e] of EMPRESAS) {
    const s = e.symbol!
    it(`ficha · ${nombre}`, async () => {
      for (const ui of [
        <QueCambioSection symbol={s} />,
        <CalidadSection symbol={s} />,
        <ExpectativasSection symbol={s} />,
        <ContribucionAlRiesgoPanel />,
        <CosteOportunidadPanel />,
      ]) {
        const r = await pintar(e, ui)
        expect(r.sinFixture).toEqual([])
        anotar(r.textos)
        cleanup()
      }
      // El historial, y el replay de cada instantánea.
      const r = await pintar(e, <HistorialSection symbol={s} />, async () => {
        const botones = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent === 'Replay')
        for (const b of botones) {
          await act(async () => fireEvent.click(b))
          await waitFor(() => expect(document.body.textContent).toMatch(/Replay del|replay/i))
          anotar(textosVisibles(document.body))
        }
      })
      expect(r.sinFixture).toEqual([])
      anotar(r.textos)
    })
  }

  for (const [nombre, e] of [['con candidatas', hoyCompleto], ['sin candidatas', hoySinCandidatas]] as const) {
    it(`Hoy · ${nombre}`, async () => {
      const r = await pintar(e as Escenario, <TodayPage />)
      expect(r.sinFixture).toEqual([])
      anotar(r.textos)
    })
  }

  it('nada nuevo enseña tripas y las pendientes siguen existiendo', () => {
    const nuevas = [...encontradas].filter(([k]) => !(k in PENDIENTES))
    const arregladas = Object.keys(PENDIENTES).filter((k) => !encontradas.has(k))
    expect(nuevas.map(([k, v]) => `${k} — «${v[0].slice(0, 100)}»`)).toEqual([])
    expect(arregladas).toEqual([])
  })
})
