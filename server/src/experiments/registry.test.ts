import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { interpretarExperimento, readRegistry } = await import('./registry.ts');
type E = Parameters<typeof interpretarExperimento>[0];

const base = (over: Partial<E>): E => ({
  id: 'x', date: '2026-09-01', hypothesis: 'h', dataset: { sport: 'football', split: 'validation', n: 1000 },
  features: [], hyperparams: {}, metric: 'logloss', baseline: 'b',
  result: { delta: 0.004, ciLo: 0.002, ciHi: 0.006, p: 0.005, n: 1000 }, verdict: 'shipped', ...over,
});

// La ambigüedad que se encontró en la auditoría: «shipped» en una ablación que empeora es
// un candidato RECHAZADO.
test('ablación que empeora con verdict shipped: el candidato se rechaza', () => {
  const i = interpretarExperimento(base({ hypothesis: 'quitar el margen de victoria mejora el log loss' }));
  assert.equal(i.candidato, 'rechazado');
  assert.match(i.motivo, /se mantiene lo publicado/);
});

test('un cambio que mejora con shipped: aceptado; inconclusive: no concluyente; campos nuevos mandan', () => {
  assert.equal(interpretarExperimento(base({ hypothesis: 'el Dixon-Coles mejora', result: { delta: -0.004, ciLo: -0.006, ciHi: -0.002, p: 0.001, n: 9 } })).candidato, 'aceptado');
  assert.equal(interpretarExperimento(base({ verdict: 'inconclusive' })).candidato, 'no concluyente');
  const r = interpretarExperimento(base({ accepted: false, reason: 'mejora el acierto +0,8 pp pero empeora el Brier' }));
  assert.equal(r.candidato, 'rechazado');
  assert.match(r.motivo, /empeora el Brier/);
});

test('el registro real se puede leer y ningún candidato queda sin interpretar', () => {
  const { experiments } = readRegistry();
  assert.ok(experiments.length > 0);
  for (const e of experiments) assert.ok(['aceptado', 'rechazado', 'no concluyente'].includes(interpretarExperimento(e).candidato));
});

test('no promocionado y pendiente de muestra en vivo es «no concluyente», no «rechazado»', () => {
  const i = interpretarExperimento(base({ accepted: false, verdict: 'inconclusive', reason: 'mejora en validación; corre como sombra', result: { delta: -0.001, ciLo: -0.0017, ciHi: -0.0001, p: 0.03, n: 100 } }));
  assert.equal(i.candidato, 'no concluyente');
  assert.equal(interpretarExperimento(base({ accepted: false, verdict: 'rejected', reason: 'empeora' })).candidato, 'rechazado');
});

test('un estudio de correlación rechazado no dice «no mejora», dice que los datos no lo sostienen', () => {
  const i = interpretarExperimento(base({ metric: 'corr', verdict: 'rejected', result: { delta: 0.0013, ciLo: -0.002, ciHi: 0.005, p: 0.5, n: 1000 } }));
  assert.match(i.motivo, /no sostienen la hipótesis/);
});
