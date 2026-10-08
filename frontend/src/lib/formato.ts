/**
 * Una sola forma de escribir cifras para una persona (ítem 1.7: V4, V5, V8).
 *
 * Gemelo exacto de `backend/app/formato.py`: los dos se prueban contra la misma
 * tabla de casos (`formato.casos.json`) y dan la misma cadena. Un valor ausente
 * se escribe «—», nunca 0: la ausencia de dato es información.
 *
 * Por qué existe: «6000,00» salía encima de «20.000,00» en la misma columna
 * (es-ES no agrupa por defecto los números de cuatro cifras, V5), el backend
 * escribía «31.2 %» junto al «45,5 %» de aquí (V4) y un -0,0001 redondeado
 * salía «-0 %» (V8).
 */

export const GUION = '—'
const ESPACIO_DURO = '\u00a0'
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']

// Una hora de mercado lleva la zona de su bolsa: «16:00 ET» no es lo mismo que
// las 16:00 de quien lo lee.
const ETIQUETAS_ZONA: Record<string, string> = { 'America/New_York': 'ET', 'America/Toronto': 'ET', UTC: 'UTC' }

type Num = number | null | undefined

const finito = (v: Num): v is number => typeof v === 'number' && Number.isFinite(v)

const cacheFormatos = new Map<string, Intl.NumberFormat>()
function formato(min: number, max: number, agrupar: boolean): Intl.NumberFormat {
  const clave = `${min}|${max}|${agrupar ? 1 : 0}`
  let nf = cacheFormatos.get(clave)
  if (!nf) {
    nf = new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      useGrouping: agrupar ? 'always' : false,
    })
    cacheFormatos.set(clave, nf)
  }
  return nf
}

/** Punto de miles a mano: «6000,00» → «6.000,00». */
export function agruparAMano(texto: string): string {
  const [entera, decimal] = texto.split(',')
  const agrupada = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decimal === undefined ? agrupada : `${agrupada},${decimal}`
}

// `useGrouping: 'always'` es de Intl.NumberFormat v3; un navegador anterior lo
// toma como `true`, que en es-ES sigue sin agrupar «6000». Se comprueba una vez.
const AGRUPA_SIEMPRE = formato(0, 0, true).format(1000) === '1.000'

/** |valor| en es-ES, con los decimales entre `min` y `max`. */
function esEs(valor: number, min: number, max: number): string {
  if (AGRUPA_SIEMPRE) return formato(min, max, true).format(Math.abs(valor))
  return agruparAMano(formato(min, max, false).format(Math.abs(valor)))
}

function conSigno(valor: number, texto: string, signo: boolean): string {
  if (/^[0.,]+$/.test(texto)) return texto // -0,0001 redondeado es 0, no «-0,00» (V8)
  if (valor < 0) return `-${texto}`
  return (signo ? '+' : '') + texto
}

/**
 * 6000 → «6.000,00». `signo`: «+» delante de los positivos (variaciones).
 * `ceros: false`: hasta `decimales`, sin ceros a la derecha (1,50 → «1,5»),
 * para un umbral o un parámetro que se escribe tal cual es.
 */
export function fmtNum(
  valor: Num,
  decimales = 2,
  { signo = false, ceros = true }: { signo?: boolean; ceros?: boolean } = {},
): string {
  if (!finito(valor)) return GUION
  return conSigno(valor, esEs(valor, ceros ? decimales : 0, decimales), signo)
}

/** 0,123 → «12,3 %». Con `enPuntos`, el valor ya viene en puntos (12,3). */
export function fmtPct(
  valor: Num,
  decimales = 1,
  { signo = false, enPuntos = false, ceros = true }: { signo?: boolean; enPuntos?: boolean; ceros?: boolean } = {},
): string {
  if (!finito(valor)) return GUION
  return `${fmtNum(enPuntos ? valor : valor * 100, decimales, { signo, ceros })}${ESPACIO_DURO}%`
}

/** La forma que toca: «1 posición», «0 posiciones», «2 posiciones», nunca «posición(es)». */
export function plural(n: number, singular: string, plural: string): string {
  return n === 1 || n === -1 ? singular : plural
}

/** 6000 USD → «6.000,00 USD». Sin moneda conocida, solo la cifra. */
export function fmtDinero(
  valor: Num,
  moneda: string | null | undefined,
  decimales = 2,
  { signo = false }: { signo?: boolean } = {},
): string {
  if (!finito(valor)) return GUION
  const cifra = fmtNum(valor, decimales, { signo })
  return moneda ? `${cifra}${ESPACIO_DURO}${moneda}` : cifra
}

/**
 * El valor de un `<input type="number">`: el navegador lo exige con punto
 * decimal y sin miles («12.5»), sea cual sea el idioma. No es texto para leer;
 * está aquí para que sea el único `toFixed` del código.
 */
export function valorDeCampo(valor: number, decimales: number): string {
  return valor.toFixed(decimales)
}

/** Hasta `max` decimales, sin ceros a la derecha: 400,0 → «400». */
const corto = (valor: number, max: number) => fmtNum(valor, max, { ceros: false })

/**
 * Cifras grandes en M (millones) y mil M (miles de millones). Nunca «B»: en
 * inglés es mil millones y en español un billón.
 */
export function fmtCompacto(valor: Num, moneda?: string | null): string {
  if (!finito(valor)) return GUION
  const a = Math.abs(valor)
  const cifra =
    a >= 1e9
      ? `${corto(valor / 1e9, 1)}${ESPACIO_DURO}mil${ESPACIO_DURO}M`
      : a >= 1e6
        ? `${corto(valor / 1e6, 1)}${ESPACIO_DURO}M`
        : corto(valor, 2)
  return moneda ? `${cifra}${ESPACIO_DURO}${moneda}` : cifra
}

type Fecha = { dia: true; y: number; m: number; d: number } | { dia: false; t: Date }

/** Un día suelto o un instante. Un instante sin zona es UTC, como en el backend
 *  (`new Date('2026-09-12T14:35:00')` lo tomaría como hora local). */
function aFecha(valor: string | Date | null | undefined): Fecha | null {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : { dia: false, t: valor }
  if (!valor) return null
  const texto = valor.trim()
  const dia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
  if (dia) return { dia: true, y: Number(dia[1]), m: Number(dia[2]), d: Number(dia[3]) }
  const conZona = /(?:Z|[+-]\d{2}:?\d{2})$/.test(texto) ? texto : `${texto}Z`
  const t = new Date(conZona)
  return Number.isNaN(t.getTime()) ? null : { dia: false, t }
}

/**
 * «6 oct 2026» o, con `hora`, «12 sept 2026, 10:35 ET». Un día suelto no se
 * mueve de zona. Un instante se pasa a `zona` (la del navegador si no se da) y,
 * si es la de una bolsa, se rotula. Lo que no se lee como fecha, tal cual.
 */
export function fmtFecha(
  valor: string | Date | null | undefined,
  { hora = false, zona }: { hora?: boolean; zona?: string } = {},
): string {
  if (valor === null || valor === undefined || valor === '') return GUION
  const f = aFecha(valor)
  if (!f) return String(valor)
  if (f.dia) return `${f.d} ${MESES[f.m - 1]} ${f.y}`
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(f.t)
      .map((p) => [p.type, p.value]),
  )
  const dia = `${Number(partes.day)} ${MESES[Number(partes.month) - 1]} ${partes.year}`
  if (!hora) return dia
  const etiqueta = zona ? ETIQUETAS_ZONA[zona] : undefined
  return `${dia}, ${partes.hour}:${partes.minute}${etiqueta ? `${ESPACIO_DURO}${etiqueta}` : ''}`
}

/** «hace 15 min». */
export function fmtAntiguedad(valor: string | Date | null | undefined, ahora: Date = new Date()): string {
  const f = aFecha(valor)
  if (!f || f.dia) return GUION
  const minutos = Math.floor((ahora.getTime() - f.t.getTime()) / 60000 + 0.5)
  // Unos segundos de desfase de reloj entre el servidor y el navegador no son «el futuro».
  if (minutos < 1) return 'hace segundos'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60 + 0.5)
  if (horas < 48) return `hace ${horas} h`
  return `hace ${Math.floor(horas / 24 + 0.5)} días`
}
