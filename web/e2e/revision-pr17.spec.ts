// Revisión independiente del PR 17, fase B: estado guardado veraz (B3), filtros activos visibles
// (B4) y procedencia en cada fila (B5). Datos SINTÉTICOS servidos desde aquí (nombres «Sintético»),
// como en partidos.spec.ts; nada de esto prueba un proveedor real.
import { test, expect, type Page } from '@playwright/test';

const ZONA = 'Europe/Madrid';
test.use({ timezoneId: ZONA, locale: 'es-ES', serviceWorkers: 'block' });

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function hoyA(h: number, m = 0, dias = 0): string {
  const [y, mes, d] = HOY.split('-').map(Number);
  const aprox = new Date(Date.UTC(y, mes - 1, d + dias, h, m));
  const enMadrid = new Date(aprox.toLocaleString('en-US', { timeZone: ZONA }));
  const enUtc = new Date(aprox.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(aprox.getTime() - (enMadrid.getTime() - enUtc.getTime())).toISOString();
}

type Fila = Record<string, unknown>;
const fila = (over: Fila): Fila => ({
  sport: 'nhl',
  id: 'nhl-1',
  matchKey: 'nhl|e2e|1',
  liga: { id: 'nhl', nombre: 'NHL' },
  torneo: null,
  cuando: hoyA(22),
  empezado: false,
  local: { nombre: 'Toronto Sintético', id: 'TOR' },
  visitante: { nombre: 'Boston Sintético', id: 'BOS' },
  sede: 'local',
  mercado: { id: 'resultado', resultados: ['local', 'visitante'], excluyentes: true, prorroga: 'incluida' },
  prediccion: { probs: [0.62, 0.38], capturadaEn: hoyA(8, 15), version: 'nhl-sintetica-3', fuente: 'instantanea' },
  sinPrediccion: null,
  cuotas: { precios: [1.7, 2.2], completas: true, casas: 6, recibidasEn: hoyA(9), origen: 'casa', antiguas: false },
  origen: 'real',
  fuenteCalendario: 'casa',
  ...over,
});
const FILAS = [
  fila({}),
  fila({ id: 'nhl-2', matchKey: 'nhl|e2e|2', cuando: hoyA(1, 0), empezado: true, local: { nombre: 'Empezado Sintético', id: 'EMP' }, visitante: { nombre: 'Rival Sintético', id: 'RIV' }, cuotas: null, prediccion: { probs: [0.55, 0.45], capturadaEn: hoyA(0, 30), version: null, fuente: 'registro' }, fuenteCalendario: 'calendario' }),
  fila({ sport: 'football', id: 'fb-1', matchKey: 'laliga|a|b|e2e', liga: { id: 'laliga', nombre: 'LaLiga' }, local: { nombre: 'Atlético Sintético', id: 'a' }, visitante: { nombre: 'Betis Sintético', id: 'b' }, mercado: { id: 'resultado', resultados: ['local', 'empate', 'visitante'], excluyentes: true, prorroga: 'no' }, prediccion: { probs: [0.5, 0.25, 0.25], capturadaEn: hoyA(8), version: 'fb-test', fuente: 'instantanea' }, cuotas: null }),
];

function respuesta(filas: Fila[]) {
  const porDeporte = ['football', 'basketball', 'baseball', 'nfl', 'nhl', 'ufc', 'tennis'].map((sport) => ({ sport, filas: filas.filter((f) => f.sport === sport).length, error: null }));
  return { generado: new Date().toISOString(), desde: hoyA(0), hasta: hoyA(0, 0, 7), filas, cuarentena: { n: 0, ejemplos: [] }, duplicados: 0, porDeporte };
}

async function servir(page: Page) {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  await page.route('**/api/partidos?*', (r) => r.fulfill({ json: respuesta(FILAS) }));
}

const PRE = {
  sport: 'nhl',
  matchKey: 'nhl|e2e|1',
  commence: hoyA(22),
  instantaneas: 2,
  outcomes: ['Toronto Sintético', 'Boston Sintético'],
  horizontes: [],
  cambios: [],
  final: null,
  evaluada: null,
  historial: [
    { id: 101, captured_at: hoyA(7), outcomes: ['Toronto Sintético', 'Boston Sintético'], probs: [0.6, 0.4], model_version: 'nhl-sintetica-3', data_as_of: null, odds_at: null, papel: 'original' },
    { id: 102, captured_at: hoyA(8, 15), outcomes: ['Toronto Sintético', 'Boston Sintético'], probs: [0.62, 0.38], model_version: 'nhl-sintetica-3', data_as_of: null, odds_at: null, papel: 'revision' },
  ],
  entradas: [],
  entradasDe: null,
};

test('B3: si no se puede leer lo guardado, la ficha no dice «Guardar» como si no lo estuviera, y se puede reintentar', async ({ page }) => {
  await servir(page);
  let fallar = true;
  let lecturas = 0;
  await page.route('**/api/guardadas', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    lecturas++;
    return fallar ? r.fulfill({ status: 500, json: { error: 'caído' } }) : r.fulfill({ json: { guardadas: [{ id: 7, sport: 'nhl', match_key: 'nhl|e2e|1', snapshot_id: 102, guardada_en: hoyA(9), captured_at: hoyA(8, 15), probs: [0.62, 0.38], outcomes: ['Toronto Sintético', 'Boston Sintético'], model_version: 'nhl-sintetica-3' }] } });
  });
  await page.route('**/api/prematch/nhl/*', (r) => r.fulfill({ json: PRE }));
  await page.goto('/partido/nhl/nhl-1?clave=' + encodeURIComponent('nhl|e2e|1'));
  const historial = page.locator('ol').filter({ hasText: 'nhl-sintetica-3' });
  // El aviso, una sola vez (no una por fila), con su «reintentar».
  const aviso = page.getByRole('alert').filter({ hasText: 'No se pudo comprobar qué estimaciones tienes guardadas' });
  await expect(aviso).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Guardar esta estimación$/ })).toHaveCount(0);
  // Una sola lectura para toda la ficha, no una por fila del historial.
  expect(lecturas).toBe(1);
  fallar = false;
  await aviso.getByRole('button', { name: /reintentar/ }).click();
  await expect(historial.getByRole('button', { name: /Guardada/ })).toHaveCount(1);
  await expect(historial.getByRole('button', { name: /^Guardar esta estimación$/ })).toHaveCount(1);
});

test('B3: con «Guardados» puesto y lo guardado sin cargar, Partidos lo dice en vez de enseñar una lista incompleta en silencio', async ({ page }) => {
  await servir(page);
  await page.route('**/api/guardadas', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 503, json: { error: 'no' } }) : r.continue()));
  await page.goto('/partidos?guardados=1');
  await expect(page.getByText(/No se pudieron cargar tus estimaciones guardadas/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' }).first()).toBeVisible();
});

test('B4: una competición del enlace se ve como etiqueta que se quita, y el vacío no dice que no hay partidos del deporte', async ({ page }) => {
  await servir(page);
  await page.goto('/partidos?deporte=nhl&liga=khl');
  const chip = page.getByRole('button', { name: /Quitar filtro: competición khl/ });
  await expect(chip).toBeVisible();
  await expect(page.getByText(/No hay partidos de NHL programados/)).toHaveCount(0);
  await expect(page.getByText(/Ningún partido de NHL en la competición khl/)).toBeVisible();
  await chip.click();
  await expect(page).not.toHaveURL(/liga=/);
  await expect(page.getByRole('link', { name: /Toronto Sintético/ })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/liga=khl/);
  await expect(page.getByRole('button', { name: /Quitar filtro: competición khl/ })).toBeVisible();
});

test('B4: con una sola competición la etiqueta también se ve (antes el selector se escondía), y sobrevive al cambio de día', async ({ page }) => {
  await servir(page);
  await page.goto('/partidos?deporte=nhl&liga=nhl');
  await expect(page.getByRole('button', { name: /Quitar filtro: competición NHL/ })).toBeVisible();
  await page.getByRole('button', { name: 'Mañana', exact: true }).click();
  await expect(page).toHaveURL(/dia=manana/);
  await expect(page.getByRole('button', { name: /Quitar filtro: competición NHL/ })).toBeVisible();
});

test('B5: cada fila dice de cuándo es la estimación y, al desplegar, versión, fuente del partido y de las cuotas; un partido empezado no se llama «en directo»', async ({ page }) => {
  await servir(page);
  await page.goto('/partidos?deporte=nhl');
  const fila = page.getByRole('listitem').filter({ hasText: 'Toronto Sintético' });
  await expect(fila.getByText(/Estimación de las 08:15/)).toBeVisible();
  const detalles = fila.getByRole('button', { name: /Procedencia/ });
  await expect(detalles).toHaveAttribute('aria-expanded', 'false');
  await detalles.focus();
  await page.keyboard.press('Enter');
  await expect(detalles).toHaveAttribute('aria-expanded', 'true');
  await expect(fila.getByText('nhl-sintetica-3')).toBeVisible();
  await expect(fila.getByText(/Casa de apuestas/).first()).toBeVisible();
  await expect(fila.getByText(/6 casas/)).toBeVisible();
  const empezado = page.getByRole('listitem').filter({ hasText: 'Empezado Sintético' });
  await expect(empezado.getByText('Empezado', { exact: true })).toBeVisible();
  await expect(page.getByText(/en directo|en vivo/i)).toHaveCount(0);
  await empezado.getByRole('button', { name: /Procedencia/ }).click();
  await expect(empezado.locator('dt', { hasText: 'Versión del modelo' })).toBeVisible();
  await expect(empezado.locator('dd', { hasText: 'DESCONOCIDO' }).first()).toBeVisible();
  await expect(empezado.getByText(/Sin cuotas/)).toBeVisible();
});

test('C: la densidad compacta se recuerda al recargar, no va en la URL y «Quitar filtros» no la toca', async ({ page }) => {
  await servir(page);
  await page.goto('/partidos?deporte=nhl');
  const grupo = page.getByRole('group', { name: 'Densidad de la lista' });
  await grupo.getByRole('button', { name: 'Compacta' }).click();
  await expect(grupo.getByRole('button', { name: 'Compacta' })).toHaveAttribute('aria-pressed', 'true');
  const fila = page.getByRole('listitem').filter({ hasText: 'Toronto Sintético' });
  await expect(fila).toHaveAttribute('data-densidad', 'compacta');
  await expect(fila.getByText(/Estimación de las/)).toHaveCount(0);
  await expect(fila.getByRole('button', { name: /Procedencia/ })).toBeVisible();
  expect(page.url()).not.toContain('densidad');
  await page.getByRole('button', { name: 'Quitar filtros' }).first().click();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Densidad de la lista' }).getByRole('button', { name: 'Compacta' })).toHaveAttribute('aria-pressed', 'true');
});

test('C: si Ajustes no puede leer los interruptores ni los canales, lo dice y deja reintentar (ni «Cargando» eterno ni lista vacía)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  let fallar = true;
  await page.route('**/api/features', (r) => (r.request().method() === 'GET' && fallar ? r.fulfill({ status: 500, json: { error: 'caído' } }) : r.continue()));
  await page.route('**/api/notifications/canales', (r) => (fallar ? r.fulfill({ status: 500, json: { error: 'caído' } }) : r.continue()));
  await page.goto('/ajustes');
  const interruptores = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Interruptores' }) });
  await expect(interruptores.getByRole('alert')).toContainText('No se pudieron cargar');
  const notificaciones = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Notificaciones' }) });
  await expect(notificaciones.getByRole('alert')).toContainText('No se pudieron cargar');
  fallar = false;
  await interruptores.getByRole('button', { name: 'Reintentar' }).click();
  await expect(interruptores.getByRole('alert')).toHaveCount(0);
  await expect(interruptores.locator('li').first()).toBeVisible();
});

test('D1: el historial dice de dónde partió, dónde está, cuánto se movió (pp) y qué versiones intervinieron', async ({ page }) => {
  await servir(page);
  await page.route('**/api/guardadas', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { guardadas: [] } }) : r.continue()));
  await page.route('**/api/prematch/nhl/*', (r) =>
    r.fulfill({
      json: {
        ...PRE,
        historial: [
          { ...PRE.historial[0], model_version: 'nhl-sintetica-2', probs: [0.4, 0.6] },
          { ...PRE.historial[1], probs: [0.62, 0.38] },
        ],
      },
    }),
  );
  await page.goto('/partido/nhl/nhl-1?clave=' + encodeURIComponent('nhl|e2e|1'));
  const h = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Historial' }) });
  await expect(h.getByText(/2 estimaciones/)).toBeVisible();
  await expect(h.getByText(/Toronto Sintético \+22,0 pp/).first()).toBeVisible();
  await expect(h.getByText('(el favorito cambió)')).toBeVisible();
  await expect(h.getByText(/Versiones del modelo: nhl-sintetica-2 → nhl-sintetica-3/)).toBeVisible();
  await expect(h.getByText(/versión nueva: nhl-sintetica-3/)).toBeVisible();
  await expect(h.getByText('última', { exact: true })).toBeVisible();
  // El orden de la ficha: la estimación vigente antes que el historial, y las acciones al final.
  const titulos = await page.locator('main h3').allTextContents();
  const i = (x: string) => titulos.findIndex((y) => y.includes(x));
  expect(i('Historial')).toBeGreaterThan(-1);
  expect(i('Lo que puedes hacer')).toBeGreaterThan(i('Historial'));
});

test('D2: en una pantalla ancha el partido se abre en un panel lateral; Escape y «atrás» lo cierran y el foco vuelve a la fila', async ({ page }) => {
  await servir(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/partidos?deporte=nhl');
  const enlace = page.getByRole('link', { name: /Toronto Sintético – Boston Sintético/ });
  await enlace.click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/panel=nhl%3Anhl-1|panel=nhl:nhl-1/);
  await expect(panel.getByRole('link', { name: 'Abrir la página completa' })).toHaveAttribute('href', /\/partido\/nhl\/nhl-1\?clave=/);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/panel=/);
  await expect(enlace).toBeFocused();
  await enlace.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/deporte=nhl/);
  await enlace.click();
  await page.getByRole('dialog').getByRole('link', { name: 'Abrir la página completa' }).click();
  await expect(page).toHaveURL(/\/partido\/nhl\/nhl-1/);
});

test('D2: en el móvil el partido abre la página completa, sin panel', async ({ page }) => {
  await servir(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/partidos?deporte=nhl');
  await page.getByRole('link', { name: /Toronto Sintético – Boston Sintético/ }).click();
  await expect(page).toHaveURL(/\/partido\/nhl\/nhl-1/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('E2: guardar una vista con «hoy», aplicarla, renombrarla y quitarla', async ({ page }) => {
  await servir(page);
  await page.goto('/partidos?deporte=nhl&dia=hoy');
  await page.getByText(/Vistas guardadas \(0\)/).click();
  await page.getByRole('textbox', { name: 'Nombre' }).fill('Hockey de hoy');
  await page.getByRole('button', { name: 'Guardar esta vista' }).click();
  await expect(page.getByText(/Vistas guardadas \(1\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Quitar filtros' }).first().click();
  await expect(page).not.toHaveURL(/deporte=/);
  await page.getByRole('button', { name: 'Hockey de hoy', exact: true }).click();
  await expect(page).toHaveURL(/deporte=nhl/);
  await expect(page).toHaveURL(/dia=hoy/);
  await page.getByRole('button', { name: 'Renombrar la vista Hockey de hoy' }).click();
  await page.getByRole('textbox', { name: 'Nuevo nombre' }).fill('NHL');
  await page.getByRole('button', { name: 'Guardar el nombre' }).click();
  await expect(page.getByRole('button', { name: 'NHL', exact: true })).toBeVisible();
  await page.reload();
  await page.getByText(/Vistas guardadas \(1\)/).click();
  await page.getByRole('button', { name: 'Quitar la vista NHL' }).click();
  await expect(page.getByText(/Vistas guardadas \(0\)/)).toBeVisible();
});

test('E3/E4: «Mis estimaciones guardadas» compara con la última (pp) y deja escribir y borrar una nota', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  let nota: string | null = null;
  const lista = () => ({
    guardadas: [
      { id: 7, sport: 'nhl', match_key: 'nhl|e2e|1', snapshot_id: 101, label: 'x', created_at: hoyA(9), captured_at: hoyA(7), event_id: 'nhl-1', commence_time: hoyA(22), outcomes: ['Toronto Sintético', 'Boston Sintético'], probs: [0.6, 0.4], model_version: 'nhl-sintetica-3', nota, notaEn: nota ? hoyA(10) : null, actual: { snapshot_id: 102, captured_at: hoyA(8, 15), outcomes: ['Toronto Sintético', 'Boston Sintético'], probs: [0.62, 0.38], model_version: 'nhl-sintetica-3' } },
    ],
  });
  await page.route('**/api/guardadas', (r) => r.fulfill({ json: lista() }));
  await page.route('**/api/guardadas/7', (r) => {
    nota = (r.request().postDataJSON() as { nota: string | null }).nota;
    return r.fulfill({ json: lista().guardadas[0] });
  });
  await page.goto('/guardadas');
  await expect(page.getByRole('heading', { name: 'Mis estimaciones guardadas', level: 1 })).toBeVisible();
  await expect(page.getByText(/62,0\s%.*\+2,0 pp \/ −2,0 pp/)).toBeVisible();
  await page.getByRole('button', { name: 'Escribir una nota' }).click();
  await page.getByRole('textbox', { name: /Nota/ }).fill('Mirar al portero');
  await page.getByRole('button', { name: 'Guardar la nota' }).click();
  await expect(page.getByText('Mirar al portero')).toBeVisible();
  expect(nota).toBe('Mirar al portero');
  await page.getByRole('button', { name: 'Cambiar la nota' }).click();
  await page.getByRole('textbox', { name: /Nota/ }).fill('   ');
  await page.getByRole('button', { name: 'Guardar la nota' }).click();
  await expect(page.getByText('Sin nota.')).toBeVisible();
  expect(nota).toBeNull();
});

test('E5: el borrador de la ficha abre el formulario con la estimación enlazada, que se envía o se quita', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('predictor.recorrido', '1');
    localStorage.setItem(
      'predictor.borradorApuesta',
      JSON.stringify({ sport: 'nhl', league: 'nhl', event: 'Boston Sintético @ Toronto Sintético', market: 'moneyline', match_key: 'nhl|e2e|1', snapshot_id: 102, estimacion: { captured_at: '2026-11-20T08:15:00Z', outcomes: ['Toronto Sintético', 'Boston Sintético'], probs: [0.62, 0.38], model_version: 'nhl-sintetica-3' } }),
    );
  });
  let enviado: Record<string, unknown> | null = null;
  await page.route('**/api/bets', (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    enviado = r.request().postDataJSON() as Record<string, unknown>;
    return r.fulfill({ status: 201, json: { id: 999 } });
  });
  await page.goto('/apuestas?borrador=1');
  await expect(page.getByText(/Con la estimación del .*Toronto Sintético 62,0 %/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Selección' }).fill('Toronto Sintético');
  await page.getByRole('textbox', { name: 'Cuota (decimal)' }).fill('1,8');
  await page.getByRole('textbox', { name: 'Cantidad' }).fill('10');
  await page.getByRole('button', { name: 'Registrar apuesta', exact: true }).click();
  await expect.poll(() => enviado?.snapshot_id).toBe(102);
  expect(enviado?.match_key).toBe('nhl|e2e|1');
});

test('F2: en Mis apuestas, el deporte elegido sigue a la vista (y se quita), y se filtra abiertas o liquidadas', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('predictor.recorrido', '1'));
  const apuesta = (id: number, sport: string, status: string) => ({ id, created_at: hoyA(9), placed_on: HOY, sport, league: null, event: `Evento Sintético ${id}`, market: 'moneyline', selection: 'A', odds: 2, stake: 10, status, payout: null, currency: 'EUR', settled_at: null, notes: null, model_prob: null, market_prob: null, match_key: null, tags: [], snapshot_id: null, snapshotId: null, estimacion: null, payoutGross: status === 'won' ? 20 : null, profit: status === 'won' ? 10 : null, risked: 10, withModel: null });
  const todas = [apuesta(1, 'nhl', 'pending'), apuesta(2, 'nhl', 'won'), apuesta(3, 'football', 'pending')];
  const grupo = (key: string, n: number) => ({ key, bets: n, settled: 0, staked: 10 * n, risked: 0, profit: 0, roi: null, wins: 0, losses: 0, hitRate: null });
  await page.route('**/api/bets?*', (r) => {
    const sport = new URL(r.request().url()).searchParams.get('sport');
    return r.fulfill({ json: { bets: todas.filter((b) => !sport || b.sport === sport) } });
  });
  await page.route('**/api/bets/summary?*', (r) => {
    const sport = new URL(r.request().url()).searchParams.get('sport');
    const bySport = sport ? [grupo(sport, todas.filter((b) => b.sport === sport).length)] : [grupo('nhl', 2), grupo('football', 1)];
    return r.fulfill({ json: { moneda: 'EUR', monedas: [{ moneda: 'EUR', apuestas: 3 }], totals: grupo('total', 3), pending: { bets: 2, staked: 20 }, bySport, byMarket: [], daily: [], cumulative: [], modelAgreement: null, best: null, worst: null, longestWinStreak: 0, longestLoseStreak: 0 } });
  });
  await page.goto('/apuestas');
  await page.getByRole('button', { name: /^NHL/ }).first().click();
  // Con el filtro puesto, las pastillas siguen ahí para verlo y quitarlo.
  await expect(page.getByRole('button', { name: /^Todos/ })).toBeVisible();
  await expect(page.getByText('Evento Sintético 3')).toHaveCount(0);
  await page.getByRole('group', { name: 'Abiertas o liquidadas' }).getByRole('button', { name: /^Liquidadas/ }).click();
  await expect(page.getByText('Evento Sintético 2')).toBeVisible();
  await expect(page.getByText('Evento Sintético 1')).toHaveCount(0);
  // Quitar el deporte vuelve a todos (con «Liquidadas» aún puesto: el 2 sigue, el 1 y el 3 no).
  await page.getByRole('button', { name: /^Todos/ }).click();
  await expect(page.getByText('Evento Sintético 2')).toBeVisible();
  await page.getByRole('group', { name: 'Abiertas o liquidadas' }).getByRole('button', { name: /^Abiertas/ }).click();
  await expect(page.getByText('Evento Sintético 3')).toBeVisible();
});
