import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumir } from './rendimiento';

test('T20: acierto = aciertos / puntuados; sin partidos no hay porcentaje; lo esperado es la suma de p', () => {
  assert.deepEqual(resumir([]), { total: 0, aciertos: 0, tasa: null, esperado: null, tasaEsperada: null, rangoNormal: null });
  const r = resumir([
    { probabilidad: 0.6, acerto: true },
    { probabilidad: 0.5, acerto: false },
    { probabilidad: 0.8, acerto: true },
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.aciertos, 2);
  assert.ok(Math.abs(r.tasa! - 2 / 3) < 1e-12);
  assert.ok(Math.abs(r.esperado! - 1.9) < 1e-12);
  // sd = √(0,24 + 0,25 + 0,16) = √0,65 ≈ 0,806 → 1,9 ± 1,58 → [1, 3] en aciertos enteros dentro de 0–n.
  assert.deepEqual(r.rangoNormal, [1, 3]);
});
