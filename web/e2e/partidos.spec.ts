// El explorador de partidos (rediseño de noviembre): los recorridos 1, 2, 3, 7, 8 y 9 del encargo con
// datos SINTÉTICOS (se sirve /api/partidos desde aquí, partidos inventados y marcados como tales en
// los nombres). Lo de seguir un partido va contra el servidor de verdad (base de demostración).
import { test, expect, type Page } from '@playwright/test';
import { recogerErrores } from './util';

const ZONA = 'Europe/Madrid';
// Sin service worker: las respuestas son las de este fichero, no una copia de la caché.
test.use({ timezoneId: ZONA, locale: 'es-ES', serviceWorkers: 'block' });

/** El día de hoy EN MADRID (YYYY-MM-DD), que es el que corta «Hoy» en la página. */
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const MANANA_DIA = (() => {
  const [y, m, d] = HOY.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
})();

/** Ese día de Madrid a una hora local, en ISO UTC (con el desfase de Madrid de ese momento). */
function hoyA(h: number, m = 0, dias = 0): string {
  const [y, mes, d] = HOY.split('-').map(Number);
  const aprox = new Date(Date.UTC(y, mes - 1, d + dias, h, m));
  const enMadrid = new Date(aprox.toLocaleString('en-US', { timeZone: ZONA }));
  const enUtc = new Date(aprox.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(aprox.getTime() - (enMadrid.getTime() - enUtc.getTime())).toISOString();
}

type Fila = Record<string, unknown>;
function fila(over: Fila): Fila {
  return {
    sport: 'football',
    id: 'x',
    matchKey: null,
    liga: { id: 'laliga', nombre: 'LaLiga' },
    torneo: null,
    cuando: hoyA(21),
    empezado: false,
    local: { nombre: 'Local Sintético', id: 'loc' },
    visitante: { nombre: 'Visitante Sintético', id: 'vis' },
    sede: 'local',
    mercado: { id: 'resultado', resultados: ['local', 'empate', 'visitante'], excluyentes: true, prorroga: 'no' },
    prediccion: { probs: [0.5, 0.25, 0.25], capturadaEn: hoyA(8), version: 'fb-test', fuente: 'instantanea' },
    sinPrediccion: null,
    cuotas: null,
    origen: 'real',
    ...over,
  };
}

const FILAS = [
  fila({ id: 'fb-1', matchKey: 'laliga|a|b|e2e', local: { nombre: 'Atlético Sintético de la Ciudad con Nombre Muy Largo', id: 'a' }, visitante: { nombre: 'Betis Sintético', id: 'b' }, prediccion: { probs: [0.579, 0.201, 0.22], capturadaEn: hoyA(8), version: 'fb-test', fuente: 'instantanea' } }),
  fila({ id: 'fb-2', liga: { id: 'epl', nombre: 'Premier League' }, cuando: hoyA(18), local: { nombre: 'Arsenal Sintético', id: 'ars' }, visitante: { nombre: 'Chelsea Sintético', id: 'che' }, cuotas: { precios: [2.1, 3.3, 3.6], completas: true, casas: 8, recibidasEn: hoyA(9), origen: 'casa', antiguas: false } }),
  fila({ id: 'fixture-demo', origen: 'demo', cuando: hoyA(19), local: { nombre: 'Demo Uno', id: 'd1' }, visitante: { nombre: 'Demo Dos', id: 'd2' }, cuotas: { precios: [1.8, 3.5, 4.5], completas: true, casas: 0, recibidasEn: hoyA(9), origen: 'demo', antiguas: false } }),
  fila({ id: 'fixture-demo-sin', origen: 'demo', cuando: hoyA(19, 30), local: { nombre: 'Demo Tres', id: 'd3' }, visitante: { nombre: 'Demo Cuatro', id: 'd4' }, prediccion: null, sinPrediccion: 'demo' }),
  fila({ id: 'fb-sin', cuando: hoyA(20), local: { nombre: 'Sin Estimación FC', id: 's1' }, visitante: { nombre: 'Otro FC', id: 's2' }, prediccion: null, sinPrediccion: 'sin-registro' }),
  fila({ sport: 'nhl', id: 'nhl-1', matchKey: 'nhl|e2e|1', liga: { id: 'nhl', nombre: 'NHL' }, cuando: hoyA(22), local: { nombre: 'Toronto Sintético', id: 'TOR' }, visitante: { nombre: 'Boston Sintético', id: 'BOS' }, mercado: { id: 'resultado', resultados: ['local', 'visitante'], excluyentes: true, prorroga: 'incluida' }, prediccion: { probs: [0.62, 0.38], capturadaEn: hoyA(8), version: 'nhl-test', fuente: 'registro' } }),
];
const MANANA = [fila({ id: 'fb-m', cuando: hoyA(17, 0, 1), local: { nombre: 'Mañana Sintético', id: 'm1' }, visitante: { nombre: 'Rival de Mañana', id: 'm2' } })];

function respuesta(filas: Fila[]) {
  const porDeporte = ['football', 'basketball', 'baseball', 'nfl', 'nhl', 'ufc', 'tennis'].map((sport) => ({ sport, filas: filas.filter((f) => f.sport === sport).length, error: null }));
  return { generado: new Date().toISOString(), desde: hoyA(0), hasta: hoyA(0, 0, 7), filas, cuarentena: { n: 0, ejemplos: [] }, duplicados: 0, porDeporte };
}

async function servir(page: Page, opciones: { retrasoHoyMs?: number; fallar?: () => boolean } = {}) {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  await page.route('**/api/partidos?*', async (r) => {
    if (opciones.fallar?.()) return r.fulfill({ status: 500, json: { error: 'caído' } });
    const url = new URL(r.request().url());
    const dia = url.searchParams.get('dia');
    if (dia === MANANA_DIA) return r.fulfill({ json: respuesta(MANANA) });
    if (dia && opciones.retrasoHoyMs) await new Promise((ok) => setTimeout(ok, opciones.retrasoHoyMs));
    if (dia && dia !== HOY) return r.fulfill({ json: respuesta([]) });
    return r.fulfill({ json: respuesta(FILAS) });
  });
}

test('recorrido 1: deporte, día y liga en la URL; abrir un partido y volver deja los filtros', async ({ page }) => {
  await servir(page);
  const errores = recogerErrores(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/partidos$/);
  await expect(page.getByRole('heading', { name: 'Partidos', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.getByRole('group', { name: 'Deporte' }).getByRole('button', { name: /Fútbol/ }).click();
  await expect(page).toHaveURL(/deporte=football/);
  await page.getByRole('combobox').filter({ hasText: 'Todas las competiciones' }).selectOption('epl');
  await expect(page).toHaveURL(/liga=epl/);
  await expect(page.locator('main [role=status]').first()).toContainText(/^1 partido\b/);
  await page.getByRole('link', { name: /Arsenal Sintético – Chelsea Sintético/ }).click();
  await expect(page).toHaveURL(/\/partido\/football\/fb-2/);
  await page.goBack();
  await expect(page).toHaveURL(/deporte=football.*liga=epl|liga=epl.*deporte=football/);
  await expect(page.getByRole('link', { name: /Arsenal Sintético/ })).toBeVisible();
  // «Quitar filtros» vuelve a todos.
  await page.getByRole('button', { name: 'Quitar filtros' }).first().click();
  await expect(page.getByRole('link', { name: /Toronto Sintético/ })).toBeVisible();
  expect(errores.filter((e) => !/partido\/football\/fb-2|404|Failed to load resource/.test(e))).toEqual([]);
});

test('recorrido 3: demostración, sin estimación, 1X2 con empate y NHL sin empate se distinguen', async ({ page }) => {
  await servir(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/partidos');
  const demo = page.getByRole('listitem').filter({ hasText: 'Demo Uno' });
  await expect(demo.getByText('Demostración', { exact: true })).toBeVisible();
  await expect(page.getByText(/no son reales, sus cuotas tampoco/)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Sin Estimación FC' }).getByText('Sin estimación registrada todavía')).toBeVisible();
  // Una de demostración sin estimación dice dónde está, no «todavía» (revisión ui-tester).
  await expect(page.getByRole('listitem').filter({ hasText: 'Demo Tres' }).getByText(/la ficha la calcula al abrirla/)).toBeVisible();
  const futbol = page.getByRole('listitem').filter({ hasText: 'Atlético Sintético' });
  await expect(futbol.getByText('Empate')).toBeVisible();
  // T06: 57,9 + 20,1 + 22,0 = 100.
  await expect(futbol).toContainText('57,9 %');
  await expect(futbol).toContainText('20,1 %');
  await expect(futbol).toContainText('22,0 %');
  const nhl = page.getByRole('listitem').filter({ hasText: 'Toronto Sintético' });
  await expect(nhl.getByText('Empate')).toHaveCount(0);
  await expect(nhl).toContainText('62,0 %');
  await expect(page.getByText(/Quién gana · con prórroga/)).toBeVisible();
  // Sin columnas de cuotas vacías en la lista.
  await expect(page.locator('main').getByText('—', { exact: true })).toHaveCount(0);
});

test('recorrido 7: sin resultados por filtro, día vacío, fallo del proveedor y reintento', async ({ page }) => {
  let caido = false;
  await servir(page, { fallar: () => caido });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/partidos?q=nadaquecoincida');
  await expect(page.getByText('Ningún partido con estos filtros.')).toBeVisible();
  await page.getByRole('button', { name: 'Quitar filtros' }).last().click();
  await expect(page.getByRole('link', { name: /Toronto Sintético/ })).toBeVisible();
  await page.goto('/partidos?dia=2031-01-01');
  await expect(page.getByText(/No hay partidos programados el /)).toBeVisible();
  caido = true;
  await page.goto('/partidos');
  await expect(page.getByText('No se pudo cargar la lista de partidos.')).toBeVisible();
  caido = false;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('link', { name: /Toronto Sintético/ })).toBeVisible();
  // Nombres largos sin desbordar a 390 px.
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ancho).toBeLessThanOrEqual(1);
});

test('T17: una respuesta tardía de «Hoy» no pisa la de «Mañana»', async ({ page }) => {
  await servir(page, { retrasoHoyMs: 1500 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/partidos?dia=manana');
  await expect(page.getByRole('link', { name: /Mañana Sintético/ })).toBeVisible();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.getByRole('button', { name: 'Mañana', exact: true }).click();
  await page.waitForTimeout(2000);
  await expect(page.getByRole('link', { name: /Mañana Sintético/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Toronto Sintético/ })).toHaveCount(0);
});

test('recorrido 8: con el teclado se abre un partido y «atrás» vuelve a la lista', async ({ page }) => {
  await servir(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/partidos?deporte=nhl');
  const enlace = page.getByRole('link', { name: /Toronto Sintético – Boston Sintético/ });
  await enlace.focus();
  await expect(enlace).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/partido\/nhl\/nhl-1/);
  await page.goBack();
  await expect(page).toHaveURL(/deporte=nhl/);
  await expect(page.getByRole('link', { name: /Toronto Sintético/ })).toBeVisible();
});

test('recorrido 9: a 320 px la página refluye sin desplazamiento horizontal', async ({ page }) => {
  await servir(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/partidos');
  await expect(page.getByRole('link', { name: /Toronto Sintético/ })).toBeVisible();
  const ancho = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(ancho).toBeLessThanOrEqual(1);
});

test('recorrido 2: seguir un partido, recargar, encontrarlo en «Guardados» y dejar de seguirlo', async ({ page }) => {
  await servir(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/partidos');
  const fila = page.getByRole('listitem').filter({ hasText: 'Toronto Sintético' });
  const campana = fila.getByRole('button', { name: /Seguir/ });
  await campana.click();
  await expect(fila.getByRole('button', { name: /Dejar de seguir/ })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.getByRole('button', { name: 'Guardados' }).click();
  await expect(page).toHaveURL(/guardados=1/);
  await expect(page.getByRole('link', { name: /Toronto Sintético/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Arsenal Sintético/ })).toHaveCount(0);
  await page.getByRole('listitem').filter({ hasText: 'Toronto Sintético' }).getByRole('button', { name: /Dejar de seguir/ }).click();
  await expect(page.getByText('Ningún partido con estos filtros.')).toBeVisible();
});

test('T24: si guardar falla, no se finge el guardado y se puede reintentar', async ({ page }) => {
  await servir(page);
  let fallar = true;
  await page.route('**/api/watchlist', (r) => (r.request().method() === 'POST' && fallar ? r.fulfill({ status: 500, json: { error: 'no' } }) : r.continue()));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/partidos?deporte=football');
  const fila = page.getByRole('listitem').filter({ hasText: 'Atlético Sintético' });
  await fila.getByRole('button', { name: /^Seguir/ }).click();
  const boton = fila.getByRole('button', { name: /No se pudo guardar/ });
  await expect(boton).toBeVisible();
  await expect(boton).toHaveAttribute('aria-pressed', 'false');
  fallar = false;
  await boton.click();
  await expect(fila.getByRole('button', { name: /Dejar de seguir/ })).toHaveAttribute('aria-pressed', 'true');
  // Se deja como estaba para los demás tests.
  await fila.getByRole('button', { name: /Dejar de seguir/ }).click();
  await expect(fila.getByRole('button', { name: /^Seguir/ })).toBeVisible();
});
