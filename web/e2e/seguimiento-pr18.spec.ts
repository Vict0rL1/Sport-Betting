// Seguimiento del PR #18. Datos SINTÉTICOS servidos desde aquí; nada de esto prueba un proveedor real.
import { test, expect, type Page } from '@playwright/test';

test.use({ timezoneId: 'Europe/Madrid', locale: 'es-ES', serviceWorkers: 'block' });

/** Una cartera vacía con el estado de los límites que se le pase. */
function cartera(loss: Record<string, unknown>, moneda: string | null) {
  return {
    bankroll: 1000,
    moneda,
    considered: 0,
    demoOdds: 0,
    priced: 0,
    limits: { maxPerEvent: 0.02, maxTotalExposure: 0.1, maxExposurePerDay: 0.06, maxExposurePerLeague: 0.05 },
    loss,
    entries: [],
    blocked: 0,
    naiveStake: 0,
    totalStake: 0,
    aggregate: { naive: 0, effective: 0, positions: 0, concentration: 0 },
    links: [],
    caps: [],
    notes: [],
    correlation: { sameMatch: {}, sameLeagueDay: { rho: 0, lo: 0, hi: 0 }, used: 0, control: 0, n: 0 },
  };
}

async function aApuestas(page: Page, respuesta: (url: URL) => unknown) {
  const pedidas: URL[] = [];
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  await page.route('**/api/staking/book*', (r) => {
    const u = new URL(r.request().url());
    pedidas.push(u);
    return r.fulfill({ json: respuesta(u) });
  });
  await page.goto('/apuestas');
  return pedidas;
}

test('B: la cartera pide los límites en la moneda de su banco y distingue «sin evaluar» de «alcanzado»', async ({ page }) => {
  const sinEvaluar = { today: 0, week: 0, dayBreached: false, weekBreached: false, evaluable: false, estado: { incidencias: [{ codigo: 'banco-sin-moneda', apuestas: 2 }] } };
  const alcanzado = { today: -60, week: -60, dayBreached: true, weekBreached: false, evaluable: true, estado: { incidencias: [] } };
  const pedidas = await aApuestas(page, (u) => (u.searchParams.get('moneda') ? cartera(alcanzado, u.searchParams.get('moneda')) : cartera(sinEvaluar, null)));

  // Sin moneda: no se dice «por debajo» ni «cortada»: se dice que no se puede saber y qué falta.
  await expect(page.getByText('No se puede saber si se ha llegado a un límite de pérdida')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Elige la moneda de este banco: 2 apuestas liquidadas' })).toBeVisible();
  await expect(page.getByText('Operativa cortada por límite de pérdida.')).toHaveCount(0);
  expect(pedidas[0].searchParams.get('moneda')).toBe('');

  // Con moneda: la petición la lleva y el estado es otro.
  await page.getByRole('combobox', { name: 'Moneda del banco' }).selectOption('EUR');
  await expect(page.getByText('Operativa cortada por límite de pérdida.')).toBeVisible();
  await expect(page.getByText('No se puede saber si se ha llegado')).toHaveCount(0);
  expect(pedidas.at(-1)!.searchParams.get('moneda')).toBe('EUR');

  // Y se recuerda, como el importe del banco.
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Moneda del banco' })).toHaveValue('EUR');
});
