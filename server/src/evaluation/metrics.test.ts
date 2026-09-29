import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { logLoss, brier, accuracy, ece, evaluate } = await import('./metrics.ts');
const { evaluacionEnVivo } = await import('./live.ts');
const { getDb } = await import('../db.ts');

const cerca = (a: number | null, b: number, tol = 1e-12) => assert.ok(a != null && Math.abs(a - b) < tol, `${a} ≠ ${b}`);

test('binario: el Brier es EXACTAMENTE el clásico (p − y)², el que publican los backtests', () => {
  const xs = [
    { p: [0.7, 0.3], y: 0 },
    { p: [0.7, 0.3], y: 1 },
    { p: [0.4, 0.6], y: 1 },
  ];
  cerca(brier(xs), ((0.7 - 1) ** 2 + (0.7 - 0) ** 2 + (0.4 - 0) ** 2) / 3);
  cerca(logLoss(xs), -(Math.log(0.7) + Math.log(0.3) + Math.log(0.6)) / 3);
});

test('referencias: 50/50 da Brier 0,25 y log loss ln 2; uniforme a tres, ln 3', () => {
  cerca(brier([{ p: [0.5, 0.5], y: 0 }]), 0.25);
  cerca(logLoss([{ p: [0.5, 0.5], y: 1 }]), Math.log(2));
  cerca(logLoss([{ p: [1 / 3, 1 / 3, 1 / 3], y: 2 }]), Math.log(3));
  cerca(brier([{ p: [1 / 3, 1 / 3, 1 / 3], y: 2 }]), 1 / 3);
  cerca(brier([{ p: [0, 0, 1], y: 0 }]), 1, 1e-12);
});

test('el acierto no distingue 51 % de 90 %; el log loss sí (por eso no es la principal)', () => {
  const tibio = [{ p: [0.51, 0.49], y: 1 }];
  const osado = [{ p: [0.9, 0.1], y: 1 }];
  assert.equal(accuracy(tibio), accuracy(osado));
  assert.ok(logLoss(osado) > logLoss(tibio) * 3);
  assert.equal(accuracy([{ p: [0.5, 0.5], y: 0 }]), 0.5, 'un empate de probabilidad cuenta medio');
});

test('ECE: un modelo que dice 70 % y acierta 7 de 10 está calibrado', () => {
  const xs = Array.from({ length: 10 }, (_, i) => ({ p: [0.7, 0.3], y: i < 7 ? 0 : 1 }));
  cerca(ece(xs), 0, 1e-9);
});

// TESTS NEGATIVOS: una predicción mal formada no se puntúa en silencio.
test('probabilidades que no suman 1 o un resultado fuera de rango se rechazan', () => {
  assert.throws(() => evaluate('live', 'x', [{ p: [0.7, 0.7], y: 0 }]), /probabilidades inválidas/);
  assert.throws(() => evaluate('live', 'x', [{ p: [0.5, 0.5], y: 2 }]), /fuera de rango/);
  assert.throws(() => evaluate('live', 'x', [{ p: [1.2, -0.2], y: 0 }]), /probabilidades inválidas/);
});

test('sin partidos: nulos, nunca ceros', () => {
  const r = evaluate('live', 'tennis', []);
  assert.equal(r.n, 0);
  assert.equal(r.logLoss, null);
  assert.equal(r.accuracy, null);
});

test('contra el mercado sobre los MISMOS partidos', () => {
  const r = evaluate('backtest', 'nfl', [
    { p: [0.6, 0.4], y: 0, mercado: [0.7, 0.3] },
    { p: [0.6, 0.4], y: 0, mercado: null },
  ]);
  assert.equal(r.mercado?.n, 1);
  cerca(r.mercado!.logLoss, -Math.log(0.7));
  cerca(r.mercado!.modeloLogLoss, -Math.log(0.6));
  cerca(r.logLossUniforme, Math.log(2));
});

test('en vivo: solo partidos resueltos, con la probabilidad ENSEÑADA, y origen live', () => {
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO naf_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
       prob_home, shown_home, market_prob_home, reliability, predicted_at, home_points, away_points, resolved_at)
     VALUES (?, 'nfl', 'u', '2026-09-20T17:00:00Z', 'a', 'b', 'A', 'B', ?, ?, ?, 'high', '2026-09-19T10:00:00Z', ?, ?, ?)`,
  );
  ins.run('r1', 0.4, 0.7, 0.72, 24, 17, '2026-09-21T00:00:00Z'); // la cruda decía B; la enseñada, A; ganó A
  ins.run('r2', 0.6, 0.65, 0.66, 10, 20, '2026-09-21T00:00:00Z');
  ins.run('empate', 0.5, 0.5, 0.5, 20, 20, '2026-09-21T00:00:00Z'); // empate: fuera
  ins.run('pendiente', 0.5, 0.5, 0.5, null, null, null); // sin resultado: fuera
  const nfl = evaluacionEnVivo().find((r) => r.deporte === 'nfl')!;
  assert.equal(nfl.origen, 'live');
  assert.equal(nfl.n, 2);
  cerca(nfl.logLoss, -(Math.log(0.7) + Math.log(0.35)) / 2);
  assert.equal(nfl.accuracy, 0.5);
  assert.equal(nfl.mercado?.n, 2);
});
