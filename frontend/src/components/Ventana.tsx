/**
 * La ventana REAL de un crecimiento anual compuesto: «2A», y «parcial» si es más
 * corta que la nominal.
 *
 * El informe ponía «Ingresos 5A: 10 %» con dos ejercicios de historia (V18): el
 * CAGR era de un año y la etiqueta prometía cinco. Una cifra con una ventana
 * falsa se compara con otras que sí significan lo que dicen. El backend manda la
 * ventana usada (`years`); esto la enseña y avisa cuando no llega a la completa.
 */
import { plural } from '../lib/formato'

export const VENTANA_NOMINAL = 5

export function Ventana({ anos, nominal = VENTANA_NOMINAL }: { anos: number; nominal?: number }) {
  if (anos < 1) return <span>sin historia</span>
  const parcial = anos < nominal
  return (
    <span
      title={
        parcial
          ? `Solo hay ${anos} ${plural(anos, 'año', 'años')} de historia; la ventana completa es de ${nominal}.`
          : undefined
      }
    >
      {anos}A{parcial && <span className="ml-1 text-[10px] text-amber-800">parcial</span>}
    </span>
  )
}
