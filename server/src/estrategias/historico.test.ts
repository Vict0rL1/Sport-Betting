// «¿Qué habría pasado?»: el holdout no entra, el CLV sin cierre aparte es DESCONOCIDO y el
// replay es la misma política que en vivo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../test/setup.ts';

const { juegosDeFlujo, leerHistorico, reproducir, muestrear } = await import('./historico.ts');
const { DEFAULT_CONFIG } = await import('../staking/policy.ts');
type Juego = import('../evaluation/walkforward.ts').Juego;
type JuegoHistorico = import('./historico.ts').JuegoHistorico;

const CAL = { football: { ece: 0, n: 1, beatsMarket: true, vsMarketLogLoss: null, measuredAt: '' }, nfl: { ece: 0, n: 1, beatsMarket: true, vsMarketLogLoss: null, measuredAt: '' } };

test('juegosDeFlujo: sin holdout, sin empates, sin calentamiento y con Pinnacle temprano cuando lo hay', () => {
  const base = { a: 'x', b: 'y', local: true, K: 3 as const, y: 0, segmento: { liga: 'epl' } };
  const flujo: Juego[] = [
    { ...base, fecha: '2024-08-10', temporada: 2025, modelo: [0.5, 0.25, 0.25], cuotas: [2.1, 3.4, 3.6] },
    { ...base, fecha: '2025-08-10', temporada: 2026, modelo: [0.5, 0.25, 0.25], cuotas: [2.1, 3.4, 3.6] }, // holdout
    { ...base, fecha: '2024-08-11', temporada: 2025, modelo: null, cuotas: [2.1, 3.4, 3.6] }, // calentamiento
    { ...base, fecha: '2024-08-12', temporada: 2025, modelo: [0.5, 0.25, 0.25], cuotas: null }, // sin cuota
    { ...base, fecha: '2024-08-13', temporada: 2025, modelo: [0.5, 0.25, 0.25], cuotas: [2.0, 3.3, 3.5], pinnacle: { temprana: [2.2, 3.3, 3.4], cierre: [2.0, 3.4, 3.7] } },
    { ...base, fecha: '2024-08-14', modelo: [0.5, 0.25, 0.25], cuotas: [2.1, 3.4, 3.6] }, // sin temporada: fuera por si acaso
  ];
  const xs = juegosDeFlujo('football', flujo);
  assert.equal(xs.length, 2);
  assert.deepEqual(xs[1].cuotas, [2.2, 3.3, 3.4], 'se apuesta al Pinnacle temprano');
  assert.deepEqual(xs[1].cierre, [2.0, 3.4, 3.7]);
  assert.equal(xs[0].cierre, null);
  assert.ok(xs.every((j) => j.temporada !== 2026));
  const nfl = juegosDeFlujo('nfl', [{ fecha: '20230910', temporada: 2023, a: 'a', b: 'b', local: true, K: 2, y: 0, modelo: [0.6, 0.4], cuotas: [1.7, 2.2], empate: true }]);
  assert.equal(nfl.length, 0, 'un empate de NFL (moneyline devuelto) no se reproduce');
});

test('leerHistorico vuelve a quitar el holdout aunque alguien lo meta a mano', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estrategias-'));
  fs.writeFileSync(path.join(dir, 'nfl.json'), JSON.stringify({ sport: 'nfl', generado: 'x', fuente: 'prueba', modelVersion: null, holdoutDesde: 2024, conCierreAparte: 0, columnas: [], juegos: [['2023-09-10', 2023, 'NFL', 0, [0.6, 0.4], [1.8, 2.1], null], ['2024-09-10', 2024, 'NFL', 0, [0.6, 0.4], [1.8, 2.1], null]] }));
  const h = leerHistorico('nfl', dir)!;
  assert.equal(h.juegos.length, 1);
  assert.equal(h.juegos[0].temporada, 2023);
});

function serie(n: number, gana: (i: number) => boolean, cierre: number[] | null = null): JuegoHistorico[] {
  return Array.from({ length: n }, (_, i) => ({
    fecha: `2023-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    temporada: 2023,
    liga: 'NFL',
    y: gana(i) ? 0 : 1,
    p: [0.6, 0.4],
    cuotas: [2.0, 1.9],
    cierre,
  }));
}

test('reproducir: misma decisión que en vivo, banco, acierto y CLV desconocido sin cierre aparte', () => {
  const r = reproducir('nfl', DEFAULT_CONFIG, { juegos: serie(60, (i) => i % 2 === 0), cal: CAL as never });
  assert.equal(r.disponible, true);
  assert.equal(r.apuestas, 60);
  assert.equal(r.ganadas, 30);
  assert.equal(r.acierto, 0.5);
  assert.equal(r.clvMedio, null, 'solo cuota de cierre: CLV DESCONOCIDO, no cero');
  assert.ok(r.notas.some((n) => /DESCONOCIDO/.test(n)));
  assert.ok(r.notas.some((n) => /holdout/.test(n)));
  assert.equal(r.aviso.nivel, 'orientativa');
  assert.ok(r.curva.length > 0);
  // 20 % de ventaja al 2,0 con Kelly 1/4 = 5 %, tope del 2 % del banco del día. Ganar y perder
  // alternando al 2 % pierde por arrastre de volatilidad: 1000·(1,02·0,98)^30 ≈ 988.
  assert.ok(Math.abs(r.bancoFinal - 1000 * (1.02 * 0.98) ** 30) < 1, String(r.bancoFinal));
});

test('reproducir: los límites de pérdida usan lo realizado en la simulación', () => {
  // Pierde todo: el corte semanal (10 %) para el resto de la semana.
  const r = reproducir('nfl', DEFAULT_CONFIG, { juegos: serie(28, () => false), cal: CAL as never });
  assert.ok(r.apuestas < 28, `${r.apuestas} apuestas: el corte semanal tenía que parar alguna`);
  assert.ok(r.drawdown && r.drawdown.pct > 0);
});

test('reproducir: CLV medido cuando hay cierre aparte; sin ventaja o sin calibración, cero apuestas con el motivo', () => {
  const conCierre = reproducir('football', DEFAULT_CONFIG, { juegos: serie(10, () => true, [1.8, 2.1]).map((j) => ({ ...j, liga: 'epl' })), cal: CAL as never });
  assert.ok(conCierre.clvMedio != null && Math.abs(conCierre.clvMedio - (2.0 / 1.8 - 1)) < 1e-9);
  const exigente = reproducir('nfl', { ...DEFAULT_CONFIG, minEdge: 0.4 }, { juegos: serie(10, () => true), cal: CAL as never });
  assert.equal(exigente.apuestas, 0);
  assert.match(String(exigente.motivo), /no se habría apostado/);
  const frenado = reproducir('nfl', DEFAULT_CONFIG, { juegos: serie(10, () => true), cal: { nfl: { ece: 0.01, n: 5000, beatsMarket: false, vsMarketLogLoss: 0.01, measuredAt: '' } } });
  assert.equal(frenado.apuestas, 0);
  assert.match(String(frenado.motivo), /freno de calibración/);
});

test('muestrear conserva el último punto y no pasa del máximo', () => {
  const xs = Array.from({ length: 1000 }, (_, i) => ({ banco: 1000 + Math.sin(i) * 10, i }));
  const m = muestrear(xs, 100);
  assert.equal(m.length, 100);
  assert.equal(m[m.length - 1], xs[xs.length - 1]);
});
