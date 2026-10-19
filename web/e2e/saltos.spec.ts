import { test, expect, type Page } from '@playwright/test';

// Lote L: en el móvil nada salta al cargar y nada dice «no hay datos» mientras carga
// (docs/plans/fixes-L.md). A 390 px con pantalla táctil, y sin service worker: sus fetch no pasan
// por page.route, y aquí se retienen respuestas a propósito.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
});
// Una respuesta retenida o reescrita que sigue en vuelo cuando la prueba acaba no es un fallo de
// la prueba: se suelta sin más.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

/** Retiene las peticiones que casan con `patron` hasta que el test llama a lo que devuelve. */
async function retener(page: Page, patron: string): Promise<() => void> {
  let soltar!: () => void;
  const retenido = new Promise<void>((r) => (soltar = r));
  await page.route(patron, async (r) => {
    await retenido;
    await r.continue();
  });
  return soltar;
}

for (const [ruta, meta, sinDatos] of [
  ['/futbol', '**/api/football/meta', 'No hay datos de fútbol todavía.'],
  ['/baloncesto', '**/api/basketball/meta', 'No hay datos de baloncesto todavía.'],
  ['/beisbol', '**/api/baseball/meta', 'No hay datos de béisbol todavía.'],
  ['/nfl', '**/api/nfl/meta', 'No hay datos de fútbol americano todavía.'],
] as const) {
  test(`L1: ${ruta} no dice «${sinDatos}» mientras llegan las ligas`, async ({ page }) => {
    const soltar = await retener(page, meta);
    await page.goto(ruta);
    await expect(page.getByRole('button', { name: /Actualizar/ })).toBeVisible();
    await page.waitForTimeout(400);
    // Aún no se sabe: decir que no hay datos sería inventarlo.
    await expect(page.getByText(sinDatos)).toHaveCount(0);
    soltar();
    // La base de los e2e no tiene datos de estos deportes: ahora sí es verdad, y se dice.
    await expect(page.getByText(sinDatos)).toBeVisible();
  });
}

test('L2: «Detalles» no cambia de línea cuando llegan los contadores', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.today.open', '0'));
  const soltar = await retener(page, '**/api/meta');
  await page.goto('/tenis');
  const detalles = page.getByRole('button', { name: /^Detalles/ });
  await expect(detalles).toBeVisible();
  // «Hoy» ya en su sitio: lo único que llega después son los contadores de la cabecera.
  await expect(page.getByRole('button', { name: /^(Hoy|Cómo le fue)/ })).toBeVisible();
  await page.waitForTimeout(300);
  const antes = (await detalles.boundingBox())!.y;
  soltar();
  await expect(page.getByText(/\d+ partidos · \d+ jugadores/)).toBeVisible();
  expect((await detalles.boundingBox())!.y).toBe(antes);
});

/** Suma los saltos de diseño (CLS) desde que carga la página, sin los que siguen a un toque. */
async function contarSaltos(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __saltos: number };
    w.__saltos = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__saltos += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  return () => page.evaluate(() => (window as unknown as { __saltos: number }).__saltos);
}

test('L3: en Tenis, lo de debajo de las listas espera a los partidos en vez de saltar cuando llegan', async ({ page }) => {
  test.slow();
  // «Hoy» plegado: su hueco ya mide lo mismo que el panel, y aquí no se mide «Hoy».
  await page.addInitScript(() => localStorage.setItem('predictor.today.open', '0'));
  const saltos = await contarSaltos(page);
  const soltar = await retener(page, '**/api/matches/upcoming?*');
  await page.goto('/tenis');
  await expect(page.getByRole('button', { name: /^Detalles/ })).toBeVisible();
  await page.waitForTimeout(800);
  soltar();
  await expect(page.locator('section', { has: page.getByRole('button', { name: /^Los partidos/ }) })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  expect(await saltos()).toBeLessThan(0.05);
});

test('L3: en la NFL, la fila de ligas y la nota de la línea esperan a los partidos', async ({ page }) => {
  // La base del e2e no tiene NFL: una liga con partidos, para que la página los pida.
  await page.route('**/api/nfl/leagues', async (r) => {
    const res = await r.fetch();
    const ligas = (await res.json()) as { id: string }[];
    await r.fulfill({ response: res, json: ligas.map((l) => (l.id === 'nfl' ? { ...l, hasUpcoming: true, upcomingCount: 2, games: 100 } : l)) });
  });
  const soltar = await retener(page, '**/api/nfl/games/upcoming?*');
  await page.goto('/nfl');
  await expect(page.getByRole('button', { name: /^Detalles/ })).toBeVisible();
  await page.waitForTimeout(600);
  // Las listas aún no están: lo de debajo tampoco, o lo empujarían al llegar.
  await expect(page.getByRole('button', { name: /^NFL/ })).toHaveCount(0);
  await expect(page.getByText(/Sin línea de las casas/)).toHaveCount(0);
  soltar();
  await expect(page.getByRole('button', { name: /^NFL/ })).toBeVisible();
});

test('L3: la NHL no dice que falta la clave de cuotas antes de saberlo', async ({ page }) => {
  const soltar = await retener(page, '**/api/nhl/meta');
  await page.goto('/nhl');
  await expect(page.getByRole('button', { name: /^Detalles/ })).toBeVisible();
  await page.waitForTimeout(600);
  // D14: no se culpa a la clave sin saberlo (y la nota salía encima de las listas, que la empujaban).
  await expect(page.getByText(/Sin línea de las casas/)).toHaveCount(0);
  soltar();
  // El servidor de los e2e no tiene clave: ahora sí se sabe, y se dice.
  await expect(page.getByText(/Sin línea de las casas/)).toBeVisible();
});

test('L4: en Destacados, «Mi selección» no salta cuando llega la lista', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.today.open', '0'));
  const saltos = await contarSaltos(page);
  const soltar = await retener(page, '**/api/top-picks**');
  await page.goto('/destacados');
  await expect(page.getByRole('heading', { name: 'Destacados' })).toBeVisible();
  await page.waitForTimeout(800);
  // Mientras llega, la forma de las tarjetas, no la palabra.
  await expect(page.locator('main [aria-busy="true"]').first()).toBeVisible();
  soltar();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  expect(await saltos()).toBeLessThan(0.05);
});

test('L5: en Apuestas, nada salta cuando llegan los paneles del banco', async ({ page }) => {
  const saltos = await contarSaltos(page);
  // Los dos paneles tardan y llegan por separado (con los datos de verdad, el banco de papel antes
  // que la cartera): ni el historial ni el esqueleto que espera en su sitio pueden moverse.
  const soltarPapel = await retener(page, '**/api/paper');
  const soltarCartera = await retener(page, '**/api/staking/book?*');
  await page.goto('/apuestas');
  await expect(page.getByRole('button', { name: /Registrar apuesta/ })).toBeVisible();
  await page.waitForTimeout(800);
  // Sin el banco todavía, el historial no se pinta: luego lo empujaría.
  await expect(page.getByText('Todavía no has registrado ninguna apuesta')).toHaveCount(0);
  soltarPapel();
  await page.waitForTimeout(800);
  soltarCartera();
  await expect(page.getByText('Todavía no has registrado ninguna apuesta')).toBeVisible();
  // Y los dos paneles, que cargaban ocultos, se ven.
  await expect(page.getByText('Exposición de la cartera')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'El modelo apostando solo' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  expect(await saltos()).toBeLessThan(0.05);
});

test('L6: en Diagnóstico, las secciones no saltan según llega cada comprobación', async ({ page }) => {
  const saltos = await contarSaltos(page);
  // Una de las seis comprobaciones tarda: las demás no pueden pintarse y luego moverse.
  const soltar = await retener(page, '**/api/scheduler');
  await page.goto('/confianza/diagnostico');
  await expect(page.getByRole('heading', { name: 'Diagnóstico' })).toBeVisible();
  await page.waitForTimeout(800);
  soltar();
  await expect(page.getByRole('heading', { name: /Ingestas/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  expect(await saltos()).toBeLessThan(0.05);
});
