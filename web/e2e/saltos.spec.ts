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

// N2 (lote N): «¿Acertó?» con una semana de resultados (la base del e2e no tiene ninguno), que
// llegan después que «Hoy», como en un móvil.
const HOY = {
  nota: null,
  partidos: [1, 2, 3].map((i) => ({
    deporte: 'Tenis',
    cuando: new Date(Date.now() + i * 3600_000).toISOString(),
    partido: `Jugador ${i} - Rival ${i}`,
    favorito: `Jugador ${i}`,
    probabilidad: 0.6,
    precioReal: false,
    empezado: false,
  })),
};
async function conResultados(page: Page, retraso: () => number) {
  await page.route('**/api/today', (r) => r.fulfill({ json: HOY }));
  await page.route('**/api/recent-results*', async (r) => {
    const res = await r.fetch();
    const j = (await res.json()) as { resultados: unknown[] };
    for (let i = 0; i < 12; i++) {
      const dia = new Date(Date.now() - (i % 6) * 86_400_000).toISOString().slice(0, 10);
      const [casa, fuera] = [`Jugador ${i}`, `Rival ${i}`];
      j.resultados.push({ deporte: 'Tenis', liga: null, dia, cuando: null, partido: `${casa} - ${fuera}`, casa, fuera, casaId: null, fueraId: null, favorito: casa, probabilidad: 0.62, ganador: i % 3 ? casa : fuera, acerto: i % 3 !== 0, origen: 'reconstruida' });
    }
    const ms = retraso();
    if (ms) await new Promise((ok) => setTimeout(ok, ms));
    await r.fulfill({ response: res, json: j });
  });
}

test('N2: tocar «¿Acertó?» no deja la semana abierta para la visita siguiente, y esa visita no salta', async ({ page }) => {
  let retraso = 0;
  await conResultados(page, () => retraso);
  const saltos = await contarSaltos(page);
  await page.goto('/tenis');
  await page.getByRole('button', { name: '¿Acertó?' }).click();
  await expect(page.getByRole('button', { name: /^Cómo le fue al modelo/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('el modelo dijo').first()).toBeVisible();
  await page.waitForTimeout(300);
  retraso = 1500;
  await page.reload();
  // Nace plegado, como sin preferencia guardada: la tabla de la semana se consulta de vez en
  // cuando. Antes se guardaba abierta, y cada carga la abría encima de cada pestaña.
  await expect(page.getByRole('button', { name: /^Cómo le fue al modelo/ })).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(2200);
  expect(await saltos()).toBeLessThan(0.05);
});

test('N2: con «¿Acertó?» abierto a propósito, la visita siguiente reserva su alto mientras llegan los resultados', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('predictor.today.open', '1');
    localStorage.setItem('predictor.today.view', 'resultados');
  });
  let retraso = 0;
  await conResultados(page, () => retraso);
  const saltos = await contarSaltos(page);
  await page.goto('/tenis');
  await expect(page.getByText('el modelo dijo').first()).toBeVisible();
  await page.waitForTimeout(300);
  retraso = 1500;
  await page.reload();
  await expect(page.getByText('el modelo dijo').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  // Antes, el panel medía 136 px hasta que llegaban los resultados y luego más de 1.000.
  expect(await saltos()).toBeLessThan(0.05);
});

test('N2: sin partidos hoy, la visita siguiente reserva lo que de verdad midió «Hoy»', async ({ page }) => {
  // Hoy no hay partidos: el panel se queda en los resultados, plegado (46 px). La siguiente carga
  // no puede reservar el alto de «Hoy» abierto: ese estado no se llegó a pintar.
  await page.route('**/api/today', (r) => r.fulfill({ json: { nota: null, partidos: [] } }));
  const saltos = await contarSaltos(page);
  await page.goto('/tenis');
  await expect(page.getByRole('button', { name: /^Cómo le fue al modelo/ })).toBeVisible();
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Cómo le fue al modelo/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  expect(await saltos()).toBeLessThan(0.05);
});

test('N2: plegado, «¿Acertó?» no crece cuando llega su resumen', async ({ page }) => {
  // En el móvil, «Cómo le fue al modelo cargando…» cabe en una línea y el resumen ocupa dos: el panel
  // crecía 24 px al llegar y empujaba todo lo de debajo.
  await page.addInitScript(() => localStorage.setItem('predictor.today.view', 'resultados'));
  let retraso = 0;
  await conResultados(page, () => retraso);
  await page.goto('/tenis');
  const cabecera = page.getByRole('button', { name: /^Cómo le fue al modelo/ });
  await expect(cabecera).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(500);
  retraso = 1500;
  await page.reload();
  const panel = page.locator('section', { has: cabecera });
  await expect(cabecera).toBeVisible();
  const mientras = (await panel.boundingBox())!.height;
  await page.waitForResponse('**/api/recent-results*');
  await page.waitForTimeout(300);
  expect(Math.abs((await panel.boundingBox())!.height - mientras)).toBeLessThan(1);
});

for (const [ruta, meta] of [
  ['/futbol', '**/api/football/meta'],
  ['/baloncesto', '**/api/basketball/meta'],
  ['/beisbol', '**/api/baseball/meta'],
  ['/nfl', '**/api/nfl/meta'],
] as const) {
  test(`N3: ${ruta} no dice «No hay partidos próximos para esta liga» ni mientras llegan las ligas ni sin datos`, async ({ page }) => {
    const soltar = await retener(page, meta);
    await page.goto(ruta);
    await expect(page.getByRole('button', { name: /Actualizar/ })).toBeVisible();
    await page.waitForTimeout(400);
    // «El modelo está listo, pero no hay nada en el calendario»: mientras llegan las ligas no se
    // sabe, y sin datos del deporte no es verdad.
    const falso = page.getByText(/No hay partidos próximos para/);
    await expect(falso).toHaveCount(0);
    soltar();
    await expect(page.getByText(/No hay datos de .* todavía/)).toBeVisible();
    await expect(falso).toHaveCount(0);
  });
}

for (const ancho of [320, 390]) {
  test(`N4: a ${ancho} px, la fila de los contadores no crece cuando llegan`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 800 });
    await page.addInitScript(() => localStorage.setItem('predictor.today.open', '0'));
    // Como con los datos de verdad: muchos partidos y el aviso de datos viejos, que en el móvil no
    // caben en la línea de «Actualizar». La base del e2e es de demostración y no lo tiene.
    let soltar: () => void = () => {};
    let retenido: Promise<void> = Promise.resolve();
    await page.route('**/api/meta', async (r) => {
      await retenido;
      const res = await r.fetch();
      const m = (await res.json()) as { counts: { matches: number } };
      await r.fulfill({ response: res, json: { ...m, dataSource: 'archivo', historyThrough: '2025-09-28', counts: { ...m.counts, matches: 1_234_567 } } });
    });
    // Una visita antes: es lo de cada día, y así la app sabe lo que mide la fila en esta pestaña.
    await page.goto('/tenis');
    await expect(page.getByText(/1\.234\.567 partidos/)).toBeVisible();
    await page.waitForTimeout(300);
    retenido = new Promise<void>((ok) => (soltar = ok));
    await page.reload();
    const fila = page.locator('header > div', { has: page.getByRole('button', { name: /^Detalles/ }) });
    await expect(fila).toBeVisible();
    await page.waitForTimeout(300);
    const detalles = page.getByRole('button', { name: /^Detalles/ });
    const antes = (await fila.boundingBox())!.height;
    const detallesAntes = (await detalles.boundingBox())!.y;
    soltar();
    await expect(page.getByText(/1\.234\.567 partidos/)).toBeVisible();
    // Antes, los contadores y el aviso bajaban de línea y la fila crecía 28–36 px, con todo lo de
    // debajo. Y «Detalles» tampoco se mueve: el hueco reservado queda encima de su línea.
    expect(Math.abs((await fila.boundingBox())!.height - antes)).toBeLessThan(1);
    expect(Math.abs((await detalles.boundingBox())!.y - detallesAntes)).toBeLessThan(1);
  });
}

for (const [como, abrir] of [
  ['con «Registrar apuesta»', async (page: Page) => {
    await page.goto('/apuestas');
    await page.getByRole('button', { name: /Registrar apuesta/ }).click();
    await page.getByRole('button', { name: 'A mano' }).click();
  }],
  ['desde «Mi selección», con el borrador', async (page: Page) => {
    await page.addInitScript(() => localStorage.setItem('predictor.borradorApuesta', '{}'));
    await page.goto('/apuestas?borrador=1');
  }],
] as const) {
  test(`N5: el formulario abierto ${como} mientras cargan los paneles del banco no se va abajo`, async ({ page }) => {
    const soltarPapel = await retener(page, '**/api/paper');
    const soltarCartera = await retener(page, '**/api/staking/book?*');
    await abrir(page);
    const cantidad = page.getByLabel('Cantidad');
    await expect(cantidad).toBeVisible();
    await cantidad.fill('25');
    const antes = (await cantidad.boundingBox())!.y;
    soltarPapel();
    soltarCartera();
    await expect(page.getByRole('heading', { name: 'El modelo apostando solo' })).toBeVisible();
    await page.waitForTimeout(300);
    // Antes, a 390 px bajaba 500 px y salía de la pantalla, con lo escrito dentro.
    expect(Math.abs((await cantidad.boundingBox())!.y - antes)).toBeLessThan(1);
    await expect(cantidad).toHaveValue('25');
  });
}

test('N8: los esqueletos de Apuestas y Diagnóstico no dicen «Cargando partidos»', async ({ page }) => {
  // Lo que oye un lector de pantalla mientras carga: allí no se cargan partidos.
  const esqueleto = page.locator('main [aria-busy="true"]').first();
  const soltarApuestas = await retener(page, '**/api/bets*');
  await page.goto('/apuestas');
  await expect(esqueleto).toBeVisible();
  await expect(esqueleto).not.toHaveAttribute('aria-label', 'Cargando partidos');
  soltarApuestas();
  const soltarCartera = await retener(page, '**/api/staking/book?*');
  await page.reload();
  await expect(page.getByRole('button', { name: /Registrar apuesta/ })).toBeVisible();
  await expect(esqueleto).toBeVisible();
  await expect(esqueleto).not.toHaveAttribute('aria-label', 'Cargando partidos');
  soltarCartera();
  const soltarDiagnostico = await retener(page, '**/api/scheduler');
  await page.goto('/confianza/diagnostico');
  await expect(esqueleto).toBeVisible();
  await expect(esqueleto).not.toHaveAttribute('aria-label', 'Cargando partidos');
  soltarDiagnostico();
});

test('N8: si no se pueden cargar las apuestas, Apuestas lo dice, no que no hay ninguna', async ({ page }) => {
  await page.route('**/api/bets*', (r) => r.fulfill({ status: 500, json: { error: 'caída' } }));
  await page.goto('/apuestas');
  await expect(page.getByText(/No se han podido cargar tus apuestas/)).toBeVisible();
  // «Todavía no has registrado ninguna apuesta» no se sabe: la petición falló.
  await expect(page.getByText('Todavía no has registrado ninguna apuesta')).toHaveCount(0);
});

test('N9: con el aviso de datos viejos de la liga, «Detalles» no baja y sube cuando llegan', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.today.open', '0'));
  // En fútbol, baloncesto, béisbol y NFL el aviso es el de la liga elegida, y la liga se elige un
  // render después de llegar los contadores. Una liga con partidos y con el archivo viejo.
  let soltar: () => void = () => {};
  let retenido: Promise<void> = Promise.resolve();
  await page.route('**/api/football/leagues', async (r) => {
    const res = await r.fetch();
    const ligas = (await res.json()) as { id: string }[];
    await r.fulfill({ response: res, json: ligas.map((l) => (l.id === 'epl' ? { ...l, hasUpcoming: true, upcomingCount: 3, matches: 100 } : l)) });
  });
  await page.route('**/api/football/meta', async (r) => {
    await retenido;
    const res = await r.fetch();
    const m = (await res.json()) as { counts: object; leagues: { id: string }[] };
    await r.fulfill({
      response: res,
      json: { ...m, dataSource: 'archivo', counts: { ...m.counts, matches: 1_234_567 }, leagues: m.leagues.map((l) => (l.id === 'epl' ? { ...l, historyThrough: '2025-09-28' } : l)) },
    });
  });
  await page.goto('/futbol');
  await expect(page.getByText(/1\.234\.567 partidos/)).toBeVisible();
  await page.waitForTimeout(400);
  retenido = new Promise<void>((ok) => (soltar = ok));
  // Sin la liga en la dirección (como al llegar desde la barra de pestañas): se elige al llegar.
  await page.goto('/futbol');
  await expect(page.getByRole('button', { name: /^Detalles/ })).toBeVisible();
  // Con la CPU de un móvil: sin ella, la liga se elige en el mismo fotograma en que llegan los
  // contadores y el hueco entre los dos no se llega a pintar.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  // Dónde está «Detalles» en cada fotograma desde que llegan los contadores.
  await page.evaluate(() => {
    const w = window as unknown as { __ys: number[] };
    w.__ys = [];
    const boton = [...document.querySelectorAll('button')].find((b) => /^Detalles/.test(b.textContent ?? ''))!;
    const f = () => {
      w.__ys.push(boton.getBoundingClientRect().y);
      if (w.__ys.length < 300) requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  soltar();
  await expect(page.getByText(/1\.234\.567 partidos/)).toBeVisible();
  await page.waitForTimeout(1000);
  const ys = await page.evaluate(() => (window as unknown as { __ys: number[] }).__ys);
  // Antes: los contadores llegaban, la fila se encogía 35 px y volvía a crecer con el aviso.
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
});

for (const [ruta, ligas] of [
  ['/futbol', '**/api/football/leagues'],
  ['/baloncesto', '**/api/basketball/leagues'],
  ['/beisbol', '**/api/baseball/leagues'],
  ['/nfl', '**/api/nfl/leagues'],
] as const) {
  test(`N12: si ${ruta} no puede cargar, dice el error y no «No hay partidos próximos para esta liga»`, async ({ page }) => {
    await page.route(ligas, (r) => r.fulfill({ status: 500, json: { error: 'caída' } }));
    await page.goto(ruta);
    await expect(page.getByRole('button', { name: /Actualizar/ })).toBeVisible();
    await expect(page.getByText(/No se pudo cargar|500|caída/).first()).toBeVisible();
    // Con la petición fallida no se sabe si hay partidos: «el modelo está listo» no es verdad.
    await expect(page.getByText(/No hay partidos próximos para/)).toHaveCount(0);
  });
}

for (const [ruta, ligas, partidos, primera, segunda, nombre] of [
  ['/futbol', '**/api/football/leagues', '**/api/football/fixtures/upcoming?*', 'epl', 'laliga', 'LaLiga'],
  ['/baloncesto', '**/api/basketball/leagues', '**/api/basketball/games/upcoming?*', 'nba', 'wnba', 'WNBA'],
  ['/beisbol', '**/api/baseball/leagues', '**/api/baseball/games/upcoming?*', 'mlb', 'npb', 'NPB'],
  ['/nfl', '**/api/nfl/leagues', '**/api/nfl/games/upcoming?*', 'nfl', 'ncaaf', 'NCAA'],
] as const) {
  test(`N16: en ${ruta}, el error al cargar una liga no se queda al pasar a otra`, async ({ page }) => {
    // Dos ligas con partidos; la primera no puede cargarlos.
    await page.route(ligas, async (r) => {
      const res = await r.fetch();
      const todas = (await res.json()) as { id: string }[];
      const con = { hasUpcoming: true, upcomingCount: 2, matches: 100, games: 100 };
      await r.fulfill({ response: res, json: todas.map((l) => (l.id === primera || l.id === segunda ? { ...l, ...con } : l)) });
    });
    await page.route(partidos, (r) => (new URL(r.request().url()).searchParams.get('league') === primera ? r.fulfill({ status: 500, json: { error: 'caída' } }) : r.continue()));
    await page.goto(`${ruta}/${primera}`);
    const aviso = page.getByText(/→ (HTTP )?500/);
    await expect(aviso).toBeVisible();
    await page.locator(`button[title^="${nombre} ·"]`).click();
    // La otra liga sí contestó, y sin partidos: el error era de la primera. Antes seguía ahí, y
    // tapaba que no hay partidos.
    await expect(page.getByText(`No hay partidos próximos para ${nombre}`)).toBeVisible();
    await expect(aviso).toHaveCount(0);
  });
}

test('N17: en fútbol, con el historial viejo, el aviso largo está en «Detalles» una vez y no empuja la lista al llegar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.today.open', '0'));
  // Una liga con partidos, con modelo (como todas las de los datos de verdad) y con el historial
  // viejo (como la revisión, que lo forzó así).
  await page.route('**/api/football/leagues', async (r) => {
    const res = await r.fetch();
    const ligas = (await res.json()) as { id: string }[];
    await r.fulfill({ response: res, json: ligas.map((l) => (l.id === 'epl' ? { ...l, hasUpcoming: true, upcomingCount: 3, matches: 100, hasModel: true } : l)) });
  });
  let soltar: () => void = () => {};
  let retenido: Promise<void> = Promise.resolve();
  await page.route('**/api/football/meta', async (r) => {
    await retenido;
    const res = await r.fetch();
    const m = (await res.json()) as { leagues: { id: string }[] };
    await r.fulfill({ response: res, json: { ...m, dataSource: 'archivo', leagues: m.leagues.map((l) => (l.id === 'epl' ? { ...l, historyThrough: '2023-01-01' } : l)) } });
  });
  // Los partidos no llegan: la lista se queda en su esqueleto.
  await page.route('**/api/football/fixtures/upcoming?*', () => {});
  const pildora = page.getByText('datos de ene 2023');
  // Quien vuelve: lo que mide la cabecera ya está recordado.
  await page.goto('/futbol');
  await expect(pildora).toBeVisible();
  await page.waitForTimeout(400);
  retenido = new Promise<void>((ok) => (soltar = ok));
  await page.goto('/futbol');
  const esqueleto = page.locator('[aria-busy="true"]').last();
  await expect(esqueleto).toBeVisible();
  await page.waitForTimeout(400);
  const antes = (await esqueleto.boundingBox())!.y;
  soltar();
  await expect(pildora).toBeVisible();
  await page.waitForTimeout(400);
  // Antes, el aviso entero (209 px en el móvil) salía también debajo de las ligas, encima del
  // esqueleto, y lo bajaba al llegar (CLS 0,13). Plegada, la cabecera ya lo dice con la píldora.
  expect((await esqueleto.boundingBox())!.y - antes).toBe(0);
  const largo = page.getByText(/^El historial termina en/);
  await expect(largo).toHaveCount(0);
  await page.getByRole('button', { name: /^Detalles/ }).click();
  await expect(largo).toHaveCount(1);
});

for (const [ruta, deporte, partidos, liga] of [
  ['/futbol', 'football', '**/api/football/fixtures/upcoming?*', 'epl'],
  ['/baloncesto', 'basketball', '**/api/basketball/games/upcoming?*', 'nba'],
  ['/beisbol', 'baseball', '**/api/baseball/games/upcoming?*', 'mlb'],
] as const) {
  test(`N17: en ${ruta}, la lista no se mueve ni un píxel cuando llegan las ligas`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('predictor.today.open', '0'));
    await page.route(`**/api/${deporte}/leagues`, async (r) => {
      const res = await r.fetch();
      const ligas = (await res.json()) as { id: string }[];
      const con = { hasUpcoming: true, upcomingCount: 3, matches: 100, games: 100, hasModel: true };
      await r.fulfill({ response: res, json: ligas.map((l) => (l.id === liga ? { ...l, ...con } : l)) });
    });
    let soltar: () => void = () => {};
    let retenido: Promise<void> = Promise.resolve();
    await page.route(`**/api/${deporte}/meta`, async (r) => {
      await retenido;
      await r.continue();
    });
    await page.route(partidos, () => {});
    const pastilla = page.locator('main button[title*=" · "]');
    // Quien vuelve: lo que mide la cabecera ya está recordado.
    await page.goto(ruta);
    await expect(pastilla).toBeVisible();
    await page.waitForTimeout(400);
    retenido = new Promise<void>((ok) => (soltar = ok));
    await page.goto(ruta);
    const esqueleto = page.locator('[aria-busy="true"]').last();
    await expect(esqueleto).toBeVisible();
    await page.waitForTimeout(400);
    const antes = (await esqueleto.boundingBox())!.y;
    soltar();
    await expect(pastilla).toBeVisible();
    await page.waitForTimeout(400);
    // El hueco de la fila de ligas medía 1 px más que la fila (38 por 37 en fútbol, 34 por 33 en los
    // demás): la lista subía ese píxel al llegar, en cada visita (los 0,0013 que quedaban).
    expect((await esqueleto.boundingBox())!.y - antes).toBe(0);
  });
}

for (const ancho of [280, 390, 1280]) {
  test(`N14: a ${ancho} px, la campana no mueve nada cuando llega`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 800 });
    if (ancho >= 1024) await page.emulateMedia({ reducedMotion: 'reduce' });
    const soltar = await retener(page, '**/api/bandeja/contador');
    await page.goto('/confianza');
    // En el móvil, la cabecera; en el escritorio, los deportes de la barra lateral, debajo de la
    // fila donde va la campana.
    const zona = ancho >= 1024 ? page.locator('aside nav').first() : page.locator('header').first();
    await expect(zona).toBeVisible();
    await page.waitForTimeout(500);
    const antes = (await zona.boundingBox())!;
    soltar();
    await expect(page.getByTestId('campana')).toBeVisible();
    await page.waitForTimeout(300);
    const despues = (await zona.boundingBox())!;
    // Antes llegaba a los 950 ms y la cabecera crecía: 2 px, y 10 a 280 y 300 px, donde el nombre
    // de la app bajaba de línea (CLS 0,047). En el escritorio, la fila se partía en dos y los
    // deportes bajaban 40 px.
    expect([despues.y, despues.height]).toEqual([antes.y, antes.height]);
  });
}

test('N14: con la bandeja apagada, la vez siguiente no se guarda el sitio de la campana', async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 800 });
  await page.route('**/api/bandeja/contador', (r) => r.fulfill({ status: 404, json: { error: 'apagada' } }));
  await page.goto('/confianza');
  const cabecera = page.locator('header').first();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('predictor.campana'))).toBe('0');
  await page.waitForTimeout(300);
  const sinCampana = (await cabecera.boundingBox())!;
  // Mientras llega la respuesta, nada: si se guardara el sitio, la cabecera mediría lo que con ella
  // y luego se encogería.
  await page.unroute('**/api/bandeja/contador');
  await retener(page, '**/api/bandeja/contador');
  await page.reload();
  await expect(page.getByRole('button', { name: /Actualizar/ }).or(page.getByRole('heading', { level: 2 })).first()).toBeVisible();
  await page.waitForTimeout(500);
  const mientras = (await cabecera.boundingBox())!;
  expect([mientras.y, mientras.height]).toEqual([sinCampana.y, sinCampana.height]);
  await expect(page.getByTestId('campana')).toHaveCount(0);
});

test('N11: la primera vez, sin partidos hoy, «¿Acertó?» no es una tarjeta vacía de 324 px mientras cargan los resultados', async ({ page }) => {
  await page.route('**/api/today', (r) => r.fulfill({ json: { nota: null, partidos: [] } }));
  const soltar = await retener(page, '**/api/recent-results*');
  await page.goto('/tenis');
  const cabecera = page.getByRole('button', { name: /^Cómo le fue al modelo/ });
  await expect(cabecera).toBeVisible();
  await page.waitForTimeout(400);
  // Sin alto recordado no hay nada que reservar: se pinta plegado, a su alto. Antes reservaba el de
  // «Hoy» abierto (324 px) en una tarjeta plegada y vacía, que luego se cerraba.
  const panel = page.locator('section', { has: cabecera });
  expect((await panel.boundingBox())!.height).toBeLessThan(120);
  soltar();
});
