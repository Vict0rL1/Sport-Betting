/**
 * Cómo se llama cada código para una persona (ítem 1.8, V6).
 *
 * La pantalla enseñaba «sin_datos», «analisis:03:09:37», «Mejor prevista:
 * revenue» o el chip «correlacion» sin tilde. El diccionario es UNO y vive en
 * el backend (`backend/app/etiquetas.py`); esto es su copia exportada
 * (`python -m app.etiquetas`), con los casos que el backend calcula para que
 * aquí se demuestre que se etiqueta igual. Términos: `docs/GLOSARIO.md`.
 */
import datos from './etiquetas.json'

const ETIQUETAS: Record<string, string> = datos.etiquetas
const CODIGO = /^[A-Za-z0-9_:]+$/
const SIGLA = /^[A-Z][A-Z0-9]{1,5}$/ // BPA, FCF, EBITDA
const ORIGEN = /^(?<tipo>[a-z_]+):(?<h>\d{2}):(?<m>\d{2})(?::\d{2})?$/
const ORIGENES: Record<string, string> = { analisis: 'análisis' }
const avisados = new Set<string>()

const mayusculaInicial = (texto: string) => texto.slice(0, 1).toUpperCase() + texto.slice(1)

/**
 * La etiqueta de un código: «gross_margin» → «margen bruto»; con `mayuscula`,
 * «Margen bruto». Un compuesto («gross_margin:ingresos») se etiqueta por
 * partes; lo que ya es texto se deja; un código desconocido sale legible y se
 * avisa en la consola, nunca en crudo.
 */
export function etiqueta(codigo: string | null | undefined, { mayuscula = false }: { mayuscula?: boolean } = {}): string {
  if (codigo === null || codigo === undefined || codigo === '') return '—'
  let texto: string
  // `hasOwn`, no `in`: «constructor» o «toString» están en cualquier objeto.
  if (Object.hasOwn(ETIQUETAS, codigo)) texto = ETIQUETAS[codigo]
  // Ya es texto, o una sigla («BPA», la métrica que extrae la IA, salía «Bpa»).
  else if (!CODIGO.test(codigo) || SIGLA.test(codigo)) texto = codigo
  else if (ORIGEN.test(codigo)) texto = etiquetaOrigen(codigo)
  else if (codigo.includes(':')) {
    const [cabeza, ...resto] = codigo.split(':')
    texto = `${etiqueta(cabeza)} (${resto.map((p) => etiqueta(p)).join(', ')})`
  } else {
    // eslint-disable-next-line no-restricted-syntax -- la reserva legible vive aquí
    texto = codigo.replace(/_/g, ' ').toLowerCase()
    if (!avisados.has(codigo)) {
      avisados.add(codigo)
      console.warn(`código sin etiqueta: «${codigo}» (añádelo a backend/app/etiquetas.py)`)
    }
  }
  return mayuscula ? mayusculaInicial(texto) : texto
}

/** «analisis:03:09:37» → «análisis de las 03:09 UTC». */
export function etiquetaOrigen(origen: string | null | undefined): string {
  const m = ORIGEN.exec(origen ?? '')
  if (!m?.groups) return origen ? etiqueta(origen) : '—'
  const { tipo, h, m: min } = m.groups
  // eslint-disable-next-line no-restricted-syntax -- la reserva legible vive aquí
  return `${ORIGENES[tipo] ?? tipo.replace(/_/g, ' ')} de las ${h}:${min} UTC`
}
