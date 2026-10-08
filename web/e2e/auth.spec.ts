import { test, expect } from '@playwright/test';

// A1: con la puerta activa (APP_AUTH=on) la web tiene que abrirse sin credenciales, enseñar la
// pantalla de entrada, y entrar con la contraseña. scripts/e2e-server.mjs arranca este segundo
// servidor en el 7391 con la contraseña de abajo.
const URL_AUTH = process.env.E2E_URL_AUTH ?? 'http://localhost:7391';
const CONTRASENA = 'contrasena-de-pruebas-e2e';

test.use({ baseURL: URL_AUTH });

test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  // El servidor con contraseña arranca a la vez que el principal: se le espera.
  await expect.poll(async () => (await request.get('/healthz').catch(() => null))?.status() ?? 0, { timeout: 120_000 }).toBe(200);
});

test('con la puerta activa, la web abre, pide la contraseña y entra', async ({ page, request }) => {
  const api = await request.get('/api/health');
  expect(api.status()).toBe(401);
  await page.goto('/');
  await expect(page.getByText('Esta instalación pide contraseña.')).toBeVisible();
  await page.getByLabel('Contraseña').fill(CONTRASENA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  const tabs = page.getByRole('tablist', { name: 'Deportes' }).first().getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  await page.goto('/destacados');
  await expect(tabs.first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Esta instalación pide contraseña.');
});

test('una recarga en una ruta de la SPA devuelve la app, y un endpoint mal escrito nunca la página', async ({ request }) => {
  const spa = await request.get('/apuestas', { headers: { accept: 'text/html' } });
  expect(spa.status()).toBe(200);
  expect(await spa.text()).toContain('<div id="root">');
  const typo = await request.get('/api/typo', { headers: { accept: 'text/html' } });
  expect(typo.status()).toBe(401);
  expect((await typo.json()).error).toBe('Contraseña requerida');
});
