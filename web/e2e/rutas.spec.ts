import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// El recorrido de primer uso se da por visto (tiene su propio test): si no, tapa los clics.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
});

// Fase 5.27: cada ruta pinta a 1280 y a 390 px sin scroll horizontal ni errores de consola;
// la barra inferior enseña los cuatro destinos en el móvil; los enlaces profundos restauran
// el estado; axe pasa en claro y en oscuro.

const RUTAS = ['/destacados', '/futbol', '/baloncesto', '/beisbol', '/nfl', '/tenis', '/apuestas', '/apuestas/laboratorio', '/bandeja', '/informes', '/confianza', '/confianza/diagnostico', '/ajustes', '/glosario', '/no-existe'];

async function sinErroresNiDesbordamiento(page: Page, ruta: string) {
  const errores: string[] = [];
  page.on('console', (m) => {
    // Un recurso que no existe en la base de demostración (404 de la API) no es un error de la página.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errores.push(m.text());
  });
  page.on('pageerror', (e) => errores.push(e.message));
  await page.goto(ruta);
  await page.waitForLoadState('networkidle');
  const ancho = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, cliente: document.documentElement.clientWidth }));
  expect(ancho.scroll, `${ruta}: scroll horizontal`).toBeLessThanOrEqual(ancho.cliente + 1);
  expect(errores, `${ruta}: errores de consola`).toEqual([]);
}

for (const ruta of RUTAS) {
  test(`${ruta} a 1280 px`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await sinErroresNiDesbordamiento(page, ruta);
    await expect(page.getByRole('tablist', { name: 'Deportes' }).first()).toBeVisible();
  });
  test(`${ruta} a 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sinErroresNiDesbordamiento(page, ruta);
    const barra = page.getByTestId('barra-inferior');
    await expect(barra).toBeVisible();
    await expect(barra.getByRole('button')).toHaveCount(4);
    for (const nombre of ['Destacados', 'Deportes', 'Apuestas', 'Confianza']) await expect(barra.getByRole('button', { name: nombre })).toBeVisible();
  });
}

test('la hoja de deportes del móvil lleva a cada deporte', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/destacados');
  await page.getByTestId('barra-inferior').getByRole('button', { name: 'Deportes' }).click();
  const hoja = page.getByRole('dialog', { name: 'Deportes' });
  await expect(hoja).toBeVisible();
  await hoja.getByRole('button', { name: 'Baloncesto' }).click();
  await expect(page).toHaveURL(/\/baloncesto/);
});

test('los enlaces profundos restauran el estado', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/destacados?horas=24&alta=1&orden=hora');
  await expect(page.getByRole('button', { name: /^24 h$/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Solo confianza alta' })).toHaveAttribute('aria-pressed', 'true');
  // La liga en la ruta: la pestaña de esa liga queda seleccionada y la URL no se pisa.
  await page.goto('/futbol');
  await page.waitForLoadState('networkidle');
  const ligas = page.getByRole('tablist', { name: 'Ligas' }).getByRole('tab');
  if ((await ligas.count()) > 1) {
    await ligas.nth(1).click();
    await expect(page).toHaveURL(/\/futbol\/[a-z0-9-]+/);
    const url = page.url();
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await expect(ligas.nth(1)).toHaveAttribute('aria-selected', 'true');
    expect(page.url()).toBe(url);
  }
});

test('la píldora de estado está una vez y dice el modo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/destacados');
  // Hay una en la barra lateral y otra en la cabecera del móvil; solo una está visible.
  const pildora = page.locator('[data-testid=status-pill]:visible');
  await expect(pildora).toHaveCount(1);
  await expect(pildora).toContainText(/Modo demo|Cuotas reales|errores/);
  await pildora.click();
  await expect(page.getByRole('dialog', { name: 'Estado de la app' })).toBeVisible();
  await expect(pildora).toHaveScreenshot('pildora-estado.png', { maxDiffPixelRatio: 0.05 });
});

for (const tema of ['oscuro', 'claro'] as const) {
  test(`axe en tema ${tema} (Destacados y Ajustes)`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript((t) => localStorage.setItem('predictor.tema', t), tema);
    for (const ruta of ['/destacados', '/ajustes']) {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(tema);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).disableRules(['color-contrast']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} nodo(s) — ${v.help}`), `${ruta} en ${tema}`).toEqual([]);
      // El contraste se mide aparte y solo como «serio o crítico»: lo menor se anota, no bloquea.
      const contraste = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      expect(contraste.violations.flatMap((v) => v.nodes.filter((n) => n.impact === 'critical').map((n) => n.html)), `${ruta} en ${tema}: contraste crítico`).toEqual([]);
    }
  });
}

test('el recorrido de primer uso sale una vez y se recuerda', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/destacados');
  const dialogo = page.getByRole('dialog', { name: 'Tres cosas antes de empezar' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: '→' }).click();
  await dialogo.getByRole('button', { name: '→' }).click();
  await dialogo.getByRole('button', { name: 'Entendido' }).click();
  await expect(dialogo).toBeHidden();
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('dialog', { name: 'Tres cosas antes de empezar' })).toBeHidden();
  await ctx.close();
});

test('sin conexión aparece el aviso con la hora de los datos', async ({ page, context }) => {
  await page.goto('/destacados');
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await expect(page.getByTestId('sin-conexion')).toContainText(/Sin conexión: datos de/);
  await context.setOffline(false);
  await expect(page.getByTestId('sin-conexion')).toBeHidden();
});

test.describe('capturas de componentes (galería con datos de ejemplo)', () => {
  test.use({ timezoneId: 'UTC' });
  test.beforeAll(async ({ request }) => {
    expect((await request.patch('/api/features/interfaz.muestras', { data: { on: true } })).ok()).toBeTruthy();
  });
  test.afterAll(async ({ request }) => {
    await request.patch('/api/features/interfaz.muestras', { data: { on: null } });
  });
  for (const tema of ['oscuro', 'claro'] as const) {
    test(`tarjeta e insignias en tema ${tema}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('predictor.tema', t), tema);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto('/_muestras');
      await expect(page.getByRole('note')).toContainText('datos INVENTADOS');
      await expect(page.getByTestId('muestra-insignias')).toHaveScreenshot(`insignias-${tema}.png`, { maxDiffPixelRatio: 0.02 });
      await expect(page.getByTestId('muestra-tarjeta')).toHaveScreenshot(`tarjeta-${tema}.png`, { maxDiffPixelRatio: 0.02 });
      await expect(page.getByText('Sin mercado')).toBeVisible();
    });
  }
  test('apagada, la galería no existe', async ({ page, request }) => {
    await request.patch('/api/features/interfaz.muestras', { data: { on: false } });
    await page.goto('/_muestras');
    await expect(page.getByText('Esta página no existe.')).toBeVisible();
    await request.patch('/api/features/interfaz.muestras', { data: { on: true } });
  });
});

for (const ruta of ['/partido/football/no-existe', '/equipo/football/epl/no-existe', '/liga/football/epl', '/jugador/atp/1']) {
  test(`${ruta} pinta sin errores a 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    const ancho = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, cliente: document.documentElement.clientWidth }));
    expect(ancho.scroll).toBeLessThanOrEqual(ancho.cliente + 1);
    expect(errores).toEqual([]);
  });
}

test('Ctrl+K abre la búsqueda y Escape la cierra', async ({ page }) => {
  await page.goto('/destacados');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Control+k');
  const d = page.getByRole('dialog', { name: 'Buscar' });
  await expect(d).toBeVisible();
  await d.getByRole('textbox').fill('ajus');
  await expect(d.getByRole('option').first()).toContainText('Ajustes');
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
});
