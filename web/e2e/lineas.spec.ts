import { test, expect } from '@playwright/test';
import { contrastes } from './util';

// El comparador de líneas con una surebet que no está en la línea más cotizada y un mercado con
// margen negativo que no lo es (seguimiento de la auditoría del 22 de octubre; revisión ui-tester).
const SB = {
  generado: '2026-10-29T12:00:00.000Z',
  ventanaHoras: 48,
  eventos: 2,
  bancoApuestaA: 'consenso',
  nota: 'Solo lectura.',
  mercados: [
    {
      eventId: 'e-push', sport: 'nfl', league: 'americanfootball_nfl', market: 'spreads', partido: 'Team A vs Team B', cuando: null, eventoId: null,
      selecciones: [
        { seleccion: 'Team A', linea: -3.5, mejor: { cuota: 1.9, casa: 'a' }, peor: { cuota: 1.9, casa: 'b' }, consenso: 1.9, casas: 2, dispersionPp: 0, mejorSobreConsenso: 0 },
        { seleccion: 'Team B', linea: 3.5, mejor: { cuota: 1.9, casa: 'a' }, peor: { cuota: 1.9, casa: 'b' }, consenso: 1.9, casas: 2, dispersionPp: 0, mejorSobreConsenso: 0 },
      ],
      margenMejor: 0.0526, margenConsenso: 0.0526, surebet: true, observado: '2026-10-29T11:00:00.000Z',
      detalleSurebet: { margenPct: 9.1, margenMinimoPct: 0, patas: [{ seleccion: 'Team A', cuota: 2.2, casa: 'c', linea: -3 }, { seleccion: 'Team B', cuota: 2.2, casa: 'd', linea: 3 }] },
    },
    {
      eventId: 'e-nocubre', sport: 'nfl', league: 'americanfootball_nfl', market: 'totals', partido: 'Team C vs Team D', cuando: null, eventoId: null,
      selecciones: [
        { seleccion: 'Over', linea: 45.5, mejor: { cuota: 2.2, casa: 'a' }, peor: { cuota: 2.1, casa: 'b' }, consenso: 2.1, casas: 3, dispersionPp: 1, mejorSobreConsenso: 0.05 },
        { seleccion: 'Under', linea: 44.5, mejor: { cuota: 2.2, casa: 'a' }, peor: { cuota: 2.1, casa: 'b' }, consenso: 2.1, casas: 3, dispersionPp: 1, mejorSobreConsenso: 0.05 },
      ],
      margenMejor: -0.0909, margenConsenso: -0.0476, surebet: false, observado: '2026-10-29T11:00:00.000Z', detalleSurebet: null,
    },
  ],
};

test('líneas: la surebet se lee con su línea y buen contraste, y un margen negativo sin cobertura no se llama surebet', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('predictor.recorrido', '1');
    localStorage.setItem('predictor.tema', 'claro');
  });
  await page.route('**/api/odds/lineas*', (r) => r.fulfill({ json: SB }));
  await page.goto('/apuestas/lineas');
  const detalle = page.getByTestId('detalle-surebet');
  await expect(detalle).toHaveCount(1);
  await expect(detalle).toContainText('Team A −3 2,20 en c');
  // La introducción ya no dice que cualquier margen negativo sea una surebet: ese de −9,1 % no lo es.
  await expect(page.getByText('Si ese margen es negativo, hay surebet.')).toHaveCount(0);
  // La línea de la surebet, legible en el tema claro (texto, no un adorno).
  const medidos = await contrastes(page, '[data-testid="detalle-surebet"]');
  expect(medidos.length).toBe(1);
  expect(medidos[0].ratio, `«${medidos[0].texto}» ${medidos[0].ratio}`).toBeGreaterThanOrEqual(4.5);
  // La tabla escribe las líneas como la surebet: «−3,5» y «+3,5»; en un total, «45,5» sin signo.
  const tabla = page.getByTestId('lista-lineas');
  await expect(tabla).toContainText('Team A −3,5');
  await expect(tabla).toContainText('Team B +3,5');
  await expect(tabla).toContainText('Over 45,5');
  await expect(tabla).not.toContainText('-3.5');
  await expect(tabla).not.toContainText('+45.5');
});
