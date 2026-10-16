import { test, expect } from '@playwright/test';
import { contrastes } from './util';

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

// Lote G: lo que encontró la prueba en el navegador con la puerta activa.
test('G10: la pantalla de entrada no deja errores en consola (nada que necesite sesión se pide antes)', async ({ page }) => {
  const { recogerErrores } = await import('./util');
  const errores = recogerErrores(page);
  await page.goto('/');
  await expect(page.getByText('Esta instalación pide contraseña.')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(errores).toEqual([]);
});

test('G7: a 1280×860, con «Cuenta» abierta, «Salir» se alcanza (la barra lateral se desplaza)', async ({ page, playwright }) => {
  // Varias sesiones abiertas (otros dispositivos): la lista de «Cuenta» crece, como en una instalación real.
  for (let i = 0; i < 12; i++) {
    const otro = await playwright.request.newContext({ baseURL: URL_AUTH });
    expect((await otro.post('/api/auth/login', { data: { password: CONTRASENA } })).ok()).toBeTruthy();
    await otro.dispose();
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.getByLabel('Contraseña').fill(CONTRASENA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('tablist', { name: 'Deportes' }).first()).toBeVisible();
  // Una página larga (el glosario): la barra lateral queda fija mientras se desplaza la página, y lo
  // que asoma por debajo de ella no se ve nunca si ella misma no se desplaza.
  await page.goto('/glosario');
  await expect(page.getByRole('tablist', { name: 'Deportes' }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Cuenta/ }).click();
  await expect(page.getByRole('complementary').getByRole('listitem').nth(10)).toBeAttached();
  // El último «Salir» de la barra lateral, llevado a la vista como lo haría el navegador.
  const dentro = await page.evaluate(() => {
    const botones = [...document.querySelectorAll('aside button')].filter((b) => b.textContent?.trim() === 'Salir');
    const b = botones[botones.length - 1] as HTMLElement;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  expect(dentro, '«Salir» queda fuera de la pantalla').toBe(true);
});

// G6: el botón de entrar era blanco sobre el azul de datos (3,63:1) y el error, el rojo del tema
// oscuro también en el claro. El 401 se simula: cinco fallos de verdad bloquearían la dirección
// para el resto de las pruebas.
for (const tema of ['claro', 'oscuro'] as const) {
  test(`G6: en tema ${tema}, el botón de entrar y el error se leen (≥ 4,5:1)`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('predictor.tema', t), tema);
    await page.route('**/api/auth/login', (r) => r.fulfill({ status: 401, json: { error: 'Contraseña incorrecta' } }));
    await page.goto('/');
    await page.getByLabel('Contraseña').fill('no-es-esta');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    const medidos = await contrastes(page, 'form button[type="submit"], [role="alert"]');
    expect(medidos.length).toBe(2);
    expect(medidos.filter((m) => m.ratio < 4.5), JSON.stringify(medidos)).toEqual([]);
  });
}

// Lote I, I4: tras cambiar una contraseña filtrada, cerrar de una vez las sesiones de los demás.
test('I4: «Cerrar las demás sesiones» deja solo esta, y la otra ya no entra', async ({ page, playwright }) => {
  const otro = await playwright.request.newContext({ baseURL: URL_AUTH });
  expect((await otro.post('/api/auth/login', { data: { password: CONTRASENA } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.getByLabel('Contraseña').fill(CONTRASENA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('tablist', { name: 'Deportes' }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Cuenta/ }).click();
  await page.getByRole('button', { name: 'Cerrar las demás' }).click();
  // Con solo esta abierta, el botón ya no hace falta.
  await expect(page.getByRole('button', { name: 'Cerrar las demás' })).toHaveCount(0);
  expect((await otro.get('/api/health')).status()).toBe(401);
  expect((await page.request.get('/api/health')).status()).toBe(200);
  await otro.dispose();
});

const entrarEnLaPantalla = async (page: import('@playwright/test').Page) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto('/');
  await page.getByLabel('Contraseña').fill(CONTRASENA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('tablist', { name: 'Deportes' }).first()).toBeVisible();
};

test('I4: si cerrar las demás falla, se dice y no se borra solo; las otras siguen', async ({ page, playwright }) => {
  const otro = await playwright.request.newContext({ baseURL: URL_AUTH });
  expect((await otro.post('/api/auth/login', { data: { password: CONTRASENA } })).ok()).toBeTruthy();
  await entrarEnLaPantalla(page);
  await page.route('**/api/auth/sessions/revoke-others', (r) => r.fulfill({ status: 500, json: { error: 'fallo' } }));
  await page.getByRole('button', { name: /^Cuenta/ }).click();
  await page.getByRole('button', { name: 'Cerrar las demás' }).click();
  const alerta = page.getByRole('alert').filter({ hasText: 'No se pudieron cerrar las demás sesiones' });
  await expect(alerta).toBeVisible();
  // La lista se vuelve a leer y el aviso sigue ahí: no se borra solo.
  await expect(page.getByRole('button', { name: 'Cerrar las demás' })).toBeEnabled();
  await expect(alerta).toBeVisible();
  expect((await otro.get('/api/health')).status()).toBe(200);
  await otro.dispose();
});

test('I4: sin «esta» en la lista (entrada por Basic Auth) el botón no sale: el servidor diría que no', async ({ page }) => {
  await entrarEnLaPantalla(page);
  const sesion = (id: number) => ({ id, created_at: '2026-10-16T08:00:00.000Z', last_seen_at: '2026-10-16T08:00:00.000Z', expires_at: '2026-11-15T08:00:00.000Z', revoked_at: null, user_agent: null, ip: null, actual: false });
  await page.route('**/api/auth/sessions', (r) => r.fulfill({ json: { actual: null, sesiones: [sesion(1), sesion(2)] } }));
  await page.getByRole('button', { name: /^Cuenta/ }).click();
  await expect(page.getByRole('complementary').getByText('Dispositivo desconocido')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Cerrar las demás' })).toHaveCount(0);
});

test('I4: a 1280 px el botón cabe en una línea, como «Salir»; usado con el teclado, el foco pasa a «Salir»', async ({ page, playwright }) => {
  const otro = await playwright.request.newContext({ baseURL: URL_AUTH });
  expect((await otro.post('/api/auth/login', { data: { password: CONTRASENA } })).ok()).toBeTruthy();
  await entrarEnLaPantalla(page);
  await page.getByRole('button', { name: /^Cuenta/ }).click();
  const panel = page.getByRole('complementary');
  const boton = panel.getByRole('button', { name: 'Cerrar las demás' });
  // El «Salir» de abajo (la fila de esta sesión también se llama así).
  const salir = panel.getByRole('button', { name: 'Salir', exact: true }).last();
  const [b, s] = [await boton.boundingBox(), await salir.boundingBox()];
  expect(Math.round(b!.height), 'en una línea, como «Salir»').toBe(Math.round(s!.height));
  await boton.focus();
  await page.keyboard.press('Enter');
  await expect(boton).toHaveCount(0);
  await expect(salir).toBeFocused();
  await otro.dispose();
});
