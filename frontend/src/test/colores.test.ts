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

const fuentes = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../lib/tokens.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b/g

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
})
