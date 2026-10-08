/**
 * Capturas repetibles de todas las pantallas (ítem 0.6 del plan de correcciones).
 *
 *     npm run capturas -- <carpeta-de-salida> [--escenarios normal,con_ia] [--solo 01_hoy,13_cartera]
 *
 * Una orden lo regenera todo: compila el frontend, levanta por escenario el
 * backend de demostración (`backend/tests/fixtures/servidor_demo.py`, datos
 * ficticios del paquete de casos extremos y una base temporal: nunca tu
 * app.db), sirve el build con `vite preview` y fotografía cada pantalla a
 * 1440 px y a 390 px. Usa su propio puerto (8077) y no pisa la app si la
 * tienes abierta.
 *
 * Salida: <carpeta>/<escenario>/<pantalla>_<ancho>.png. El conjunto «antes» del
 * plan está en docs/revision/.
 *
 * Requisitos: el entorno de Python del backend y el Chromium de Playwright
 * (`npx playwright install chromium` la primera vez).
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = resolve(RAIZ, '..', 'backend')
const PUERTO_API = 8077
const PUERTO_WEB = 4177
const WEB = `http://127.0.0.1:${PUERTO_WEB}`
const ALTO_MAXIMO = 4000
// El backend de demostración congela su reloj en este instante (el `AHORA` del
// paquete de casos extremos); el navegador también, o «hace X días» cambiaría
// cada día y dos capturas del mismo estado no coincidirían.
const AHORA = new Date('2026-09-12T14:40:00Z')
const CARGANDO = /Cargando|Analizando|Calculando…|Calculando\.\.\.|Redactando|Interpretando|Resumiendo/

const ANCHOS = [
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, movil: false },
  { sufijo: '390', viewport: { width: 390, height: 844 }, movil: true },
]

type Pantalla = { nombre: string; ruta: string; pestana?: string; accion?: (p: Page) => Promise<void> }

const PESTANAS_FICHA: [string, string][] = [
  ['03_ficha_resumen', 'Resumen'],
  ['04_ficha_informe', 'Informe completo'],
  ['05_ficha_fundamentales', 'Fundamentales'],
  ['06_ficha_valoracion', 'Valoración'],
  ['07_ficha_salud', 'Salud y riesgo'],
  ['08_ficha_que_cambio', 'Qué cambió'],
  ['09_ficha_expectativas', 'Resultados vs expectativas'],
  ['10_ficha_calidad', 'Calidad de beneficios'],
  ['11_ficha_historial', 'Decisiones y replay'],
  ['12_ficha_opciones', 'Opciones'],
  ['12b_ficha_filings', 'Filings'],
]

const ficha = (symbol: string, cuales?: string[]): Pantalla[] =>
  PESTANAS_FICHA.filter(([n]) => !cuales || cuales.includes(n)).map(([nombre, pestana]) => ({
    nombre,
    ruta: `/ticker/${symbol}`,
    pestana,
  }))

const pulsar = (texto: RegExp) => async (p: Page) => {
  const boton = p.getByRole('button', { name: texto }).first()
  if (await boton.count()) {
    // `force`: en 390 px la barra lateral tapa el contenido (V2) y el clic
    // normal espera para siempre a que el botón quede libre.
    await boton.click({ force: true, timeout: 10000 })
    await esperar(p)
  }
}

const TODAS: Pantalla[] = [
  { nombre: '01_hoy', ruta: '/hoy' },
  { nombre: '02_mercado', ruta: '/dashboard' },
  ...ficha('ACME'),
  { nombre: '13_cartera', ruta: '/cartera' },
  { nombre: '14_portafolio', ruta: '/portafolio' },
  { nombre: '15_tesis', ruta: '/tesis' },
  { nombre: '16_vigilancia', ruta: '/vigilancia' },
  { nombre: '17_valoracion_modulo', ruta: '/valoracion' },
  { nombre: '18_screener', ruta: '/screener' },
  { nombre: '19_multifactor', ruta: '/multifactor' },
  { nombre: '20_resultados', ruta: '/resultados' },
  { nombre: '21_senales', ruta: '/senales' },
  { nombre: '22_etfs', ruta: '/etfs' },
  { nombre: '23_noticias', ruta: '/noticias' },
]

const ESCENARIOS: Record<string, Pantalla[]> = {
  normal: TODAS,
  cartera_vacia: TODAS.filter((p) => ['01_hoy', '13_cartera', '14_portafolio'].includes(p.nombre)),
  sin_candidatas: TODAS.filter((p) => p.nombre === '01_hoy'),
  empresa_sin_datos: ficha('VACIA', [
    '03_ficha_resumen', '04_ficha_informe', '06_ficha_valoracion', '07_ficha_salud',
    '08_ficha_que_cambio', '10_ficha_calidad', '11_ficha_historial',
  ]),
  con_ia: [
    { nombre: '04_ficha_informe_ia', ruta: '/ticker/ACME', pestana: 'Informe completo', accion: pulsar(/Redactar informe \(IA\)/) },
    { nombre: '08_ficha_que_cambio_ia', ruta: '/ticker/ACME', pestana: 'Qué cambió', accion: pulsar(/Resumir este diff con IA/) },
    { nombre: '23_noticias_ia', ruta: '/noticias', accion: pulsar(/Por qué importa\? \(IA\)/) },
  ],
}

async function esperar(p: Page) {
  await p.waitForLoadState('networkidle').catch(() => {})
  await p
    .waitForFunction((re) => !new RegExp(re).test(document.body.innerText), CARGANDO.source, { timeout: 8000 })
    .catch(() => {})
  await p.waitForTimeout(400)
}

async function fotografiar(navegador: Browser, pantallas: Pantalla[], carpeta: string, solo?: string[]) {
  for (const ancho of ANCHOS) {
    const contexto = await navegador.newContext({
      viewport: ancho.viewport,
      isMobile: ancho.movil,
      deviceScaleFactor: ancho.movil ? 2 : 1,
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
    })
    await contexto.clock.setFixedTime(AHORA)
    const p = await contexto.newPage()
    for (const pantalla of pantallas) {
      if (solo && !solo.some((s) => pantalla.nombre.startsWith(s))) continue
      const archivo = join(carpeta, `${pantalla.nombre}_${ancho.sufijo}.png`)
      try {
        await p.goto(WEB + pantalla.ruta, { waitUntil: 'networkidle', timeout: 30000 })
        await esperar(p)
        if (pantalla.pestana) {
          await p.getByRole('button', { name: pantalla.pestana, exact: true }).click()
          await esperar(p)
        }
        if (pantalla.accion) await pantalla.accion(p)
        const alto = await p.evaluate(() => document.documentElement.scrollHeight)
        await p.screenshot({
          path: archivo,
          fullPage: alto <= ALTO_MAXIMO,
          clip: alto > ALTO_MAXIMO ? { x: 0, y: 0, width: ancho.viewport.width, height: ALTO_MAXIMO } : undefined,
        })
        console.log(`  ✓ ${archivo}`)
      } catch (e) {
        console.log(`  ✗ ${archivo}: ${String(e).split('\n')[0]}`)
      }
    }
    await contexto.close()
  }
}

async function hastaQueResponda(url: string, segundos = 90) {
  for (let i = 0; i < segundos * 2; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} no respondió en ${segundos} s`)
}

function arrancar(orden: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(orden, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'], detached: true })
}

function parar(hijo: ChildProcess | null) {
  // Por grupo de procesos: el backend y el servidor web tienen hijos propios.
  if (hijo?.pid) {
    try {
      process.kill(-hijo.pid, 'SIGTERM')
    } catch {
      /* ya terminó */
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const salida = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
  if (!salida) {
    console.error('Uso: npm run capturas -- <carpeta-de-salida> [--escenarios normal,con_ia] [--solo 01_hoy]')
    process.exit(2)
  }
  const valor = (bandera: string) => (args.includes(bandera) ? args[args.indexOf(bandera) + 1]?.split(',') : undefined)
  const escenarios = valor('--escenarios') ?? Object.keys(ESCENARIOS)
  const solo = valor('--solo')
  const python =
    process.env.PYTHON ?? (existsSync(join(BACKEND, '.venv', 'bin', 'python')) ? join(BACKEND, '.venv', 'bin', 'python') : 'python3')

  console.log('Compilando el frontend…')
  execSync('npx vite build', { cwd: RAIZ, stdio: 'ignore' })
  const web = arrancar('npx', ['vite', 'preview', '--port', String(PUERTO_WEB), '--strictPort', '--host', '127.0.0.1'], RAIZ, {
    API_URL: `http://127.0.0.1:${PUERTO_API}`,
  })
  let api: ChildProcess | null = null
  const navegador = await chromium.launch()
  try {
    await hastaQueResponda(WEB)
    for (const escenario of escenarios) {
      if (!ESCENARIOS[escenario]) throw new Error(`Escenario desconocido: ${escenario}`)
      console.log(`Escenario «${escenario}»`)
      api = arrancar(python, ['-m', 'tests.fixtures.servidor_demo', '--escenario', escenario, '--puerto', String(PUERTO_API)], BACKEND)
      await hastaQueResponda(`http://127.0.0.1:${PUERTO_API}/api/meta/llm`)
      const carpeta = resolve(salida, escenario)
      mkdirSync(carpeta, { recursive: true })
      await fotografiar(navegador, ESCENARIOS[escenario], carpeta, solo)
      parar(api)
      api = null
      await new Promise((r) => setTimeout(r, 800))
    }
  } finally {
    await navegador.close()
    parar(api)
    parar(web)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
