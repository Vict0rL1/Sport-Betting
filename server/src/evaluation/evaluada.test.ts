// La política de evaluación, sin base de datos (B1). Los casos de punta a punta están en
// evaluada.integracion.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLITICA_EVALUACION, indiceFavorito, leerProbs, resolverEvaluada, resultadosDe, type FinalLeida } from './evaluada.ts';

const final = (over: Partial<FinalLeida> = {}): FinalLeida => ({ source: 'snapshot', probs: '[0.6,0.2,0.2]', market_probs: '[0.5,0.3,0.2]', model_version: 'v2', captured_at: '2026-11-19T10:00:00Z', snapshot_id: 7, ...over });
const pub = { probs: [0.2, 0.2, 0.6], mercado: [0.3, 0.3, 0.4], version: 'v1', en: '2026-11-18T10:00:00Z' };

test('con final legible se evalúa la final, aunque la publicación diga otra cosa', () => {
  const r = resolverEvaluada(pub, final(), 3);
  assert.ok(r.ok);
  assert.equal(r.evaluada.politica, POLITICA_EVALUACION);
  assert.equal(r.evaluada.tipo, 'final');
  assert.equal(r.evaluada.fuente, 'instantanea');
  assert.deepEqual(r.evaluada.probs, [0.6, 0.2, 0.2]);
  assert.deepEqual(r.evaluada.mercado, [0.5, 0.3, 0.2], 'el mercado de la misma captura, no el de la publicación');
  assert.equal(r.evaluada.version, 'v2');
  assert.equal(r.evaluada.snapshotId, 7);
});

test('una final congelada desde el registro es final, pero no señala ninguna instantánea', () => {
  const r = resolverEvaluada(pub, final({ source: 'prediction_log', snapshot_id: null }), 3);
  assert.ok(r.ok);
  assert.equal(r.evaluada.tipo, 'final');
  assert.equal(r.evaluada.fuente, 'registro');
  assert.equal(r.evaluada.snapshotId, null);
});

test('sin final se evalúa la publicación y se marca legado', () => {
  const r = resolverEvaluada(pub, null, 3);
  assert.ok(r.ok);
  assert.equal(r.evaluada.tipo, 'legado');
  assert.deepEqual(r.evaluada.probs, [0.2, 0.2, 0.6]);
  assert.equal(r.evaluada.capturadaEn, pub.en);
});

test('una final ilegible no se evalúa ni se sustituye por la publicación', () => {
  for (const probs of ['[0.7,0.3]', '[0.6,0.6,0.2]', '[0.6,null,0.4]', '[1.2,-0.1,-0.1]', 'no es json', '{"a":1}', '[NaN,0.5,0.5]']) {
    const r = resolverEvaluada(pub, final({ probs }), 3);
    assert.deepEqual(r, { ok: false, motivo: 'final-invalida' }, probs);
  }
});

test('un mercado ilegible en la final no tumba la evaluación: se queda sin mercado', () => {
  const r = resolverEvaluada(pub, final({ market_probs: '[0.5]' }), 3);
  assert.ok(r.ok);
  assert.equal(r.evaluada.mercado, null);
});

test('sin final y con publicación ilegible, o sin nada, no hay evaluada', () => {
  assert.deepEqual(resolverEvaluada({ ...pub, probs: [0.2, 0.2] }, null, 3), { ok: false, motivo: 'publicacion-invalida' });
  assert.deepEqual(resolverEvaluada(null, null, 2), { ok: false, motivo: 'sin-publicacion' });
});

test('leerProbs renormaliza lo que suma casi 1 (cinco decimales) y deja intacto lo que suma 1', () => {
  const r = leerProbs([0.33333, 0.33333, 0.33333], 3)!;
  assert.ok(Math.abs(r.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.deepEqual(leerProbs('[0.6,0.4]', 2), [0.6, 0.4]);
  assert.equal(leerProbs([0.6, 0.39], 2), null, 'un 1 % que falta no es redondeo');
});

test('el favorito es el primero de los máximos; el fútbol tiene tres resultados', () => {
  assert.equal(indiceFavorito([0.2, 0.2, 0.6]), 2);
  assert.equal(indiceFavorito([0.4, 0.2, 0.4]), 0);
  assert.equal(resultadosDe('football'), 3);
  assert.equal(resultadosDe('nhl'), 2);
});
