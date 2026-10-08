/**
 * Un solo formato de cifras para backend y frontend (ítem 1.7: V4, V5, V8).
 * La tabla de casos es la MISMA que prueba `backend/tests/test_formato.py`: los
 * dos lados tienen que escribir la misma cadena, carácter a carácter.
 */
import { describe, expect, it } from 'vitest'
import casos from './formato.casos.json'
import * as formato from './formato'

type Caso = [unknown[], Record<string, unknown>, string]

const FUNCIONES: Record<string, (args: unknown[], op: Record<string, unknown>) => string> = {
  fmt_num: ([v, d], op) => formato.fmtNum(cifra(v), d as number | undefined, op),
  fmt_pct: ([v, d], op) =>
    formato.fmtPct(cifra(v), d as number | undefined, { signo: op.signo as boolean, enPuntos: op.en_puntos as boolean }),
  fmt_dinero: ([v, m, d], op) => formato.fmtDinero(cifra(v), m as string | null, d as number | undefined, op),
  fmt_compacto: ([v, m]) => formato.fmtCompacto(cifra(v), m as string | undefined),
  fmt_fecha: ([v], op) => formato.fmtFecha(v as string | null, op),
  fmt_antiguedad: ([v, ahora]) => formato.fmtAntiguedad(v as string | null, new Date(ahora as string)),
}

function cifra(v: unknown): number | null {
  if (v === 'NaN') return NaN
  if (v === 'Infinity') return Infinity
  return v as number | null
}

const tabla = casos as unknown as Record<string, Caso[]>

describe('formato compartido con el backend', () => {
  it('la tabla cubre todas las funciones públicas', () => {
    const publicas = Object.keys(formato)
      .filter((n) => n.startsWith('fmt'))
      .map((n) => n.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`))
    expect(Object.keys(tabla).filter((k) => !k.startsWith('_')).sort()).toEqual(publicas.sort())
  })

  for (const [funcion, lista] of Object.entries(tabla)) {
    if (funcion.startsWith('_')) continue
    for (const [args, op, esperado] of lista)
      it(`${funcion}(${JSON.stringify(args)}, ${JSON.stringify(op)})`, () => {
        expect(FUNCIONES[funcion](args, op)).toBe(esperado)
      })
  }

  it('el cero negativo de la tabla llega como cero negativo', () => {
    expect(tabla.fmt_num.some(([[v]]) => Object.is(v, -0))).toBe(true)
  })

  // Un navegador sin `useGrouping: 'always'` (Intl.NumberFormat v3) no agrupa
  // «6000» en es-ES: el respaldo pone el punto a mano.
  it('el respaldo sin «always» agrupa también las cuatro cifras', () => {
    expect(formato.agruparAMano('6000,00')).toBe('6.000,00')
    expect(formato.agruparAMano('1234567')).toBe('1.234.567')
    expect(formato.agruparAMano('999,5')).toBe('999,5')
    expect(formato.agruparAMano('0,0001')).toBe('0,0001')
  })
})
