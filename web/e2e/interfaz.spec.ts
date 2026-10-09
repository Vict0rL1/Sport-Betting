import { test, expect } from '@playwright/test';

// Lote D de la revisión del 8 de octubre de 2026: la interfaz, de punta a punta con la base de
// demostración. Cada prueba es un defecto de la revisión.
// Sin service worker: `page.route` no ve lo que el worker contesta, y aquí se simulan respuestas.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
});

for (const ancho of [1280, 390]) {
  test(`D12: a ${ancho} px la píldora y la campana se montan una vez (una petición cada una)`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    const pedidas: Record<string, number> = { '/api/estado': 0, '/api/bandeja/contador': 0 };
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      if (p in pedidas) pedidas[p]++;
    });
    await page.goto('/destacados');
    await expect(page.getByTestId('status-pill')).toHaveCount(1);
    await page.waitForLoadState('networkidle');
    expect(pedidas).toEqual({ '/api/estado': 1, '/api/bandeja/contador': 1 });
  });
}

test('D10: Escape cierra la píldora de estado y el foco vuelve a ella; con ella abierta los atajos no cambian de pestaña', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/destacados');
  const pildora = page.getByTestId('status-pill');
  await pildora.click();
  const dialogo = page.getByRole('dialog', { name: 'Estado de la app' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toHaveAttribute('aria-modal', 'true');
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/\/destacados/);
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(pildora).toBeFocused();
});

test.describe('D13 (galería con datos de ejemplo)', () => {
  test.beforeAll(async ({ request }) => {
    expect((await request.patch('/api/features/interfaz.muestras', { data: { on: true } })).ok()).toBeTruthy();
  });
  test.afterAll(async ({ request }) => {
    await request.patch('/api/features/interfaz.muestras', { data: { on: null } });
  });
  test('D13: la tarjeta de Destacados lleva el porqué de la confianza plegado y «Seguir» no es otra estrella', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/_muestras');
    const tarjeta = page.getByTestId('muestra-tarjeta');
    await expect(tarjeta).toBeVisible();
    const porque = tarjeta.locator('details').filter({ hasText: 'Por qué esa confianza' });
    await expect(porque).toHaveCount(1);
    await expect(porque).not.toHaveAttribute('open', '');
    await expect(porque.getByText('ejemplo: ventaja por debajo del mínimo')).toBeHidden();
    await porque.locator('summary').click();
    await expect(porque.getByText('ejemplo: ventaja por debajo del mínimo')).toBeVisible();
    const seguir = tarjeta.getByRole('button', { name: /^Seguir:/ });
    await expect(seguir).toHaveAttribute('data-icono', 'campana');
  });
});

test('D8: un enlace con ?dia= conserva el día mientras cargan los partidos', async ({ page }) => {
  // Los partidos tardan: mientras cargan no hay días, y antes eso borraba el ?dia= del enlace
  // (tenis, fútbol, baloncesto, béisbol y NFL; el tenis es el que tiene datos en la semilla).
  await page.route('**/api/matches/upcoming**', async (ruta) => {
    await new Promise((ok) => setTimeout(ok, 2_000));
    await ruta.continue();
  });
  await page.goto('/tenis?dia=2030-01-05');
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/dia=2030-01-05/);
});

test('D8: al pasar de un partido a otro, la ficha no arrastra el resultado del anterior', async ({ page }) => {
  await page.route('**/api/resultado/football/**', async (ruta) => {
    if (ruta.request().url().includes('clave-a')) {
      await ruta.fulfill({ json: { casa: 'Arsenal', fuera: 'Chelsea', cuando: null, probabilidades: [0.5, 0.3, 0.2], resuelto: true, resultado: 'casa', marcador: '2-1', probabilidadDada: 0.5, acerto: true } });
    } else {
      await new Promise((ok) => setTimeout(ok, 5_000));
      await ruta.fulfill({ status: 404, json: { error: 'no' } });
    }
  });
  await page.goto('/partido/football/a?clave=clave-a');
  await expect(page.getByText('2-1')).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState({}, '', '/partido/football/b?clave=clave-b');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/partido\/football\/b/);
  await expect(page.getByText('2-1')).toBeHidden();
});
