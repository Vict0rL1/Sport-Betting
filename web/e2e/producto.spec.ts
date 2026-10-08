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

test('archivo: los filtros van a la URL y sobreviven a recargar; líneas sin cuotas reales lo dice', async ({ page }) => {
  await page.goto('/confianza/archivo');
  await expect(page.getByTestId('resumen-archivo')).toBeVisible();
  await page.getByLabel('Resultado').selectOption('pendiente');
  await expect(page).toHaveURL(/resultado=pendiente/);
  await page.reload();
  await expect(page.getByLabel('Resultado')).toHaveValue('pendiente');
  await expect(page.getByTestId('subnav').getByRole('link', { name: 'Archivo' })).toHaveAttribute('aria-current', 'page');

  await page.goto('/apuestas/lineas');
  await expect(page.getByRole('heading', { name: 'Comparador de líneas' })).toBeVisible();
  await expect(page.getByText('Sin ODDS_API_KEY no hay casas que comparar')).toBeVisible();
});

// Fase 8: lo opcional, apagado por defecto, y encendido desde los interruptores.
test('tenis punto a punto: cuatro puntos son un juego, con el saque y el break; deshacer vuelve atrás', async ({ page, request }) => {
  // Abrir una tarjeta de tenis calcula los mercados de puntos y el motor en vivo: lento con la base de demostración.
  test.slow();
  await page.goto('/tenis');
  await page.getByRole('button', { name: /¿Por qué\?/ }).first().click();
  await expect(page.getByTestId('punto-a-punto')).toHaveCount(0);
  expect((await request.patch('/api/features/tenis.enVivo', { data: { on: true } })).ok()).toBeTruthy();
  try {
    await page.reload();
    await page.getByRole('button', { name: /¿Por qué\?/ }).first().click();
    const pap = page.getByTestId('punto-a-punto');
    await expect(pap).toBeVisible();
    // Saca el jugador 1; el 2 gana cuatro puntos seguidos: juego al resto, break.
    const resto = pap.getByRole('button', { name: /^Punto para/ }).nth(1);
    for (let i = 0; i < 4; i++) {
      await resto.click();
      await expect(pap).toContainText(`${i + 1} punto(s) apuntados`);
    }
    await expect(pap).toContainText('(break)');
    await expect(page.getByLabel('Juegos 2')).toHaveValue('1');
    await pap.getByRole('button', { name: 'Deshacer' }).click();
    await expect(page.getByLabel('Juegos 2')).toHaveValue('0');
    await expect(pap).not.toContainText('(break)');
  } finally {
    await request.patch('/api/features/tenis.enVivo', { data: { on: null } });
  }
});

test('NHL en sombra: solo con su interruptor, y sin partidos lo dice sin inventar métricas', async ({ page, request }) => {
  await page.goto('/confianza/diagnostico');
  await expect(page.getByRole('heading', { name: 'Diagnóstico' })).toBeVisible();
  await expect(page.getByTestId('nhl-sombra')).toHaveCount(0);
  expect((await request.patch('/api/features/deportes.nhl', { data: { on: true } })).ok()).toBeTruthy();
  try {
    await page.reload();
    const b = page.getByTestId('nhl-sombra');
    await expect(b).toContainText('NHL en sombra');
    await expect(b).toContainText('sin partidos en nhl_games');
    await expect(b).not.toContainText('log loss');
  } finally {
    await request.patch('/api/features/deportes.nhl', { data: { on: null } });
  }
});

test('UFC en sombra: solo con su interruptor, y sin peleas ni métricas ni veredicto inventados', async ({ page, request }) => {
  await page.goto('/confianza/diagnostico');
  await expect(page.getByRole('heading', { name: 'Diagnóstico' })).toBeVisible();
  await expect(page.getByTestId('ufc-sombra')).toHaveCount(0);
  expect((await request.patch('/api/features/deportes.ufc', { data: { on: true } })).ok()).toBeTruthy();
  try {
    await page.reload();
    const b = page.getByTestId('ufc-sombra');
    await expect(b).toContainText('UFC en sombra');
    await expect(b).toContainText('sin peleas en ufc_fights');
    await expect(b).not.toContainText('log loss');
    await expect(page.getByTestId('ufc-veredicto')).toHaveCount(0);
  } finally {
    await request.patch('/api/features/deportes.ufc', { data: { on: null } });
  }
});
