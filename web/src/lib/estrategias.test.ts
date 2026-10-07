import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formularioDesde, peticionDe, PLANTILLAS, type Staking } from './estrategias';

const POL: Staking = { kellyFraction: 0.25, maxPerEvent: 0.02, dailyLossLimit: 0.05, weeklyLossLimit: 0.1, minEdge: 0.02, maxTotalExposure: 0.1, maxExposurePerDay: 0.06, maxExposurePerLeague: 0.05 };

test('el formulario parte de la política y vuelve a ella sin perder nada', () => {
  const f = formularioDesde(POL, ['nfl', 'football']);
  assert.equal(f.minEdge, '2');
  const p = peticionDe({ ...f, nombre: ' Prueba ' });
  assert.equal(p.nombre, 'Prueba');
  assert.equal(p.staking.minEdge, 0.02);
  assert.equal(p.staking.kellyFraction, 0.25);
  assert.equal(p.staking.maxTotalExposure, 0.1);
  assert.deepEqual(p.mercados, ['h2h']);
});

test('la coma decimal de un teclado español se entiende', () => {
  const p = peticionDe({ ...formularioDesde(POL, ['nfl']), minEdge: '2,5' });
  assert.ok(Math.abs(p.staking.minEdge - 0.025) < 1e-12);
});

test('las plantillas solo cambian lo que dicen', () => {
  const f = formularioDesde(POL, ['nfl', 'football']);
  const c = PLANTILLAS.conservadora(f);
  assert.equal(peticionDe(c).staking.minEdge, 0.04);
  assert.equal(peticionDe(c).staking.kellyFraction, 0.2);
  assert.equal(c.deportes.length, 2);
  assert.deepEqual(PLANTILLAS.soloFutbol(f).deportes, ['football']);
  assert.equal(PLANTILLAS.sinConfianza(f).confianza, false);
  assert.equal(PLANTILLAS.sinFreno(f).calibracion, false);
  assert.equal(PLANTILLAS.sinFreno(f).confianza, true);
});
