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

test('F: la importación por CSV enseña antes qué entra, qué no y qué se pierde; importar escribe solo lo válido', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  await page.goto('/apuestas');
  await page.getByRole('button', { name: 'Importar CSV' }).click();
  const csv = [
    'placed_on,sport,event,market,selection,odds,stake,currency,snapshot_id',
    '2026-11-20,tennis,Importada Sintética,moneyline,A,1.9,10,EUR,7',
    '2026-11-20,foo,Rechazada Sintética,moneyline,A,1.9,10,EUR,',
  ].join('\n');
  await page.getByRole('textbox', { name: 'Contenido del CSV' }).fill(csv);
  await page.getByRole('button', { name: 'Revisar' }).click();
  const vista = page.getByRole('status').filter({ hasText: 'Todavía no se ha guardado nada' });
  await expect(vista).toContainText('Se importará 1 apuesta; 1 fila no entra.');
  await expect(vista).toContainText('Línea 3: sport:');
  await expect(vista).toContainText('Línea 2: la apuesta se puede importar, pero su enlace a la estimación original no se puede restaurar.');
  await page.getByRole('button', { name: 'Importar 1' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 importada' })).toBeVisible();
  // Lo guardado, no la página (el CSV sigue en el cuadro de texto): solo la fila válida, y sin enlace.
  const guardadas = (await (await page.request.get('/api/bets')).json()) as { event: string; snapshot_id: number | null }[] | { bets: { event: string; snapshot_id: number | null }[] };
  const lista = Array.isArray(guardadas) ? guardadas : guardadas.bets;
  const nuestras = lista.filter((b) => /Sintética/.test(b.event));
  expect(nuestras.map((b) => b.event)).toEqual(['Importada Sintética']);
  expect(nuestras[0].snapshot_id).toBeNull();
});

// ui-tester (pasada final): a 320 px el selector de moneda, en la misma fila que el banco, empujaba la
// página 35 px fuera de la pantalla (23 en inglés).
for (const idioma of ['es', 'en'] as const) {
  test(`B: a 320 px el banco y su moneda caben sin desplazar la página (${idioma})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript((i) => localStorage.setItem('predictor.idioma', i), idioma);
    const sinEvaluar = { today: 0, week: 0, dayBreached: false, weekBreached: false, evaluable: false, estado: { incidencias: [{ codigo: 'banco-sin-moneda', apuestas: 2 }] } };
    await aApuestas(page, () => cartera(sinEvaluar, null));
    const moneda = page.getByRole('combobox', { name: idioma === 'es' ? 'Moneda del banco' : 'Bankroll currency' });
    await expect(moneda).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const caja = (await moneda.boundingBox())!;
    expect(caja.x + caja.width).toBeLessThanOrEqual(320);
  });
}

// Fase E: la calibración por partido y el rendimiento por periodo, con datos SINTÉTICOS servidos desde
// aquí. Se comprueba que el gráfico, el texto y la tabla dicen lo mismo y que lo que no tiene muestra se dice.
test('E: la calibración por partido y el Brier por periodo enseñan su muestra, su intervalo y su tabla', async ({ page }) => {
  const cubetas = (dibujada?: number) =>
    Array.from({ length: 10 }, (_, i) =>
      i === dibujada
        ? { desde: i / 10, hasta: (i + 1) / 10, n: 120, predichaMedia: 0.62, observada: 0.625, ic95: { lo: 0.5358, hi: 0.7065 }, nivel: 'suficiente' }
        : { desde: i / 10, hasta: (i + 1) / 10, n: i === 2 ? 20 : 0, predichaMedia: i === 2 ? 0.25 : null, observada: null, ic95: null, nivel: 'sin-muestra' },
    );
  const conjunto = (veredicto: string) => ({ n: 140, predichaMedia: 0.55, observada: 0.56, ic95: { lo: 0.48, hi: 0.64 }, citlZ: 0.2, spiegelhalterZ: 0.4, veredicto, nivel: 'orientativa' });
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  await page.route('**/api/evaluation/calibracion*', (r) =>
    r.fulfill({
      json: {
        resultados: 3,
        partidos: 140,
        excluidas: { 'final-invalida': 2 },
        versiones: [{ version: 'v1', n: 140 }],
        umbrales: { cubetaMin: 30, conjuntoMin: 100, zCritico: 2.638 },
        motivo: null,
        paneles: [
          { clase: 'local', n: 140, cubetas: cubetas(6), conjunto: conjunto('sin-evidencia') },
          { clase: 'empate', n: 140, cubetas: cubetas(), conjunto: conjunto('descalibrado') },
          { clase: 'visitante', n: 140, cubetas: cubetas(), conjunto: conjunto('sin-evidencia') },
        ],
      },
    }),
  );
  await page.route('**/api/evaluation/rendimiento*', (r) =>
    r.fulfill({
      json: {
        zona: 'Europe/Madrid',
        referencia: { uniforme: 1 / 3 },
        umbrales: { puntoMin: 30, insuficiente: 100 },
        motivo: null,
        excluidas: { '2026-10': { 'final-invalida': 2 } },
        series: [
          {
            cohorte: 'final',
            version: 'v1',
            puntos: [
              { periodo: '2026-10', parcial: false, n: 120, brier: 0.21, ic95: { lo: 0.19, hi: 0.23 }, logLoss: 0.61, mercado: null, nivel: 'orientativa', motivo: null },
              { periodo: '2026-11', parcial: true, n: 12, brier: null, ic95: null, logLoss: null, mercado: null, nivel: 'sin-muestra', motivo: null },
            ],
          },
        ],
        resumen: [{ cohorte: 'final', version: 'v1', n: 132, brier: 0.21, ic95: { lo: 0.19, hi: 0.23 }, logLoss: 0.61, mercado: null, nivel: 'orientativa' }],
      },
    }),
  );
  await page.goto('/confianza');
  const cal = page.locator('section[aria-labelledby="cal-titulo"]');
  await expect(cal.getByRole('heading', { name: 'Calibración por partido' })).toBeVisible();
  await expect(cal.getByText(/Sin evidencia de descalibración con esta muestra \(umbral ±2,64/).first()).toBeVisible();
  await expect(cal.getByText(/Hay evidencia de descalibración/)).toBeVisible();
  await expect(cal.getByText(/No evaluados: la estimación congelada no se puede leer/)).toBeVisible();
  // La tabla dice lo mismo que el punto: 120 partidos, 62,5 %, y la cubeta de 20 se cuenta pero no se dibuja.
  await cal.getByText('Ver la tabla').first().click();
  const fila = cal.getByRole('row').filter({ hasText: '60 %–70 %' });
  await expect(fila).toContainText('120');
  await expect(fila).toContainText('62,5 %');
  await expect(cal.getByRole('row').filter({ hasText: '20 %–30 %' })).toContainText('menos de 30');
  await expect(cal.locator('svg[role="img"] circle[r="4.5"]')).toHaveCount(1);

  const rend = page.locator('section[aria-labelledby="rend-titulo"]');
  await expect(rend.getByText('Registradas · versión v1')).toBeVisible();
  await expect(rend.getByText(/132 partidos · Brier 0,210/)).toBeVisible();
  await expect(rend.getByText(/Mide la calidad de la probabilidad, no si se gana dinero/)).toBeVisible();
  // Las exclusiones, una vez para el deporte, no repetidas en cada serie.
  await expect(rend.getByText(/^No evaluados, por mes: 2026-10: la estimación congelada no se puede leer/)).toHaveCount(1);
  await rend.getByText('Ver la tabla').click();
  await expect(rend.getByRole('row').filter({ hasText: '2026-11 (en curso)' })).toContainText('menos de 30');
  // Un punto por periodo con muestra, sin línea que los una.
  await expect(rend.locator('svg[role="img"] circle[r="4.5"]')).toHaveCount(1);
  await expect(rend.locator('svg[role="img"] polyline, svg[role="img"] path')).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

// Fase D (auditoría de ui-tester): estados y paneles de las páginas de cada deporte.
test('D: en la NHL, si cargar falla, no se dice además que no hay partidos «como es normal entre temporadas»', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  await page.route('**/api/nhl/meta*', (r) => r.fulfill({ status: 500, json: { error: 'caído' } }));
  await page.goto('/nhl');
  await expect(page.getByText(/No se pudieron cargar los datos de la NHL/)).toBeVisible();
  await expect(page.getByText(/No hay partidos próximos para NHL/)).toHaveCount(0);
});

test('D: a 390 px «Lo que el modelo ve más probable» empieza cerrado (los partidos no quedan tres pantallas más abajo); a 1280, abierto', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/tenis');
  const boton = page.getByRole('button', { name: /^Lo que el modelo ve más probable/ });
  await expect(boton).toBeVisible({ timeout: 20_000 });
  await expect(boton).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByRole('button', { name: /^Lo que el modelo ve más probable/ })).toHaveAttribute('aria-expanded', 'true', { timeout: 20_000 });
});

test('D: «Abrir partido» tiene un blanco de al menos 24 px de alto', async ({ page }) => {
  test.slow();
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/tenis');
  const enlace = page.getByRole('link', { name: /^Abrir partido/ }).first();
  await expect(enlace).toBeVisible({ timeout: 20_000 });
  expect((await enlace.boundingBox())!.height).toBeGreaterThanOrEqual(24);
});
