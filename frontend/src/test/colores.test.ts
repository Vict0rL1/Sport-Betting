/**
 * Ningún color escrito a mano en el código (ítem 1.2, V1).
 *
 * El gráfico de precios llevaba los colores del tema claro (#f1f5f9 en la
 * rejilla, #a7f3d0 y #fecaca en el volumen) y salía con rejilla blanca y un
 * bloque verde menta sobre fondo oscuro: lo que se dibuja en un canvas no pasa
 * por la inversión de paleta de `index.css`. El plan pedía prohibir los tonos
 * claros (50–200); esto prohíbe cualquier hexadecimal, que es lo que hizo
 * falta: un color o es un token (`leerToken`, `var(--…)`) o una clase de
 * Tailwind que la paleta del tema controla. Los tests y `tokens.ts` (que los
 * documenta en sus comentarios) quedan fuera.
 */
import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'

const fuentes = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../lib/tokens.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g

// Los tonos que `index.css` redefine para el tema oscuro («emerald-100», …).
const INVERTIDOS = new Set([...css.matchAll(/--color-([a-z]+-\d+):/g)].map((m) => m[1]))

describe('colores', () => {
  it('se recorre el código de verdad', () => {
    expect(Object.keys(fuentes).length).toBeGreaterThan(40)
    expect(Object.keys(fuentes)).toContain('../components/PriceChart.tsx')
  })

  it('ningún fichero del código escribe un color en hexadecimal', () => {
    const malos: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes)) {
      texto.split('\n').forEach((linea, i) => {
        // Las entidades HTML (`&#8203;`) no son colores.
        for (const m of linea.matchAll(HEX)) if (linea[(m.index ?? 0) - 1] !== '&') malos.push(`${ruta}:${i + 1} ${m[0]}`)
      })
    }
    expect(malos).toEqual([])
  })

  // V9: `bg-violet-50` estaba fuera de la inversión y las etiquetas de IA salían
  // como manchas blancas con el texto casi invisible. Un fondo claro (50/100)
  // solo vale si `index.css` lo invierte.
  it('ningún fondo claro queda fuera de la inversión de paleta', () => {
    expect(INVERTIDOS.has('emerald-100') && INVERTIDOS.has('slate-50')).toBe(true)
    const malos: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes))
      for (const m of texto.matchAll(/\b(?:bg|from|via|to)-([a-z]+)-(50|100)\b/g))
        if (!INVERTIDOS.has(`${m[1]}-${m[2]}`)) malos.push(`${ruta}: ${m[0]}`)
    expect(malos).toEqual([])
  })

  // El reflejo de V9: un texto oscuro (700–950) que la inversión no aclara queda
  // ilegible sobre fondo oscuro. `text-sky-950` dejaba invisible el coste
  // estimado antes de gastar en IA (Resultados); `text-amber-700`, 3,45:1.
  it('ningún texto oscuro queda fuera de la inversión de paleta', () => {
    const malos: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes))
      for (const m of texto.matchAll(/\btext-([a-z]+)-(700|800|900|950)\b/g))
        if (!INVERTIDOS.has(`${m[1]}-${m[2]}`)) malos.push(`${ruta}: ${m[0]}`)
    expect(malos).toEqual([])
  })

  it('lo generado por IA solo se pinta con ContenidoIA (tokens --ai), nunca con clases violeta sueltas', () => {
    const malos = Object.entries(fuentes)
      .flatMap(([ruta, texto]) => [...texto.matchAll(/\b[a-z:]*-violet-\d+\b/g)].map((m) => `${ruta}: ${m[0]}`))
    expect(malos).toEqual([])
  })
})
