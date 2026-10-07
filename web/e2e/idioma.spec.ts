import { test, expect } from '@playwright/test';

// La interfaz en inglés (seguimiento de la Fase 5.25): el texto sale del catálogo, no del
// componente. Lo que genera el servidor (razones, notas) sigue en español y no se comprueba aquí.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('predictor.recorrido', '1');
    localStorage.setItem('predictor.idioma', 'en');
  });
});

test('navegación, píldora de estado y analítica en inglés', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/destacados');
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  const barra = page.getByTestId('barra-inferior');
  for (const destino of ['Highlights', 'Sports', 'Bets', 'Trust']) await expect(barra).toContainText(destino);
  await page.locator('[data-testid=status-pill]:visible').click();
  const estado = page.getByRole('dialog', { name: 'App status' });
  await expect(estado).toBeVisible();
  await expect(estado).toContainText('Open diagnostics');
  await expect(estado).not.toContainText('Ver diagnóstico');
  await page.goto('/confianza');
  await expect(page.getByRole('heading', { name: 'Model analytics' })).toBeVisible();
  await expect(page.getByText('Accuracy by segment (live)')).toBeVisible();
});

test('motor en vivo del tenis en inglés', async ({ page }) => {
  test.slow();
  await page.goto('/tenis');
  await page.getByRole('button', { name: /Why\?|¿Por qué\?/ }).first().click();
  await expect(page.getByText('Live engine')).toBeVisible();
  await expect(page.getByLabel('Games 2')).toBeVisible();
  await expect(page.getByText("Today's serve points and live odds")).toBeVisible();
});
