// CLV histórico sobre cuotas Pinnacle: Shin sobre un libro, elección por valor, signo del CLV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { shin1X2, elegirApuesta, clvHistorico } = await import('./clv.ts');

test('shin1X2: suma 1, respeta el orden y rechaza cuotas inválidas', () => {
  const p = shin1X2([2.0, 3.4, 3.8])!;
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(p[0] > p[1] && p[1] > p[2]);
  assert.equal(shin1X2([1.0, 3.4, 3.8]), null);
});

test('elegirApuesta: solo con valor sobre el umbral, la de más edge; el CLV es positivo cuando el cierre acorta', () => {
  // El modelo ve al local mucho más probable que Pinnacle temprano; el cierre le da la razón.
  const a = elegirApuesta({ modelo: [0.6, 0.25, 0.15], ps: [2.1, 3.4, 3.6], psc: [1.85, 3.6, 4.2], y: 0 })!;
  assert.equal(a.seleccion, 0);
  assert.ok(a.clv > 0 && Math.abs(a.clv - (2.1 / 1.85 - 1)) < 1e-12);
  assert.equal(a.beneficio, 1.1);
  // Sin valor: nada.
  assert.equal(elegirApuesta({ modelo: [0.45, 0.28, 0.27], ps: [2.1, 3.4, 3.6], psc: [2.0, 3.5, 3.7], y: 0 }), null);
  // El cierre alarga la selección → CLV negativo, y perdió.
  const b = elegirApuesta({ modelo: [0.2, 0.25, 0.55], ps: [2.1, 3.4, 3.6], psc: [1.9, 3.5, 4.3], y: 0 })!;
  assert.equal(b.seleccion, 2);
  assert.ok(b.clv < 0);
  assert.equal(b.beneficio, -1);
});

test('clvHistorico: cuenta solo partidos con las dos cuotas y resume', () => {
  const r = clvHistorico([
    { modelo: [0.6, 0.25, 0.15], ps: [2.1, 3.4, 3.6], psc: [1.85, 3.6, 4.2], y: 0 },
    { modelo: [0.2, 0.25, 0.55], ps: [2.1, 3.4, 3.6], psc: [1.9, 3.5, 4.3], y: 0 },
    { modelo: [0.45, 0.28, 0.27], ps: [2.1, 3.4, 3.6], psc: [2.0, 3.5, 3.7], y: 1 },
    { modelo: [0.7, 0.2, 0.1], ps: [2.1, 3.4, 3.6], psc: [0, 0, 0], y: 0 },
  ]);
  assert.equal(r.conAmbas, 3);
  assert.equal(r.n, 2);
  assert.equal(r.positivos, 1);
  assert.ok(r.clvMedio != null && Math.abs(r.clvMedio - ((2.1 / 1.85 - 1) + (3.6 / 4.3 - 1)) / 2) < 1e-12);
  assert.ok(Math.abs(r.beneficio - 0.1) < 1e-9);
  assert.deepEqual(clvHistorico([]), { n: 0, clvMedio: null, positivos: 0, beneficio: 0, roi: null, conAmbas: 0 });
});
