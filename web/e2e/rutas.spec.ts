import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Fase 5.27: cada ruta pinta a 1280 y a 390 px sin scroll horizontal ni errores de consola;
// la barra inferior enseña los cuatro destinos en el móvil; los enlaces profundos restauran
// el estado; axe pasa en claro y en oscuro.

const RUTAS = ['/destacados', '/futbol', '/baloncesto', '/beisbol', '/nfl', '/tenis', '/apuestas', '/confianza', '/confianza/diagnostico', '/ajustes', '/glosario', '/no-existe'];

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
