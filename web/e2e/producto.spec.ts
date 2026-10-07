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
