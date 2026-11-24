// Fase E: la calibración por partido y el rendimiento por periodo, con los casos que pidió
// quant-reviewer al fijar las definiciones. Los partidos se inyectan (nada de base ni de red).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { calibracion, clavePeriodo, indiceCubeta, partidosDelPeriodo, rendimiento, wilson, Z_CRITICO } from './calibracion.ts';
import type { ExcluidaEnVivo, PrediccionEnVivo } from './live.ts';

let antes: string | undefined;
beforeEach(() => {
  antes = process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE = 'Europe/Madrid';
});
afterEach(() => {
  if (antes == null) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = antes;
});

let id = 0;
/** Un partido evaluado: probabilidades evaluadas `p`, resultado `y`, y lo demás por defecto. */
function partido(p: number[], y: number, o: Partial<PrediccionEnVivo> = {}): PrediccionEnVivo {
  return { p, y, mercado: null, version: 'v1', cuando: '2026-10-10T18:00:00Z', liga: 'L', matchKey: `m${id++}`, evaluacion: 'final', ...o };
}
const fuente = (xs: PrediccionEnVivo[], excluidas: ExcluidaEnVivo[] = []) => () => ({ xs, excluidas });
const cerca = (a: number | null | undefined, b: number, tol = 1e-4) => assert.ok(a != null && Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test('1 · sin partidos: cubetas vacías, veredicto insuficiente, ninguna serie y el titular null (no 0)', () => {
  const c = calibracion('nhl', {}, fuente([]));
  assert.equal(c.partidos, 0);
  assert.equal(c.paneles[0].conjunto.veredicto, 'insuficiente');
  assert.ok(c.paneles[0].cubetas.every((b) => b.n === 0 && b.observada === null));
  const r = rendimiento('nhl', {}, 'mes', new Date('2026-11-24T12:00:00Z'), fuente([]));
  assert.deepEqual(r.series, []);
  assert.deepEqual(r.resumen, []);
});

test('2 · todo en una cubeta: 120 partidos al 62 % con 75 victorias del local', () => {
  const xs = Array.from({ length: 120 }, (_, i) => partido([0.62, 0.38], i < 75 ? 0 : 1));
  const c = calibracion('nhl', {}, fuente(xs));
  const b = c.paneles[0].cubetas;
  assert.equal(b[6].n, 120);
  cerca(b[6].observada, 0.625);
  cerca(b[6].ic95?.lo, 0.5358);
  cerca(b[6].ic95?.hi, 0.7065);
  assert.ok(b.every((x, i) => i === 6 || x.n === 0));
  assert.equal(b[6].nivel, 'suficiente');
});

test('3 · los bordes de las cubetas, sin el error de coma flotante', () => {
  const ps = [0, 0.1, 1 - 0.9, 0.3, 0.7, 0.9, 1, 0.3 / 0.99999, 0.3 / 1.00001];
  assert.deepEqual(ps.map(indiceCubeta), [0, 1, 1, 3, 7, 9, 9, 3, 2]);
});

test('4 · p = 0,5 en un binario va a la cubeta 5 y se mide de verdad; Spiegelhalter null', () => {
  const xs = Array.from({ length: 50 }, () => partido([0.5, 0.5], 0));
  const c = calibracion('basketball', {}, fuente(xs));
  const b = c.paneles[0].cubetas[5];
  assert.equal(b.n, 50);
  assert.equal(b.observada, 1, 'antes, con las dos salidas, salía 0,5 «perfecto»');
  assert.equal(c.paneles[0].conjunto.spiegelhalterZ, null);
});

test('5 · el fútbol tiene tres paneles, uno por resultado, cada uno con todos los partidos', () => {
  const c = calibracion('football', {}, fuente([partido([0.45, 0.25, 0.3], 1)]));
  assert.deepEqual(c.paneles.map((p) => p.clase), ['local', 'empate', 'visitante']);
  assert.deepEqual(c.paneles.map((p) => p.n), [1, 1, 1]);
  assert.equal(c.paneles[0].cubetas[4].n, 1);
  assert.equal(c.paneles[1].cubetas[2].n, 1);
  assert.equal(c.paneles[2].cubetas[3].n, 1);
  assert.equal(c.umbrales.zCritico, Z_CRITICO.tresResultados);
});

test('6 · un cambio de versión dentro del mes da dos series, sin mezclarlas', () => {
  const xs = [...Array.from({ length: 30 }, () => partido([0.6, 0.4], 0, { version: 'v1' })), ...Array.from({ length: 30 }, () => partido([0.6, 0.4], 1, { version: 'v2' }))];
  const r = rendimiento('nhl', {}, 'mes', new Date('2026-11-24T12:00:00Z'), fuente(xs));
  assert.deepEqual(r.series.map((s) => [s.version, s.puntos.map((p) => p.n)]), [['v1', [30]], ['v2', [30]]]);
  assert.deepEqual(r.resumen.map((s) => s.version), ['v1', 'v2']);
});

test('7 · semanas y meses en la zona de la política, con el cambio de hora', () => {
  const dia = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(iso));
  assert.equal(clavePeriodo(dia('2026-10-25T22:59:00Z'), 'semana'), '2026-W43');
  assert.equal(clavePeriodo(dia('2026-10-25T23:00:00Z'), 'semana'), '2026-W44', 'en UTC seguiría en la 43');
  assert.equal(clavePeriodo(dia('2026-03-29T22:30:00Z'), 'semana'), '2026-W14', 'en UTC sería la 13');
  assert.equal(clavePeriodo('2027-01-03', 'semana'), '2026-W53');
  const xs = Array.from({ length: 30 }, () => partido([0.6, 0.4], 0, { cuando: '2026-10-21T18:00:00Z' }));
  const r = rendimiento('nhl', {}, 'semana', new Date('2026-11-24T12:00:00Z'), fuente(xs));
  const p = r.series[0].puntos[0];
  assert.equal(p.periodo, '2026-W43');
  assert.equal(p.desde, '2026-10-18T22:00:00.000Z');
  assert.equal(p.hasta, '2026-10-25T23:00:00.000Z');
  assert.equal((Date.parse(p.hasta) - Date.parse(p.desde)) / 3_600_000, 169, 'una semana con una hora de más');
});

test('8 · solo legado: la cohorte registrada sale vacía e insuficiente, sin coger el legado', () => {
  const xs = Array.from({ length: 150 }, () => partido([0.6, 0.4], 0, { evaluacion: 'legado' }));
  const c = calibracion('nhl', {}, fuente(xs));
  assert.equal(c.partidos, 0);
  assert.equal(c.paneles[0].conjunto.veredicto, 'insuficiente');
  assert.equal(calibracion('nhl', { cohorte: 'legado' }, fuente(xs)).partidos, 150);
});

test('9 · se puntúa la probabilidad evaluada, no la cruda del modelo', () => {
  const xs = Array.from({ length: 30 }, () => partido([0.9, 0.1], 0, { pModelo: [0.5, 0.5] }));
  const r = rendimiento('nhl', {}, 'mes', new Date('2026-11-24T12:00:00Z'), fuente(xs));
  cerca(r.series[0].puntos[0].brier, 0.01);
});

test('10 · las exclusiones se cuentan por periodo y motivo; no se sustituyen', () => {
  const exc: ExcluidaEnVivo[] = [
    { motivo: 'final-invalida', cuando: '2026-10-10T18:00:00Z', liga: 'L', matchKey: 'x1' },
    { motivo: 'final-invalida', cuando: '2026-10-11T18:00:00Z', liga: 'L', matchKey: 'x2' },
    { motivo: 'publicacion-tardia', cuando: '2026-11-02T18:00:00Z', liga: 'L', matchKey: 'x3' },
  ];
  const r = rendimiento('nhl', {}, 'mes', new Date('2026-11-24T12:00:00Z'), fuente([partido([0.6, 0.4], 0)], exc));
  assert.deepEqual(r.excluidas, { '2026-10': { 'final-invalida': 2 }, '2026-11': { 'publicacion-tardia': 1 } });
  // La calibración las cuenta en su cohorte: una final ilegible es de la registrada; lo demás, del legado.
  assert.deepEqual(calibracion('nhl', {}, fuente([], exc)).excluidas, { 'final-invalida': 2 });
  assert.deepEqual(calibracion('nhl', { cohorte: 'legado' }, fuente([], exc)).excluidas, { 'publicacion-tardia': 1 });
});

test('12 · los umbrales: cubeta 29/30, conjunto 99/100, punto 29/30/100/500', () => {
  const de = (n: number) => Array.from({ length: n }, (_, i) => partido([0.62, 0.38], i % 2));
  assert.equal(calibracion('nhl', {}, fuente(de(29))).paneles[0].cubetas[6].observada, null);
  assert.notEqual(calibracion('nhl', {}, fuente(de(30))).paneles[0].cubetas[6].observada, null);
  assert.equal(calibracion('nhl', {}, fuente(de(99))).paneles[0].conjunto.veredicto, 'insuficiente');
  assert.notEqual(calibracion('nhl', {}, fuente(de(100))).paneles[0].conjunto.veredicto, 'insuficiente');
  const punto = (n: number) => rendimiento('nhl', {}, 'mes', new Date('2026-11-24T12:00:00Z'), fuente(de(n))).series[0].puntos[0];
  assert.deepEqual([punto(29).brier, punto(29).nivel], [null, 'sin-muestra']);
  assert.equal(punto(30).nivel, 'insuficiente');
  assert.equal(punto(100).nivel, 'orientativa');
  assert.equal(punto(500).nivel, 'suficiente');
});

test('13 · los intervalos de Wilson', () => {
  const w = (k: number, n: number) => wilson(k, n)!;
  cerca(w(0, 30).lo, 0);
  cerca(w(0, 30).hi, 0.1135);
  cerca(w(15, 30).lo, 0.3315);
  cerca(w(15, 30).hi, 0.6685);
  cerca(w(30, 30).lo, 0.8865);
  cerca(w(30, 30).hi, 1);
});

test('14 · el veredicto: el sesgo hacia el local lo ve la calibración en grande; el exceso de confianza, Spiegelhalter', () => {
  // C1: el local al 55 % gana el 45 % y al 45 % gana el 35 %: Spiegelhalter da 0 y no lo vería.
  const c1 = [
    ...Array.from({ length: 200 }, (_, i) => partido([0.55, 0.45], i < 90 ? 0 : 1)),
    ...Array.from({ length: 200 }, (_, i) => partido([0.45, 0.55], i < 70 ? 0 : 1)),
  ];
  const a = calibracion('nhl', {}, fuente(c1)).paneles[0].conjunto;
  cerca(a.spiegelhalterZ, 0, 1e-9);
  assert.ok(Math.abs(a.citlZ!) > Z_CRITICO.binario);
  assert.equal(a.veredicto, 'descalibrado');
  // C2: dice 80 % / 20 % y pasa el 60 % / 40 %: la media cuadra, la confianza no.
  const c2 = [
    ...Array.from({ length: 200 }, (_, i) => partido([0.8, 0.2], i < 120 ? 0 : 1)),
    ...Array.from({ length: 200 }, (_, i) => partido([0.2, 0.8], i < 80 ? 0 : 1)),
  ];
  const b = calibracion('nhl', {}, fuente(c2)).paneles[0].conjunto;
  cerca(b.citlZ, 0, 1e-9);
  assert.ok(Math.abs(b.spiegelhalterZ!) > Z_CRITICO.binario);
  assert.equal(b.veredicto, 'descalibrado');
  // Bien calibrado: nunca «calibrado», solo «sin evidencia».
  const bien = Array.from({ length: 200 }, (_, i) => partido([0.6, 0.4], i < 120 ? 0 : 1));
  assert.equal(calibracion('nhl', {}, fuente(bien)).paneles[0].conjunto.veredicto, 'sin-evidencia');
});

test('15 · el titular es la media de los puntos pesada por n, y el desglose dice lo mismo que el punto', () => {
  const xs = [
    ...Array.from({ length: 40 }, (_, i) => partido([0.7, 0.3], i % 3 ? 0 : 1, { cuando: '2026-09-10T18:00:00Z' })),
    ...Array.from({ length: 70 }, (_, i) => partido([0.55, 0.45], i % 2, { cuando: '2026-10-10T18:00:00Z' })),
  ];
  const r = rendimiento('nhl', {}, 'mes', new Date('2026-11-24T12:00:00Z'), fuente(xs));
  const [sep, oct] = r.series[0].puntos;
  cerca(r.resumen[0].brier, (sep.brier! * sep.n + oct.brier! * oct.n) / (sep.n + oct.n), 1e-12);
  const d = partidosDelPeriodo('nhl', { cohorte: 'final', version: 'v1' }, 'mes', '2026-10', fuente(xs));
  assert.equal(d.filas.length, oct.n);
  cerca(d.filas.reduce((a, f) => a + f.brier, 0) / d.filas.length, oct.brier!, 1e-12);
});

test('16 · los periodos vacíos se emiten (sin valores) y el periodo en curso es parcial', () => {
  const xs = [
    ...Array.from({ length: 30 }, () => partido([0.6, 0.4], 0, { cuando: '2026-08-10T18:00:00Z' })),
    ...Array.from({ length: 30 }, () => partido([0.6, 0.4], 0, { cuando: '2026-11-10T18:00:00Z' })),
  ];
  const r = rendimiento('nhl', {}, 'mes', new Date('2026-11-24T12:00:00Z'), fuente(xs));
  assert.deepEqual(r.series[0].puntos.map((p) => [p.periodo, p.n, p.motivo, p.parcial]), [
    ['2026-08', 30, null, false],
    ['2026-09', 0, 'sin-evaluadas', false],
    ['2026-10', 0, 'sin-evaluadas', false],
    ['2026-11', 30, null, true],
  ]);
});

test('17 · una APP_TIMEZONE inválida: el rendimiento no inventa zona; la calibración sin fechas se sirve', () => {
  process.env.APP_TIMEZONE = 'Mars/Olympus';
  const xs = Array.from({ length: 30 }, () => partido([0.6, 0.4], 0));
  const r = rendimiento('nhl', {}, 'mes', new Date(), fuente(xs));
  assert.equal(r.motivo, 'zona-invalida');
  assert.deepEqual(r.series, []);
  assert.equal(calibracion('nhl', {}, fuente(xs)).partidos, 30);
  assert.equal(calibracion('nhl', { desde: '2026-10-01' }, fuente(xs)).motivo, 'zona-invalida');
});

test('el mercado se compara en los MISMOS partidos (y no aparece con menos de 30)', () => {
  const xs = Array.from({ length: 40 }, (_, i) => partido([0.6, 0.4], i % 2, { mercado: i < 35 ? [0.55, 0.45] : null }));
  const p = rendimiento('nhl', {}, 'mes', new Date('2026-11-24T12:00:00Z'), fuente(xs)).series[0].puntos[0];
  assert.equal(p.mercado?.n, 35);
  cerca(p.mercado?.delta, p.mercado!.brierModelo! - p.mercado!.brierMercado!, 1e-12);
});
