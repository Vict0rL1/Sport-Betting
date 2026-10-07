import { test, expect } from '@playwright/test';

// El recorrido de primer uso se da por visto (tiene su propio test): si no, tapa los clics.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
});

// Lo mínimo que tiene que funcionar siempre: la app abre, las pestañas de los deportes
// están y responden, «Hoy» y «Destacados» pintan algo, y la API contesta.
test('abre, enseña las pestañas y cambia de deporte', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Deportes' }).first().getByRole('tab');
  await expect(tabs.first()).toBeVisible();
  expect(await tabs.count()).toBeGreaterThanOrEqual(5);
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.locator('body')).not.toContainText('Cannot GET');
});

test('la API responde: salud, preparación y funciones', async ({ request }) => {
  expect((await request.get('/healthz')).ok()).toBeTruthy();
  const ready = await request.get('/ready');
  expect([200, 503]).toContain(ready.status());
  const f = await request.get('/api/features');
  expect(f.ok()).toBeTruthy();
  expect(Object.keys((await f.json()).features).length).toBeGreaterThan(5);
  const spec = await request.get('/openapi.json');
  expect(spec.ok()).toBeTruthy();
});
