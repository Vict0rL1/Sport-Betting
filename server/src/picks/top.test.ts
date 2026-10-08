// ⭐ Destacados: el orden (confianza antes que probabilidad), lo que entra y lo que no
// (demostración, empezados, fuera de la ventana) y las cifras de cada fila.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { mejoresPartidos, franjaDe, ordenar } = await import('./top.ts');
const { getDb } = await import('../db.ts');

const db = getDb();
const AHORA = new Date('2026-10-06T12:00:00Z');
const en = (h: number) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();

const upBb = db.prepare(
  `INSERT INTO bb_upcoming (id, league, commence_time, home_name, away_name, home_id, away_id, home_odds, away_odds, books, source, updated_at)
   VALUES (?, 'nba', ?, ?, ?, ?, ?, ?, ?, 8, ?, ?)`,
);
const logBb = db.prepare(
  `INSERT INTO bb_prediction_log (game_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, reliability, predicted_at)
   VALUES (?, 'nba', ?, ?, ?, ?, ?, ?, ?, 'high', ?)`,
);
const evaluacion = db.prepare(
  `INSERT INTO prediction_assessments (sport, match_key, event_id, commence_time, assessed_at, probs, decision, selection, odds, edge,
     stake_factor, confidence, data_quality, uncertainty_pp, stability, stability_pp, disagreement, disagreement_pp, market_quality,
     edge_vanish, ood, regime, reasons, model_version)
   VALUES (?, ?, 'e', ?, ?, '[0.5,0.5]', ?, NULL, NULL, NULL, 0, ?, ?, 3, 'ALTA', 2, 'BAJO', 1, 'ALTA', 0, '[]', 'r', ?, 'v')`,
);

function partidoBb(id: string, h: number, p: number, opts: { fuente?: string; log?: boolean; nivel?: string; cuotaLocal?: number | null } = {}) {
  upBb.run(id, en(h), `Local ${id}`, `Visitante ${id}`, `h${id}`, `a${id}`, opts.cuotaLocal ?? null, null, opts.fuente ?? 'live', AHORA.toISOString());
  if (opts.log === false) return;
  logBb.run(`k${id}`, id, en(h), `h${id}`, `a${id}`, `Local ${id}`, `Visitante ${id}`, p, AHORA.toISOString());
  if (opts.nivel) {
    evaluacion.run('basketball', `k${id}`, en(h), en(Math.min(h, 0) - 1), opts.nivel === 'ALTA' ? 'BET' : 'NO BET', opts.nivel, opts.nivel === 'ALTA' ? 90 : 40, JSON.stringify(opts.nivel === 'ALTA' ? [] : ['calidad de datos 40/100 (mínimo 60)']));
  }
}

partidoBb('1', 10, 0.65, { nivel: 'ALTA', cuotaLocal: 1.8 });
partidoBb('2', 20, 0.8, { nivel: 'BAJA' });
partidoBb('3', 30, 0.9); // sin evaluar
partidoBb('4', 5, 0.95, { fuente: 'fixture' }); // demostración
partidoBb('5', -2, 0.99, { nivel: 'ALTA' }); // ya empezado
partidoBb('6', 8, 0.7, { log: false }); // sin predicción todavía
partidoBb('7', 100, 0.85, { nivel: 'ALTA' }); // fuera de 48 h

// Fútbol: el empate como favorito, con su propia cuota.
db.prepare(
  `INSERT INTO fb_upcoming (id, league, commence_time, home_name, away_name, home_id, away_id, odds_home, odds_draw, odds_away, books, source, updated_at)
   VALUES ('f1', 'epl', ?, 'Local FC', 'Visitante FC', 'lfc', 'vfc', 3.2, 3.0, 3.4, 9, 'live', ?)`,
).run(en(12), AHORA.toISOString());
db.prepare(
  `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, reliability, predicted_at)
   VALUES ('kf1', 'epl', 'f1', ?, 'lfc', 'vfc', 'Local FC', 'Visitante FC', 0.3, 0.4, 0.3, 'medium', ?)`,
).run(en(12), AHORA.toISOString());

test('el orden: confianza ALTA antes que BAJA aunque tenga menos probabilidad; sin evaluar al final', () => {
  const r = mejoresPartidos(AHORA, 48);
  const bb = r.partidos.filter((p) => p.sport === 'basketball').map((p) => p.matchKey);
  assert.deepEqual(bb, ['k1', 'k2', 'k3']);
  const k1 = r.partidos.find((p) => p.matchKey === 'k1')!;
  assert.equal(k1.confianza?.nivel, 'ALTA');
  assert.equal(k1.confianza?.decision, 'BET');
  const k2 = r.partidos.find((p) => p.matchKey === 'k2')!;
  assert.match(k2.confianza?.motivo ?? '', /calidad de datos/);
  assert.equal(r.partidos.find((p) => p.matchKey === 'k3')!.confianza, null);
});

test('lo que no entra: demostración, empezados, sin predicción y fuera de la ventana', () => {
  const r = mejoresPartidos(AHORA, 48);
  const claves = r.partidos.map((p) => p.matchKey);
  assert.ok(!claves.includes('k4'), 'demostración');
  assert.ok(!claves.includes('k5'), 'ya empezado');
  assert.ok(!claves.includes('k7'), 'a 100 h, fuera de 48 h');
  assert.equal(r.demo, 1);
  assert.equal(r.sinPrediccion, 1);
  assert.ok(mejoresPartidos(AHORA, 168).partidos.some((p) => p.matchKey === 'k7'), 'dentro de 7 días');
});

test('cifras de la fila: cuota justa, ventaja, y el empate como favorito con su cuota', () => {
  const r = mejoresPartidos(AHORA, 48);
  const k1 = r.partidos.find((p) => p.matchKey === 'k1')!;
  assert.equal(k1.favorito, 'Local 1');
  assert.ok(Math.abs(k1.cuotaJusta - 1 / 0.65) < 1e-12);
  assert.ok(Math.abs((k1.ventaja as number) - (0.65 * 1.8 - 1)) < 1e-12);
  assert.equal(r.partidos.find((p) => p.matchKey === 'k2')!.ventaja, null, 'sin cuota, sin ventaja inventada');
  const f = r.partidos.find((p) => p.matchKey === 'kf1')!;
  assert.equal(f.favorito, 'Empate');
  assert.equal(f.cuota, 3.0);
  assert.ok(Math.abs((f.ventaja as number) - 0.2) < 1e-12);
  assert.equal(f.opciones.length, 3);
});

test('la franja de acierto histórico: la de «desde» más alto que no pasa de p', () => {
  const b = [
    { desde: 0.5, n: 100, acierto: 0.6 },
    { desde: 0.7, n: 50, acierto: 0.78 },
    { desde: 0.6, n: 80, acierto: 0.7 },
  ];
  assert.deepEqual(franjaDe(b, 0.74), { franja: '70–100 %', acierto: 0.78, n: 50 });
  assert.deepEqual(franjaDe(b, 0.65), { franja: '60–70 %', acierto: 0.7, n: 80 });
  assert.equal(franjaDe(b, 0.45), null, 'por debajo de la primera franja no se inventa una');
  assert.equal(franjaDe(null, 0.7), null);
});

test('ordenar es estable ante empates: misma confianza y probabilidad, primero el que empieza antes', () => {
  const base = { confianza: { nivel: 'MEDIA' }, probabilidad: 0.7 } as never;
  const a = { ...(base as object), cuando: '2026-10-07T10:00:00Z' } as never;
  const b = { ...(base as object), cuando: '2026-10-07T08:00:00Z' } as never;
  assert.ok(ordenar(a, b) > 0);
});
