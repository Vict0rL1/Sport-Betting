import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validarDistribucion,
  cuotaJusta,
  implicitaDeCuota,
  quitarMargen,
  dobleOportunidad,
  diferenciaPp,
  valorEsperado,
  validarCuota,
  validarImporte,
  resultadoApuesta,
  porcentajes,
} from './mercado';

const cerca = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('T06: una distribución 1X2 válida se acepta y sus porcentajes redondeados suman 100', () => {
  const r = validarDistribucion([0.579, 0.201, 0.22]);
  assert.equal(r.ok, true);
  // Redondeo a un decimal que suma exactamente 100,0 (mayor resto).
  const p = porcentajes([0.5791, 0.2013, 0.2196], 1);
  assert.deepEqual(p, [57.9, 20.1, 22]);
  cerca(p.reduce((a, b) => a + b, 0), 100, 1e-9);
  // Tres tercios: 33,3 + 33,3 + 33,4.
  const t = porcentajes([1 / 3, 1 / 3, 1 / 3], 1);
  cerca(t.reduce((a, b) => a + b, 0), 100, 1e-9);
});

test('T07: probabilidades negativas, NaN, fuera de rango o que no suman 1 se rechazan', () => {
  assert.equal(validarDistribucion([0.5, -0.1, 0.6]).ok, false);
  assert.equal(validarDistribucion([0.5, Number.NaN, 0.5]).ok, false);
  assert.equal(validarDistribucion([1.2, 0, -0.2]).ok, false);
  assert.equal(validarDistribucion([0.5, 0.3, 0.3]).ok, false);
  assert.equal(validarDistribucion([0.5]).ok, false);
  assert.equal(validarDistribucion([]).ok, false);
  assert.equal(validarDistribucion([Number.POSITIVE_INFINITY, 0]).ok, false);
  // Un error de redondeo de la base (6 decimales) no es una distribución rota.
  assert.equal(validarDistribucion([0.333333, 0.333333, 0.333334]).ok, true);
});

test('cuota justa = 1/p, y p = 0 o fuera de rango no da cuota', () => {
  cerca(cuotaJusta(0.5)!, 2);
  cerca(cuotaJusta(0.25)!, 4);
  cerca(cuotaJusta(1)!, 1);
  assert.equal(cuotaJusta(0), null);
  assert.equal(cuotaJusta(-0.1), null);
  assert.equal(cuotaJusta(1.1), null);
  assert.equal(cuotaJusta(Number.NaN), null);
});

test('probabilidad implícita = 1/d, solo para cuotas decimales válidas', () => {
  cerca(implicitaDeCuota(2)!, 0.5);
  cerca(implicitaDeCuota(1.25)!, 0.8);
  assert.equal(implicitaDeCuota(1), null);
  assert.equal(implicitaDeCuota(0), null);
  assert.equal(implicitaDeCuota(-2), null);
  assert.equal(implicitaDeCuota(Number.POSITIVE_INFINITY), null);
});

test('T10: quitar el margen solo con el conjunto completo; con una cuota que falta, nada', () => {
  // 1,90 / 1,90: 52,6 % + 52,6 % → 50 / 50.
  const r = quitarMargen([1.9, 1.9]);
  assert.ok(r);
  cerca(r![0], 0.5);
  cerca(r![1], 0.5);
  const t = quitarMargen([2, 4, 4]);
  assert.ok(t);
  cerca(t!.reduce((a, b) => a + b, 0), 1);
  assert.equal(quitarMargen([2, null, 4]), null);
  assert.equal(quitarMargen([2, 0, 4]), null);
  assert.equal(quitarMargen([2]), null);
});

test('T33: 0,50 / 0,25 / 0,25 → 1X 0,75, X2 0,50, 12 0,75, sin normalizar los solapados', () => {
  const d = dobleOportunidad([0.5, 0.25, 0.25]);
  assert.ok(d);
  cerca(d!.casaOEmpate, 0.75);
  cerca(d!.fueraOEmpate, 0.5);
  cerca(d!.casaOFuera, 0.75);
  // La suma es 2 (cada resultado está en dos selecciones) y así se queda.
  cerca(d!.casaOEmpate + d!.fueraOEmpate + d!.casaOFuera, 2);
  // De una distribución rota no sale nada.
  assert.equal(dobleOportunidad([0.5, 0.5, 0.5]), null);
  assert.equal(dobleOportunidad([0.5, 0.5]), null);
});

test('la diferencia modelo−mercado va en puntos porcentuales', () => {
  cerca(diferenciaPp(0.58, 0.55), 3);
  cerca(diferenciaPp(0.4, 0.45), -5);
});

test('valor esperado del modelo p·d − 1, y nada con datos inválidos', () => {
  cerca(valorEsperado(0.55, 2)!, 0.1);
  assert.equal(valorEsperado(0.55, 1), null);
  assert.equal(valorEsperado(Number.NaN, 2), null);
});

test('T32: cuotas NaN, infinitas, 0, ≤1 o absurdas se rechazan con un motivo', () => {
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY, 0, 1, -3, 1001, '2,5x', '']) {
    const r = validarCuota(v);
    assert.equal(r.ok, false, String(v));
    if (!r.ok) assert.ok(r.motivo.length > 0);
  }
  assert.deepEqual(validarCuota('2,06'), { ok: true, valor: 2.06 });
  assert.deepEqual(validarCuota(1.5), { ok: true, valor: 1.5 });
});

test('T32: importes NaN, negativos, cero o con más de 2 decimales se rechazan, sin truncar', () => {
  for (const v of [Number.NaN, Number.NEGATIVE_INFINITY, -100, 0, '10.005', 'abc', '']) {
    assert.equal(validarImporte(v).ok, false, String(v));
  }
  assert.deepEqual(validarImporte('100'), { ok: true, valor: 100 });
  assert.deepEqual(validarImporte('12,50'), { ok: true, valor: 12.5 });
  assert.deepEqual(validarImporte(0.01), { ok: true, valor: 0.01 });
});

test('T27: 100 a 2,06 ganada → pago 206 y neto 106', () => {
  assert.deepEqual(resultadoApuesta(100, 2.06, 'won'), { pago: 206, neto: 106 });
});

test('T28: la misma perdida → 0 / −100; anulada o push → 100 / 0; pendiente → nada', () => {
  assert.deepEqual(resultadoApuesta(100, 2.06, 'lost'), { pago: 0, neto: -100 });
  assert.deepEqual(resultadoApuesta(100, 2.06, 'void'), { pago: 100, neto: 0 });
  assert.deepEqual(resultadoApuesta(100, 2.06, 'push'), { pago: 100, neto: 0 });
  assert.equal(resultadoApuesta(100, 2.06, 'pending'), null);
  // Medias: la mitad a la cuota y la otra mitad devuelta, o perdida.
  assert.deepEqual(resultadoApuesta(100, 2.06, 'half_won'), { pago: 153, neto: 53 });
  assert.deepEqual(resultadoApuesta(100, 2.06, 'half_lost'), { pago: 50, neto: -50 });
  // Redondeo a céntimos sin error binario: 33,33 × 1,91 = 63,6603 → 63,66.
  assert.deepEqual(resultadoApuesta(33.33, 1.91, 'won'), { pago: 63.66, neto: 30.33 });
});
