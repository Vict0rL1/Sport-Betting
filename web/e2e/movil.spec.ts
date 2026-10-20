import { test, expect } from '@playwright/test';

// Lote K: la app en el móvil (docs/plans/fixes-K.md). A 390 px, con pantalla táctil: sin hover y
// con puntero grueso, como un teléfono.
// Sin service worker: sus fetch no pasan por page.route, y aquí se retrasan respuestas a propósito.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
});
// Una respuesta retenida o reescrita que sigue en vuelo cuando la prueba acaba no es un fallo de
// la prueba: se suelta sin más.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Las ligas de fútbol de la base del e2e no tienen partidos, así que la página no elige ninguna.
 * Con una que sí, la elige y la pone en la dirección (/futbol → /futbol/epl), como en la app de
 * verdad. `retraso`: lo que tardan en llegar, como con la red de un móvil.
 */
async function conLiga(page: import('@playwright/test').Page, retraso = 0) {
  await page.route('**/api/football/leagues', async (r) => {
    const res = await r.fetch();
    const ligas = (await res.json()) as { id: string }[];
    if (retraso) await espera(retraso);
    await r.fulfill({ response: res, json: ligas.map((l) => (l.id === 'epl' ? { ...l, hasUpcoming: true, upcomingCount: 3, matches: 100 } : l)) });
  });
}

test('K1: la hoja «Deportes» no se cierra sola cuando el deporte añade la liga a la dirección', async ({ page }) => {
  // Las ligas tardan, como con la red de un móvil o la máquina de Fly despertando: mientras, la
  // dirección es /futbol, y al llegar pasa a /futbol/<liga>.
  await conLiga(page, 1500);
  await page.goto('/destacados');
  const barra = page.getByTestId('barra-inferior');
  const hoja = page.getByRole('dialog', { name: 'Deportes' });
  await barra.getByRole('button', { name: 'Deportes' }).click();
  await hoja.getByRole('button', { name: 'Fútbol' }).click();
  await expect(hoja).toBeHidden();
  await expect(page).toHaveURL(/\/futbol$/);
  // Quien se equivocó de deporte vuelve a abrirla enseguida.
  await barra.getByRole('button', { name: 'Deportes' }).click();
  await expect(hoja).toBeVisible();
  await expect(page).toHaveURL(/\/futbol\/[a-z0-9-]+$/, { timeout: 10_000 });
  await espera(300);
  await expect(hoja).toBeVisible();
  // Elegir sí la cierra, también el deporte en el que ya se está.
  await hoja.getByRole('button', { name: 'Fútbol' }).click();
  await expect(hoja).toBeHidden();
  await barra.getByRole('button', { name: 'Deportes' }).click();
  await hoja.getByRole('button', { name: 'Tenis' }).click();
  await expect(hoja).toBeHidden();
  await expect(page).toHaveURL(/\/tenis/);
  // Y «atrás» también: es navegar.
  await barra.getByRole('button', { name: 'Deportes' }).click();
  await expect(hoja).toBeVisible();
  await page.goBack();
  await expect(hoja).toBeHidden();
});

// «Hoy» con siete partidos fijos: lo de la demostración depende de la hora a la que se corra.
const SIETE = {
  nota: null,
  partidos: Array.from({ length: 7 }, (_, i) => ({
    deporte: 'NHL',
    cuando: new Date(Date.now() + (i + 1) * 3600_000).toISOString(),
    partido: `Equipo ${i + 1} @ Rival ${i + 1}`,
    favorito: `Equipo ${i + 1}`,
    probabilidad: 0.55,
    precioReal: false,
    empezado: false,
  })),
};
const panelHoy = (page: import('@playwright/test').Page) => page.locator('section', { has: page.getByRole('button', { name: /^Hoy/ }) });

test('K2: en el móvil, «Hoy» enseña tres partidos y lo del deporte cabe en la primera pantalla', async ({ page }) => {
  await page.route('**/api/today', (r) => r.fulfill({ json: SIETE }));
  await conLiga(page);
  await page.goto('/futbol');
  const panel = panelHoy(page);
  const filas = panel.locator('tbody tr');
  await expect(filas.first()).toBeVisible();
  await expect(filas.filter({ visible: true })).toHaveCount(3);
  // Sin desplazamiento propio: el dedo mueve la página, no una caja dentro de ella.
  expect(await panel.locator('table').evaluate((t) => t.parentElement!.scrollHeight > t.parentElement!.clientHeight + 1)).toBe(false);
  // Lo de fútbol (las ligas) se ve sin desplazar, por encima de la barra inferior.
  const liga = page.getByRole('tab', { name: /Premier League/ });
  await expect(liga).toBeVisible();
  const caja = (await liga.boundingBox())!;
  const barra = (await page.getByTestId('barra-inferior').boundingBox())!;
  expect(caja.y + caja.height, 'las ligas, por encima de la barra inferior').toBeLessThanOrEqual(barra.y);
  // El resto, a un toque.
  await panel.getByRole('button', { name: 'Ver los 7 partidos' }).click();
  await expect(filas.filter({ visible: true })).toHaveCount(7);
  await panel.getByRole('button', { name: 'Ver menos' }).click();
  await expect(filas.filter({ visible: true })).toHaveCount(3);
});

test('K3: el interruptor «Qué hay hoy / ¿Acertó?» no empuja la lista al llegar los resultados', async ({ page }) => {
  await page.route('**/api/today', (r) => r.fulfill({ json: SIETE }));
  await page.route('**/api/recent-results*', async (r) => {
    await espera(1200);
    await r.continue();
  });
  const llegan = page.waitForResponse('**/api/recent-results*');
  await page.goto('/futbol');
  const primera = panelHoy(page).locator('tbody tr').first();
  await expect(primera).toBeVisible();
  const antes = (await primera.boundingBox())!.y;
  await llegan;
  await expect(page.getByRole('button', { name: '¿Acertó?' })).toBeVisible();
  await espera(200);
  expect((await primera.boundingBox())!.y).toBe(antes);
});

test.describe('en el escritorio', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('K2: a 1280 px «Hoy» sigue enseñando todos los partidos, sin botón', async ({ page }) => {
    await page.route('**/api/today', (r) => r.fulfill({ json: SIETE }));
    await page.goto('/futbol');
    const panel = panelHoy(page);
    await expect(panel.locator('tbody tr').filter({ visible: true })).toHaveCount(7);
    await expect(panel.getByRole('button', { name: 'Ver los 7 partidos' })).toBeHidden();
  });
});

test('K4: «Lo que el modelo ve más probable» y «Los partidos» se leen enteros a 390 px', async ({ page }) => {
  await page.goto('/tenis');
  for (const titulo of ['Lo que el modelo ve más probable', 'Los partidos']) {
    const seccion = page.locator('section', { has: page.getByRole('button', { name: new RegExp(`^${titulo}`) }) });
    // Tenis es la pestaña lenta de la demostración (las otras pruebas de tenis van con test.slow()).
    await expect(seccion.getByText(/\d+,\d\s%/).first()).toBeVisible({ timeout: 20_000 });
    // Nada a la derecha de la pantalla: la probabilidad del modelo, el mercado y la cuota caben.
    const fuera = await seccion.evaluate((s) =>
      [...s.querySelectorAll('*')]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.right > window.innerWidth + 0.5;
        })
        .map((e) => (e.textContent ?? '').trim().slice(0, 30)),
    );
    expect(fuera, titulo).toEqual([]);
  }
});

test('K4: lo que se desplaza de lado se difumina por donde hay más', async ({ page }) => {
  await page.goto('/tenis');
  await page.waitForLoadState('networkidle');
  // La fila de deportes de la cabecera y la clasificación por Elo del tenis no caben a 390 px.
  const medir = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('header *, main *')]
        .filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1)
        .map((e) => {
          const s = getComputedStyle(e);
          return { mascara: s.maskImage, izq: s.getPropertyValue('--desliza-izq'), der: s.getPropertyValue('--desliza-der'), al: e.scrollLeft, max: e.scrollWidth - e.clientWidth };
        }),
    );
  const alPrincipio = await page.evaluate(() => {
    for (const e of document.querySelectorAll<HTMLElement>('header *, main *')) if (['auto', 'scroll'].includes(getComputedStyle(e).overflowX)) e.scrollLeft = 0;
  });
  void alPrincipio;
  await page.waitForTimeout(100);
  const antes = await medir();
  expect(antes.length).toBeGreaterThanOrEqual(2);
  for (const m of antes) {
    expect(m.mascara, JSON.stringify(m)).not.toBe('none');
    expect(m.der, JSON.stringify(m)).toBe('32px');
    expect(m.izq, JSON.stringify(m)).toBe('0px');
  }
  await page.evaluate(() => {
    for (const e of document.querySelectorAll<HTMLElement>('header *, main *')) if (['auto', 'scroll'].includes(getComputedStyle(e).overflowX)) e.scrollLeft = e.scrollWidth;
  });
  await page.waitForTimeout(100);
  for (const m of await medir()) {
    expect(m.izq, JSON.stringify(m)).toBe('32px');
    expect(m.der, JSON.stringify(m)).toBe('0px');
  }
});

const SPORTS = ['BaseballDashboard', 'BasketballDashboard', 'FootballDashboard', 'NflDashboard', 'NhlDashboard', 'TennisDashboard', 'UfcDashboard'];

test('K5: los deportes se precargan, y con la red cortada cambiar de deporte sigue funcionando', async ({ page, context }) => {
  const pedidos = new Set<string>();
  // Cada trozo pide después los suyos: hasta que no queda nada en vuelo no está cargado.
  let enVuelo = 0;
  let ultimo = Date.now();
  const esFichero = (u: string) => u.includes('/assets/');
  page.on('request', (r) => {
    const m = /\/assets\/(\w+)-[\w-]+\.js$/.exec(r.url());
    if (m) pedidos.add(m[1]);
    if (esFichero(r.url())) (enVuelo++, (ultimo = Date.now()));
  });
  for (const fin of ['requestfinished', 'requestfailed'] as const) {
    page.on(fin, (r) => {
      if (esFichero(r.url())) (enVuelo--, (ultimo = Date.now()));
    });
  }
  await page.goto('/destacados');
  await expect.poll(() => SPORTS.filter((s) => pedidos.has(s)), { timeout: 15_000 }).toEqual(SPORTS);
  await expect.poll(() => enVuelo === 0 && Date.now() - ultimo > 500, { timeout: 15_000 }).toBe(true);
  // Sin red (la máquina de Fly parada, el metro): la UFC no se había abierto y aun así se abre;
  // lo que no llega son sus datos, y eso lo dice ella.
  await context.setOffline(true);
  await page.getByTestId('barra-inferior').getByRole('button', { name: 'Deportes' }).click();
  await page.getByRole('dialog', { name: 'Deportes' }).getByRole('button', { name: 'UFC' }).click();
  await expect(page).toHaveURL(/\/ufc/);
  await expect(page.getByText(/No se pudieron cargar los datos de la UFC/)).toBeVisible();
  await expect(page.getByText('Ha fallado esta pantalla', { exact: false })).toHaveCount(0);
  await context.setOffline(false);
});

test('K5: mientras llega una pantalla, su esqueleto y no «Cargando…»', async ({ page }) => {
  // El trozo de la NFL no llega hasta que el test lo suelta: lo que se ve mientras es la espera.
  let soltar!: () => void;
  const retenido = new Promise<void>((r) => (soltar = r));
  await page.route('**/assets/NflDashboard-*.js', async (r) => {
    await retenido;
    await r.continue();
  });
  await page.goto('/nfl');
  await expect(page.locator('main [aria-busy="true"]').first()).toBeVisible();
  await expect(page.locator('main').getByText('Cargando…', { exact: true })).toHaveCount(0);
  soltar();
});

test.describe('con «ahorro de datos»', () => {
  test('K5: no se precarga nada que no se haya pedido', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
    const pedidos = new Set<string>();
    page.on('request', (r) => {
      const m = /\/assets\/(\w+)-[\w-]+\.js$/.exec(r.url());
      if (m) pedidos.add(m[1]);
    });
    await page.goto('/destacados');
    await page.waitForLoadState('networkidle');
    await espera(2500);
    expect(SPORTS.filter((s) => pedidos.has(s))).toEqual([]);
  });
});

test('K6: lo que se toca responde mientras el dedo está encima, sin el destello gris del navegador', async ({ page }) => {
  await page.goto('/destacados');
  const boton = page.getByTestId('barra-inferior').getByRole('button', { name: 'Apuestas' });
  const opacidad = () => boton.evaluate((b) => Number(getComputedStyle(b).opacity));
  expect(await boton.evaluate((b) => getComputedStyle(b).getPropertyValue('-webkit-tap-highlight-color'))).toBe('rgba(0, 0, 0, 0)');
  const caja = (await boton.boundingBox())!;
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await page.mouse.down();
  expect(await opacidad()).toBeLessThan(1);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/apuestas/);
  expect(await opacidad()).toBe(1);
});

test('K7: la hoja «Deportes» sube desde abajo, en cuatro columnas de toque cómodo, y se cierra deslizándola', async ({ page }) => {
  await page.goto('/destacados');
  await page.getByTestId('barra-inferior').getByRole('button', { name: 'Deportes' }).click();
  const hoja = page.getByRole('dialog', { name: 'Deportes' });
  const panel = page.getByTestId('hoja-deportes');
  expect(await panel.evaluate((p) => p.getAnimations().length), 'se mueve al abrir').toBeGreaterThan(0);
  const botones = hoja.getByRole('button').filter({ hasNotText: /^$/ });
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const cajas = await hoja.locator('[data-deporte]').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().toJSON() as DOMRect));
  expect(cajas.length).toBe(7);
  // 4 + 3: las cuatro primeras en la misma fila, la quinta debajo.
  expect(new Set(cajas.slice(0, 4).map((c) => Math.round(c.top))).size).toBe(1);
  expect(cajas[4].top).toBeGreaterThan(cajas[0].top);
  for (const c of cajas) expect(Math.min(c.width, c.height)).toBeGreaterThanOrEqual(44);
  void botones;
  // Deslizarla hacia abajo la cierra (medida ya quieta: mientras sube, su caja está más abajo).
  const quieta = () => panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await quieta();
  const p = (await panel.boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + 12);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(p.x + p.width / 2, p.y + 12 + i * 25);
  await page.mouse.up();
  await expect(hoja).toBeHidden();
  // Un toque sin desplazar no la cierra.
  await page.getByTestId('barra-inferior').getByRole('button', { name: 'Deportes' }).click();
  await expect(hoja).toBeVisible();
  await quieta();
  const q = (await panel.boundingBox())!;
  await page.mouse.click(q.x + q.width / 2, q.y + 12);
  await expect(hoja).toBeVisible();
});

test('K7: tocar la pestaña en la que se está vuelve arriba', async ({ page }) => {
  await page.goto('/confianza');
  await page.waitForLoadState('networkidle');
  // Hasta el final, sea cual sea el largo de la página con los datos de la demostración.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.getByTestId('barra-inferior').getByRole('button', { name: 'Confianza' }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page).toHaveURL(/\/confianza$/);
});

test.describe('con movimiento reducido', () => {
  test.use({ reducedMotion: 'reduce' });
  test('K7: la hoja aparece sin moverse', async ({ page }) => {
    await page.goto('/destacados');
    await page.getByTestId('barra-inferior').getByRole('button', { name: 'Deportes' }).click();
    await expect(page.getByRole('dialog', { name: 'Deportes' })).toBeVisible();
    await page.waitForTimeout(50);
    expect(await page.getByTestId('hoja-deportes').evaluate((p) => p.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  });
});

/** Dónde «cuenta» como este control, recorriendo su vertical de 1 en 1 px por el centro. */
const zona = (loc: import('@playwright/test').Locator) =>
    loc.first().evaluate(async (el) => {
      await el.scrollIntoView({ block: 'center' });
      // Dos fotogramas: las secciones de días van con `content-visibility: auto`, y lo recién
      // desplazado a la vista no responde al toque hasta que se pinta.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const es = (y: number) => {
        const d = document.elementFromPoint(x, y);
        return !!d && (d === el || el.contains(d));
      };
      let alto = 0;
      for (let y = Math.floor(r.top) - 16; y <= Math.ceil(r.bottom) + 16; y++) if (es(y + 0.5)) alto++;
      const propio = [];
      for (let y = Math.ceil(r.top); y < Math.floor(r.bottom); y++) propio.push(es(y + 0.5));
      return { alto, visible: Math.round(r.height), suyoEntero: propio.every(Boolean) };
    });

test('K8: los controles pequeños se aciertan aunque el dedo caiga al lado, sin quitarle sitio al de al lado', async ({ page }) => {
  await page.goto('/tenis');
  await page.waitForLoadState('networkidle');
  const cabecera = page.locator('header');
  for (const [nombre, loc] of [
    ['Buscar', cabecera.getByRole('button', { name: 'Buscar' })],
    ['Estado', cabecera.getByRole('button', { name: /^Estado/ })],
  ] as const) {
    const z = await zona(loc);
    expect(z.alto, `${nombre}: ${JSON.stringify(z)}`).toBeGreaterThanOrEqual(40);
  }
  // En una tarjeta van apilados: cada uno llega al mínimo de WCAG 2.5.8 (24 px) y ninguno tapa
  // lo que se ve del de al lado.
  const tarjeta = page.locator('article', { has: page.getByRole('link', { name: 'Abrir partido ›' }) }).first();
  for (const [nombre, loc] of [
    ['Ver motivos', tarjeta.getByRole('button', { name: /^Ver \d+ motivos? más$/ })],
    ['Abrir partido', tarjeta.getByRole('link', { name: 'Abrir partido ›' })],
    ['Cuánto fiarse', tarjeta.getByRole('button', { name: /^¿Cuánto fiarse\?/ })],
  ] as const) {
    const z = await zona(loc);
    expect(z.alto, `${nombre}: ${JSON.stringify(z)}`).toBeGreaterThanOrEqual(24);
    expect(z.suyoEntero, `${nombre}: ${JSON.stringify(z)}`).toBe(true);
  }
});

test('K10: al cambiar de pantalla, la nueva empieza arriba, no a la altura de la anterior', async ({ page }) => {
  await page.goto('/confianza');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.getByTestId('barra-inferior').getByRole('button', { name: 'Deportes' }).click();
  await page.getByRole('dialog', { name: 'Deportes' }).getByRole('button', { name: 'Tenis' }).click();
  await expect(page).toHaveURL(/\/tenis/);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

// ---------------------------------------------------------------------------------------------
// K12: lo que encontró la revisión de ui-tester al lote K.
// ---------------------------------------------------------------------------------------------

test('K12: tras desplegar «Hoy» y plegarlo, la carga siguiente reserva el alto que de verdad tiene', async ({ page }) => {
  await page.route('**/api/today', (r) => r.fulfill({ json: SIETE }));
  await page.goto('/futbol');
  const panel = panelHoy(page);
  /** Recarga con «Hoy» retenido: lo que se reservó mientras, y lo que mide cuando llega. */
  const recargar = async () => {
    await page.waitForTimeout(300);
    await page.unroute('**/api/today');
    let soltar!: () => void;
    const retenido = new Promise<void>((r) => (soltar = r));
    await page.route('**/api/today', async (r) => {
      await retenido;
      await r.fulfill({ json: SIETE });
    });
    await page.reload();
    const hueco = page.getByTestId('hoy-hueco');
    await expect(hueco).toBeAttached();
    const reservado = (await hueco.boundingBox())!.height;
    soltar();
    await expect(panel).toBeVisible();
    await page.waitForTimeout(200);
    return { reservado, real: (await panel.boundingBox())!.height };
  };
  // Desplegado: la próxima vez nace con tres filas, y eso es lo que tiene que reservar.
  await panel.getByRole('button', { name: 'Ver los 7 partidos' }).click();
  await expect(panel.locator('tbody tr').filter({ visible: true })).toHaveCount(7);
  const desplegado = await recargar();
  expect(Math.abs(desplegado.reservado - desplegado.real), JSON.stringify(desplegado)).toBeLessThanOrEqual(2);
  // Desplegado y plegado: la próxima vez nace plegado.
  await panel.getByRole('button', { name: 'Ver los 7 partidos' }).click();
  await panel.getByRole('button', { name: /^Hoy/ }).click();
  await expect(panel.getByRole('button', { name: /^Hoy/ })).toHaveAttribute('aria-expanded', 'false');
  const plegado = await recargar();
  expect(Math.abs(plegado.reservado - plegado.real), JSON.stringify(plegado)).toBeLessThanOrEqual(2);
});

/** Una caja `desliza-x` de prueba, de 300 px, con `extra` px de más que desplazar. */
const cajaDeslizable = (extra: number, id: string) => `{
  const d = document.createElement('div');
  d.id = '${id}'; d.className = 'desliza-x'; d.tabIndex = 0;
  d.style.cssText = 'overflow-x:auto;width:300px';
  d.innerHTML = '<div style="width:${300 + extra}px;height:20px"></div>';
  document.querySelector('main').prepend(d);
}`;
const dosFotogramas = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

test('K12: el difuminado nunca tapa más de lo que queda por desplazar', async ({ page }) => {
  await page.goto('/glosario');
  await expect(page.locator('main')).toBeAttached();
  await page.evaluate(`${cajaDeslizable(4, 'poca')}; ${cajaDeslizable(400, 'mucha')}`);
  const lado = (id: string, prop: string) => page.evaluate(([i, p]) => parseFloat(getComputedStyle(document.getElementById(i)!).getPropertyValue(p)), [id, prop]);
  await page.evaluate(dosFotogramas);
  // A 740–768 px la tabla de selecciones sobraba 2 px y la última columna salía atenuada entera.
  expect(await lado('poca', '--desliza-der')).toBeLessThanOrEqual(4.5);
  expect(await lado('mucha', '--desliza-der')).toBe(32);
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('#poca, #mucha').forEach((e) => (e.scrollLeft = 9999)));
  await page.evaluate(dosFotogramas);
  expect(await lado('poca', '--desliza-izq')).toBeLessThanOrEqual(4.5);
  expect(await lado('mucha', '--desliza-izq')).toBe(32);
});

test('K12: con el foco del teclado, la caja que se desplaza no se difumina (el anillo se ve entero)', async ({ page }) => {
  await page.goto('/glosario');
  await expect(page.locator('main')).toBeAttached();
  await page.evaluate(`${cajaDeslizable(400, 'caja')}; const b = document.createElement('button'); b.id = 'antes'; b.textContent = 'antes'; document.querySelector('main').prepend(b);`);
  await page.locator('#antes').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#caja')).toBeFocused();
  expect(await page.locator('#caja').evaluate((e) => getComputedStyle(e).maskImage)).toBe('none');
});

test('K12: pulsar el fondo oscuro de la hoja no lo aclara', async ({ page }) => {
  await page.goto('/destacados');
  await page.getByTestId('barra-inferior').getByRole('button', { name: 'Deportes' }).click();
  const hoja = page.getByRole('dialog', { name: 'Deportes' });
  const fondo = hoja.getByRole('button', { name: 'Cerrar' });
  await fondo.evaluate((b) => Promise.all(b.getAnimations().map((a) => a.finished)));
  await page.mouse.move(195, 120);
  await page.mouse.down();
  expect(await fondo.evaluate((b) => Number(getComputedStyle(b).opacity))).toBe(1);
  await page.mouse.up();
  await expect(hoja).toBeHidden();
});

test('K12: más controles pequeños llegan a 24 px sin pisar al de al lado', async ({ page }) => {
  await page.goto('/tenis');
  await page.waitForLoadState('networkidle');
  const pie = page.getByRole('contentinfo');
  const tarjeta = page.locator('article', { has: page.getByRole('link', { name: 'Abrir partido ›' }) }).first();
  await tarjeta.getByRole('button', { name: /^¿Cuánto fiarse\?/ }).click();
  for (const [nombre, loc] of [
    ['Informes (pie)', pie.getByRole('button', { name: 'Informes' })],
    ['Glosario (pie)', pie.getByRole('button', { name: 'Glosario' })],
    ['Ver contra qué se ha medido', page.getByRole('button', { name: 'Ver contra qué se ha medido' })],
    ['Calidad de datos (¿Cuánto fiarse?)', tarjeta.getByRole('button', { name: /^Calidad de datos/ })],
    ['Incertidumbre (¿Cuánto fiarse?)', tarjeta.getByRole('button', { name: /^Incertidumbre/ })],
  ] as const) {
    const z = await zona(loc);
    expect(z.alto, `${nombre}: ${JSON.stringify(z)}`).toBeGreaterThanOrEqual(24);
    expect(z.suyoEntero, `${nombre}: ${JSON.stringify(z)}`).toBe(true);
  }
});

test('K12: en inglés, el botón de «Hoy» dice «matches», como la cabecera', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.idioma', 'en'));
  await page.route('**/api/today', (r) => r.fulfill({ json: SIETE }));
  await page.goto('/futbol');
  await expect(page.getByRole('button', { name: 'See all 7 matches' })).toBeVisible();
});

test.describe('en el escritorio, sin máscara', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('K12: a 1280 px las cajas con desplazamiento no llevan máscara (el texto conserva su suavizado)', async ({ page }) => {
    await page.goto('/confianza');
    await page.waitForLoadState('networkidle');
    const mascaras = await page.evaluate(() => [...document.querySelectorAll('.desliza-x')].map((e) => getComputedStyle(e).maskImage));
    expect(mascaras.length).toBeGreaterThan(0);
    expect(mascaras.filter((m) => m !== 'none')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Lote L (docs/plans/fixes-L.md).
// ---------------------------------------------------------------------------------------------

test('L7: «atrás» desde un partido vuelve a la altura a la que se dejó la lista', async ({ page }) => {
  test.slow();
  await page.goto('/tenis');
  const enlaces = page.getByRole('link', { name: 'Abrir partido ›' });
  await expect(enlaces.nth(2)).toBeAttached({ timeout: 20_000 });
  // El enlace en mitad de la pantalla, donde lo toca una persona. Con scrollIntoViewIfNeeded la
  // página quedaba a 6.695 px pero el enlace 1.551 px por encima de la pantalla (los días de encima
  // se pintan más bajos que los 900 px que reservan), y click() bajaba él mismo a 4.732 antes de
  // pulsar: la altura que se «dejaba» no era la del toque.
  await enlaces.nth(2).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const dejada = await page.evaluate(() => window.scrollY);
  expect(dejada).toBeGreaterThan(600);
  await page.evaluate(() =>
    window.addEventListener('click', () => ((window as unknown as { alTocar: number }).alTocar = window.scrollY), { capture: true, once: true }),
  );
  await enlaces.nth(2).click();
  // Se tocó desde ahí: click() no ha tenido que mover la lista.
  expect(await page.evaluate(() => (window as unknown as { alTocar: number }).alTocar)).toBe(dejada);
  await expect(page).toHaveURL(/\/partido\//);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/tenis/);
  // La lista vuelve a cargar sus partidos: la altura se recupera en cuanto hay sitio para ella.
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 8_000 }).toBeGreaterThan(dejada - 40);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(dejada + 40);
});

test('N1: en una lista de muchos días, «atrás» vuelve al mismo partido, no solo a la misma altura', async ({ page }) => {
  test.slow();
  // Seis días de partidos. Cada día se pinta al acercarse a la pantalla (content-visibility) y,
  // mientras, reserva 900 px: al volver, los días de encima no miden lo que medían al irse.
  await page.route('**/api/matches/upcoming?*', async (r) => {
    const res = await r.fetch();
    const base = (await res.json()) as { match: { id: string; commence_time: string } }[];
    const dias = Array.from({ length: 6 }, (_, d) =>
      base.map((x) => ({ ...x, match: { ...x.match, id: `${x.match.id}-d${d}`, commence_time: new Date(Date.parse(x.match.commence_time) + d * 86_400_000).toISOString() } })),
    ).flat();
    await r.fulfill({ response: res, json: dias });
  });
  await page.goto('/tenis');
  const enlaces = page.getByRole('link', { name: 'Abrir partido ›' });
  await expect(enlaces.nth(20)).toBeAttached({ timeout: 20_000 });
  const elegido = enlaces.nth((await enlaces.count()) - 3);
  // Dos veces: al acercarse, los días de en medio se pintan y cambian de alto.
  for (let i = 0; i < 2; i++) {
    await elegido.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
  }
  const href = (await elegido.getAttribute('href'))!;
  const antes = (await elegido.boundingBox())!.y;
  await elegido.click();
  await expect(page).toHaveURL(/\/partido\//);
  await page.goBack();
  await expect(page).toHaveURL(/\/tenis/);
  // El partido que se abrió, donde estaba en la pantalla.
  const mismo = page.locator(`a[href="${href}"]`);
  await expect.poll(async () => Math.round((await mismo.boundingBox())?.y ?? -1e6), { timeout: 8_000 }).toBeGreaterThan(antes - 40);
  await page.waitForTimeout(600);
  const despues = (await mismo.boundingBox())!.y;
  expect(Math.abs(despues - antes), `antes ${Math.round(antes)}, después ${Math.round(despues)}`).toBeLessThan(40);
});

/** «¿Acertó?» con un resultado de fútbol que ganó el de casa (la base del e2e no tiene fútbol). */
async function conGanador(page: import('@playwright/test').Page, casa: string) {
  await page.addInitScript(() => {
    localStorage.setItem('predictor.today.open', '1');
    localStorage.setItem('predictor.today.view', 'resultados');
  });
  const dia = new Date().toISOString().slice(0, 10);
  await page.route('**/api/recent-results*', async (r) => {
    const res = await r.fetch();
    const j = (await res.json()) as { resultados: unknown[] };
    j.resultados.unshift({ deporte: 'Fútbol', liga: 'epl', dia, cuando: null, partido: `${casa} - Sheffield United`, casa, fuera: 'Sheffield United', casaId: null, fueraId: null, favorito: casa, probabilidad: 0.61, ganador: casa, acerto: true, origen: 'reconstruida' });
    await r.fulfill({ response: res, json: j });
  });
}

/** La etiqueta «ganó» de la fila y dónde acaba el nombre al que acompaña. */
async function medirGano(page: import('@playwright/test').Page) {
  const gano = page.locator('li', { hasText: 'Sheffield United' }).getByText('ganó', { exact: true });
  await expect(gano).toBeVisible();
  return gano.evaluate((el) => {
    const nombre = el.parentElement!.firstChild as Text;
    const r = document.createRange();
    r.selectNodeContents(nombre);
    const lineas = [...r.getClientRects()];
    const g = el.getBoundingClientRect();
    return { alto: g.height, izquierda: g.left, top: g.top, finNombre: lineas.at(-1)!.right, inicioNombre: lineas[0].left, topNombre: lineas.at(-1)!.top };
  });
}

test.describe('«ganó» en el escritorio', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('N7: «ganó» mide y se separa del nombre como antes del lote M', async ({ page }) => {
    await conGanador(page, 'Arsenal');
    await page.goto('/futbol');
    const m = await medirGano(page);
    // Antes de M: 17,8 px de alto y 8 px del nombre. Con M, 16,4 y unos 5.
    expect(m.alto).toBeGreaterThan(17.4);
    expect(m.izquierda - m.finNombre).toBeGreaterThan(7);
    expect(m.izquierda - m.finNombre).toBeLessThan(9);
  });
});

test.describe('«@» en el escritorio', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test('N13: en la NHL, «@» queda a 4 px del visitante, como antes del lote M', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('predictor.today.open', '1');
      localStorage.setItem('predictor.today.view', 'resultados');
    });
    const dia = new Date().toISOString().slice(0, 10);
    await page.route('**/api/recent-results*', async (r) => {
      const res = await r.fetch();
      const j = (await res.json()) as { resultados: unknown[] };
      const [casa, fuera] = ['Boston Bruins', 'Toronto Maple Leafs'];
      j.resultados.unshift({ deporte: 'NHL', liga: 'nhl', dia, cuando: null, partido: `${fuera} @ ${casa}`, casa, fuera, casaId: null, fueraId: null, favorito: casa, probabilidad: 0.58, ganador: casa, acerto: true, origen: 'reconstruida' });
      await r.fulfill({ response: res, json: j });
    });
    await page.goto('/nhl');
    const nombre = page.locator('li', { hasText: 'Boston Bruins' }).getByText('Toronto Maple Leafs');
    await expect(nombre).toBeVisible();
    const hueco = await nombre.evaluate((el) => {
      const r = document.createRange();
      const texto = [...el.childNodes].find((n) => n.nodeType === 3 && (n as Text).data.includes('Toronto')) as Text;
      r.selectNodeContents(texto);
      const fin = [...r.getClientRects()].at(-1)!.right;
      const arroba = [...el.querySelectorAll('span')].find((s) => s.textContent?.includes('@'))!;
      const t = arroba.firstChild as Text;
      const i = t.data.indexOf('@');
      r.setStart(t, i);
      r.setEnd(t, i + 1);
      return r.getClientRects()[0].left - fin;
    });
    // Antes de M: 4 px (el hueco de 8 menos el margen negativo de 4). Con M, el espacio duro de 12 px.
    expect(hueco).toBeGreaterThan(3.5);
    expect(hueco).toBeLessThan(5);
  });
});

test('N7: si «ganó» baja de línea, empieza alineado con el nombre', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await conGanador(page, 'Wolverhampton Wanderers');
  await page.goto('/futbol');
  const m = await medirGano(page);
  expect(m.top, 'en otra línea').toBeGreaterThan(m.topNombre);
  expect(Math.abs(m.izquierda - m.inicioNombre)).toBeLessThan(0.5);
});

test('N10: «atrás» desde el glosario vuelve a Confianza donde se dejó, aunque la página siga creciendo al volver', async ({ page }) => {
  test.slow();
  await page.goto('/confianza');
  const enlace = page.locator('main a[href="/glosario#brier"]');
  await expect(enlace).toBeAttached({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  for (let i = 0; i < 2; i++) {
    await enlace.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
  }
  const antes = (await enlace.boundingBox())!.y;
  await enlace.click();
  await expect(page).toHaveURL(/\/glosario/);
  // Al volver, las secciones de encima (la evaluación y la analítica) tardan, como con los datos de
  // verdad y la red de un móvil: más de los 3 s que hay para llegar a la altura, y la página ya
  // tiene alto para la altura guardada antes de que lleguen.
  let llegadas = 0;
  await page.route(/\/api\/(evaluation|monitoring)/, async (r) => {
    await espera(4000);
    await r.continue();
    llegadas++;
  });
  await page.goBack();
  await expect(page).toHaveURL(/\/confianza$/);
  // Mientras lo de encima no llega, el enlace ya está donde estaba (N15): antes se veía otra sección
  // durante esos segundos y, al llegar, la página saltaba 1.000 px hasta él.
  await page.waitForTimeout(1500);
  expect(llegadas, 'lo de encima aún no ha llegado').toBe(0);
  const mientras = (await enlace.boundingBox())!.y;
  expect(Math.abs(mientras - antes), `antes ${Math.round(antes)}, mientras llega lo de encima ${Math.round(mientras)}`).toBeLessThan(40);
  // Hasta que llega lo de encima: antes, la página aún no mide lo que medía al irse. (Tras «atrás»
  // no hay documento nuevo, y esperar a «networkidle» no espera a nada.)
  await expect.poll(() => llegadas, { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
  await page.waitForTimeout(800);
  // Antes: la vuelta acababa en cuanto la página tenía alto, las secciones de encima seguían
  // llegando y el navegador, para no mover lo que se veía, bajaba la página 1.500 px más.
  const despues = (await enlace.boundingBox())!.y;
  expect(Math.abs(despues - antes), `antes ${Math.round(antes)}, después ${Math.round(despues)}`).toBeLessThan(40);
});

// Lote M (docs/plans/fixes-M.md): lo que la revisión del lote K vio y ya pasaba antes.

test('M1: con un perfil nuevo, tocar «¿Acertó?» enseña los resultados en vez de plegar el panel', async ({ page }) => {
  // Perfil nuevo: nada guardado de «Hoy» (el beforeEach solo salta el recorrido).
  await page.route('**/api/today', (r) => r.fulfill({ json: SIETE }));
  await page.goto('/tenis');
  await expect(page.getByRole('button', { name: /^Hoy/ })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: '¿Acertó?' }).click();
  // Sigue abierto, ahora con lo que dijo el modelo y qué pasó.
  await expect(page.getByRole('button', { name: /^Cómo le fue al modelo/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Qué hay hoy' })).toBeVisible();
  // La visita siguiente, en saltos.spec.ts (N2): nace plegado, sin saltar.
});

for (const ancho of [360, 320, 280]) {
  test(`M2: a ${ancho} px la ficha «Posible value» cabe en su tarjeta`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 800 });
    await page.goto('/tenis');
    const fichas = page.getByText(/^Posible value: /);
    await expect(fichas.first()).toBeAttached({ timeout: 20_000 });
    // Antes, a 320 px la de «Alexander Zverev» acababa 11 px fuera de la pantalla, y a 280, 51.
    for (const ficha of await fichas.all()) {
      const [derecha, fila] = await ficha.evaluate((el) => [el.getBoundingClientRect().right, el.parentElement!.getBoundingClientRect().right]);
      expect(derecha, `${await ficha.textContent()}: dentro de su fila`).toBeLessThanOrEqual(fila + 0.5);
      expect(fila, 'y la fila, dentro de la pantalla').toBeLessThanOrEqual(ancho);
    }
  });
}

for (const ancho of [360, 359, 320, 280]) {
  test(`M3: a ${ancho} px, en «¿Acertó?» un nombre largo se parte entre palabras, no por la mitad`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem('predictor.today.open', '1');
      localStorage.setItem('predictor.today.view', 'resultados');
    });
    // La base del e2e no tiene fútbol: un resultado con el nombre largo de la revisión, que ganó
    // (con su «ganó» al lado, que es lo que le quitaba el sitio).
    const dia = new Date().toISOString().slice(0, 10);
    await page.route('**/api/recent-results*', async (r) => {
      const res = await r.fetch();
      const j = (await res.json()) as { resultados: unknown[] };
      const casa = 'Wolverhampton Wanderers';
      j.resultados.unshift({ deporte: 'Fútbol', liga: 'epl', dia, cuando: null, partido: `${casa} - Sheffield United`, casa, fuera: 'Sheffield United', casaId: null, fueraId: null, favorito: casa, probabilidad: 0.61, ganador: casa, acerto: true, origen: 'reconstruida' });
      await r.fulfill({ response: res, json: j });
    });
    await page.goto('/futbol');
    const fila = page.locator('li', { hasText: 'el modelo dijo' }).filter({ hasText: 'Sheffield United' });
    await expect(fila).toBeVisible();
    // Cuántas líneas ocupa la palabra «Wolverhampton» en el nombre: una, si no se parte.
    const lineas = await fila.evaluate((li) => {
      const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
        if (!n.data.startsWith('Wolverhampton')) continue;
        const r = document.createRange();
        r.setStart(n, 0);
        r.setEnd(n, 'Wolverhampton'.length);
        return r.getClientRects().length;
      }
      return -1;
    });
    expect(lineas).toBe(1);
    // Y el veredicto, una vez y a la vista: a la derecha o, si no cabe, debajo del nombre.
    await expect(fila.getByText('acertó', { exact: true }).filter({ visible: true })).toHaveCount(1);
  });
}
