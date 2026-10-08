import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { mover, incertidumbre, estabilidad, edgeDesaparece, sensibilidad, desacuerdo } = await import('./perturbation.ts');
type Ev = Parameters<typeof estabilidad>[0];

const LN = Math.LN10 / 400;
const ev = (over: Partial<Ev> = {}): Ev => ({
  sport: 'tennis',
  matchKey: 'atp|1|2|20261010',
  eventId: 'x',
  commence: '2026-10-10T12:00:00Z',
  outcomes: ['A', 'B'],
  probs: [0.624, 0.376],
  factores: [
    { clave: 'rating', etiqueta: 'Elo', puntos: 70, rango: [1, 1], porQue: 'ratings' },
    { clave: 'form', etiqueta: 'Forma', puntos: 12, rango: [0.5, 1.5], porQue: 'ventana corta' },
  ],
  pendiente: LN,
  pendienteExacta: true,
  sigmaHueco: 40,
  fiabilidad: { nivel: 'high', margenPp: 2.1, motivos: [] },
  componentes: [],
  datos: [],
  ood: [],
  regimen: { etiqueta: 'temporada', nota: null },
  odds: [1.8, 2.1],
  oddsAt: null,
  books: 8,
  providerEventId: null,
  providerSelections: null,
  demo: false,
  ...over,
});

test('mover: sin desplazamiento no cambia nada; tres resultados mantiene el empate', () => {
  assert.ok(Math.abs(mover(ev(), 0)[0] - 0.624) < 1e-12);
  const tres = mover({ probs: [0.5, 0.25, 0.25], pendiente: LN }, 100);
  assert.equal(tres[1], 0.25);
  assert.ok(tres[0] > 0.5);
  assert.ok(Math.abs(tres.reduce((a, b) => a + b, 0) - 1) < 1e-12);
});

test('incertidumbre: combina ruido de rating y sesgo del tramo, y no se llama IC del 95 %', () => {
  const u = incertidumbre(ev(), [{ desde: 0.6, n: 5000, acierto: 0.65, media: 0.62 }]);
  assert.equal(u.ruidoRatingPp, 2.1);
  assert.equal(u.sesgoCalibracionPp, 3);
  assert.ok(Math.abs(u.totalPp - Math.sqrt(2.1 ** 2 + 9)) < 0.06);
  assert.match(u.significado, /No es un intervalo de confianza del 95/);
  assert.equal(incertidumbre(ev(), null).sesgoCalibracionPp, null);
});

test('estabilidad ALTA con factores pequeños, BAJA con supuestos grandes', () => {
  assert.equal(estabilidad(ev()).nivel, 'ALTA');
  const inestable = estabilidad(
    ev({ factores: [{ clave: 'qb', etiqueta: 'QB supuesto', puntos: 120, rango: [0, 1.25], porQue: 'no confirmado' }] }),
  );
  assert.equal(inestable.nivel, 'BAJA');
  assert.ok(inestable.escenarios.length >= 3);
  // Determinista: mismas entradas, mismas cifras.
  assert.equal(estabilidad(ev()).p10, estabilidad(ev()).p10);
});

test('el edge desaparece más cuanto menor es la ventaja aparente', () => {
  const poco = edgeDesaparece(ev(), 0, 1.68, 0.02); // 0.624·1.68 − 1 = +4.8 %
  const mucho = edgeDesaparece(ev(), 0, 2.0, 0.02); // +24.8 %
  assert.ok(poco > mucho);
  assert.ok(mucho < 0.05);
  assert.ok(poco > 0.1);
});

test('Shapley: las contribuciones suman final − base exactamente', () => {
  // Probabilidad COHERENTE con sus factores (70 + 12 − 20 = 62 puntos Elo).
  const p = 1 / (1 + 10 ** (-62 / 400));
  const s = sensibilidad(ev({ probs: [p, 1 - p], factores: [
    { clave: 'rating', etiqueta: 'Elo', puntos: 70, rango: [1, 1], porQue: '' },
    { clave: 'form', etiqueta: 'Forma', puntos: 12, rango: [0.5, 1.5], porQue: '' },
    { clave: 'h2h', etiqueta: 'H2H', puntos: -20, rango: [0, 1.5], porQue: '' },
  ] }));
  const suma = s.contribuciones.reduce((a, c) => a + c.pp, 0);
  assert.ok(Math.abs(suma - (s.final - s.base) * 100) < 0.2, `${suma}`);
  assert.ok(Math.abs(s.base - 0.5) < 1e-9, 'sin factores, 50 %');
  assert.ok(s.contribuciones[2].pp < 0);
});

test('desacuerdo: ALTO cuando los componentes se separan más de 10 pp', () => {
  assert.equal(desacuerdo(ev()).nivel, 'SIN COMPONENTES');
  const d = desacuerdo(ev({ componentes: [
    { nombre: 'Elo general', probs: [0.68, 0.32] },
    { nombre: 'Elo de superficie', probs: [0.59, 0.41] },
    { nombre: 'Modelo', probs: [0.624, 0.376] },
  ] }));
  assert.equal(d.nivel, 'MEDIO');
  assert.equal(d.rangoPp, 9);
});
