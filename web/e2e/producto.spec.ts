import { test, expect } from '@playwright/test';

// Fase 6: las funciones de producto, de punta a punta con la base de demostración.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
});

test('laboratorio: una estrategia desde plantilla aparece junto al banco principal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/apuestas/laboratorio');
  await expect(page.getByRole('heading', { name: 'Laboratorio de estrategias' })).toBeVisible();
  await expect(page.getByTestId('fila-estrategia')).toHaveCount(1);
  await page.getByRole('button', { name: 'Conservadora' }).click();
  await page.getByRole('button', { name: 'Crear estrategia' }).click();
  await expect(page.getByTestId('fila-estrategia')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Conservadora' })).toBeVisible();
  // La misma configuración otra vez: el servidor lo rechaza y se dice por qué.
  await page.getByRole('button', { name: 'Conservadora' }).click();
  await page.getByRole('button', { name: 'Crear estrategia' }).click();
  await expect(page.getByRole('alert')).toContainText('Conservadora');
  const ancho = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, cliente: document.documentElement.clientWidth }));
  expect(ancho.scroll).toBeLessThanOrEqual(ancho.cliente + 1);
});

test('laboratorio: «¿qué habría pasado?» con la política vigente dice por qué no apuesta la NFL', async ({ page }) => {
  await page.goto('/apuestas/laboratorio');
  const seccion = page.getByRole('region', { name: '¿Qué habría pasado?' });
  await seccion.getByRole('button', { name: 'Calcular' }).click();
  const r = seccion.getByTestId('resultado-historico');
  await expect(r).toBeVisible();
  await expect(r).toContainText('freno de calibración');
  await expect(r).toContainText('holdout');
});

test('informes: generar el de hoy, leerlo y su PDF; la bandeja lo avisa y la campana cuenta', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/informes');
  await page.getByRole('button', { name: 'Generar el de hoy' }).click();
  const informe = page.getByTestId('informe');
  await expect(informe.getByRole('heading', { level: 2 })).toContainText('Resumen del día');
  await expect(informe).toContainText('Banco de papel');
  const pdf = page.getByRole('link', { name: 'Descargar PDF' });
  const href = await pdf.getAttribute('href');
  const r = await request.get(href!);
  expect(r.headers()['content-type']).toContain('application/pdf');
  expect((await r.body()).subarray(0, 8).toString('latin1')).toContain('%PDF-1.4');

  await page.goto('/bandeja');
  const lista = page.getByTestId('lista-bandeja');
  await expect(lista).toContainText('Resumen del día');
  const campana = page.locator('[data-testid=campana]:visible');
  await expect(campana).toHaveAttribute('aria-label', /Bandeja: [1-9]\d* sin leer/);
  await page.getByRole('button', { name: 'Marcar todo como leído' }).click();
  await expect(page.getByRole('button', { name: 'Marcar todo como leído' })).toHaveCount(0);
  await expect(campana).toHaveAttribute('aria-label', 'Bandeja: 0 sin leer');
  await lista.getByRole('button', { name: 'Abrir' }).first().click();
  await expect(page).toHaveURL(/\/informes\/\d+|\/partido\//);
});
