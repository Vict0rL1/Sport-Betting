// Revisión quant de B1 (la política de la predicción evaluada): los seis hallazgos, cada uno con el
// caso que lo reproducía.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { recordSnapshot, freezeFinals } = await import('../prematch/snapshots.ts');
const { predicciones, evaluacionEnVivo } = await import('./live.ts');
const { derivaReciente } = await import('../trust/drift.ts');
const { exportar } = await import('../exports/datasets.ts');
const { historialReciente } = await import('../today.ts');
const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');

const db = getDb();
const H = 3_600_000;
const NOW = new Date();
const snap = (sport: string, mk: string, commence: string, outcomes: string[], probs: number[], at: Date) =>
  recordSnapshot({ sport, matchKey: mk, eventId: null, commence, outcomes, probs, probsRaw: null, odds: null, oddsAt: null, dataAsOf: null, usaMercado: false, entradas: { x: { etiqueta: 'x', valor: probs[0] } } } as never, at);

// 1. Cien partidos de fútbol: publicación 20/20/60, final 60/20/20, gana el local.
for (let i = 0; i < 100; i++) {
  const ko = new Date(NOW.getTime() - (200 - i) * H);
  const mk = `fb-${i}`;
  db.prepare(
    `INSERT INTO fb_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, predicted_at, home_goals, away_goals, resolved_at, model_version)
     VALUES (?, 'esp', ?, ?, ?, ?, ?, 0.2, 0.2, 0.6, ?, 1, 0, ?, 'fb-v1')`,
  ).run(mk, ko.toISOString(), `${mk}h`, `${mk}a`, `H${i}`, `A${i}`, new Date(ko.getTime() - 30 * H).toISOString(), NOW.toISOString());
  snap('football', mk, ko.toISOString(), [`H${i}`, 'Empate', `A${i}`], [0.6, 0.2, 0.2], new Date(ko.getTime() - 2 * H));
}
// 2. Tenis: el registro dice A 30 %; la última instantánea lista [B, A] = [0,7, 0,3] (la misma opinión); gana A.
const tko = new Date(NOW.getTime() - 5 * H);
const tkey = `atp|1|2|${tko.toISOString().slice(0, 10).replaceAll('-', '')}`;
db.prepare(
  `INSERT INTO prediction_log (match_key, tour, commence_time, p1_id, p2_id, p1_name, p2_name, prob1, predicted_at, winner_id, resolved_at)
   VALUES (?, 'atp', ?, 1, 2, 'A', 'B', 0.3, ?, 1, ?)`,
).run(tkey, tko.toISOString(), new Date(tko.getTime() - 30 * H).toISOString(), NOW.toISOString());
snap('tennis', tkey, tko.toISOString(), ['A', 'B'], [0.3, 0.7], new Date(tko.getTime() - 30 * H));
snap('tennis', tkey, tko.toISOString(), ['B', 'A'], [0.7, 0.3], new Date(tko.getTime() - 1 * H));
// 2b. Tenis con nombres que no casan: no se sabe a quién corresponde cada probabilidad.
const tkey2 = `atp|3|4|${tko.toISOString().slice(0, 10).replaceAll('-', '')}`;
db.prepare(
  `INSERT INTO prediction_log (match_key, tour, commence_time, p1_id, p2_id, p1_name, p2_name, prob1, predicted_at, winner_id, resolved_at)
   VALUES (?, 'atp', ?, 3, 4, 'C', 'D', 0.4, ?, 3, ?)`,
).run(tkey2, tko.toISOString(), new Date(tko.getTime() - 30 * H).toISOString(), NOW.toISOString());
snap('tennis', tkey2, tko.toISOString(), ['X', 'Y'], [0.8, 0.2], new Date(tko.getTime() - 1 * H));
// 3. Baloncesto: publicación 0,3, final 0,8, gana el local.
const bko = new Date(NOW.getTime() - 6 * H);
const gk = `nba|x|y|${bko.toISOString().slice(0, 10).replaceAll('-', '')}`;
db.prepare(
  `INSERT INTO bb_prediction_log (game_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, reliability, predicted_at, home_pts, away_pts, resolved_at)
   VALUES (?, 'nba', 'u', ?, 'x', 'y', 'X', 'Y', 0.3, 'high', ?, 110, 100, ?)`,
).run(gk, bko.toISOString(), new Date(bko.getTime() - 30 * H).toISOString(), NOW.toISOString());
snap('basketball', gk, bko.toISOString(), ['X', 'Y'], [0.8, 0.2], new Date(bko.getTime() - 1 * H));
// 6. Una publicación tardía de antes del trigger, con una instantánea válida anterior al inicio.
const lko = new Date(NOW.getTime() - 7 * H);
snap('football', 'late-1', lko.toISOString(), ['HL', 'Empate', 'AL'], [0.6, 0.2, 0.2], new Date(lko.getTime() - 2 * H));
db.exec('DROP TRIGGER IF EXISTS fb_prediction_log_prepartido');
db.prepare(
  `INSERT INTO fb_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, predicted_at, home_goals, away_goals, resolved_at, model_version)
   VALUES ('late-1', 'esp', ?, 'hl', 'al', 'HL', 'AL', 0.2, 0.2, 0.6, ?, 1, 0, ?, 'fb-v1')`,
).run(lko.toISOString(), new Date(lko.getTime() + 10 * 60_000).toISOString(), NOW.toISOString());

freezeFinals(NOW);

async function veredicto(sport: string, mk: string) {
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  try {
    return (await app.inject({ method: 'GET', url: `/api/resultado/${sport}/${encodeURIComponent(mk)}` })).json() as Record<string, unknown>;
  } finally {
    await app.close();
  }
}

test('hallazgo 1 (bloqueante): la deriva sigue midiendo la PUBLICACIÓN; recortar importes no depende de la final', () => {
  const d = derivaReciente('football');
  assert.equal(d.n, 100);
  assert.ok(Math.abs((d.logLossReciente ?? 0) - -Math.log(0.2)) < 1e-6, `log loss ${d.logLossReciente}: el de la publicación 20/20/60`);
  assert.equal(d.deriva, true, 'como antes del cambio: la publicación falló cien veces');
});

test('hallazgo 2 (bloqueante): en el tenis, una final con los jugadores en otro orden se reordena; si no casan, no se puntúa', async () => {
  const v = await veredicto('tennis', tkey);
  assert.deepEqual(v.probabilidades, [0.3, 0.7], 'en el orden del registro: A, B');
  assert.equal(v.acerto, false, 'A era el no favorito (30 %) y ganó');
  const p = predicciones('tennis').find((x) => x.matchKey === tkey);
  assert.deepEqual(p?.p, [0.3, 0.7]);
  const r = historialReciente(NOW, 7).resultados.find((x) => x.casa === 'A');
  assert.equal(r?.acerto, false);
  const v2 = await veredicto('tennis', tkey2);
  assert.equal(v2.acerto, null);
  assert.equal((v2.evaluacion as { motivo: string }).motivo, 'final-invalida');
});

test('hallazgo 3: la exportación del baloncesto evalúa con su clave (game_key) igual que el veredicto', async () => {
  const x = exportar('predicciones', { sport: 'basketball' }).datos.find((d) => d.match_key === gk);
  assert.ok(x, 'la fila exportada lleva match_key');
  assert.equal(x.evaluacion, 'final');
  assert.equal(x.eval_prob_a, 0.8);
  assert.equal((await veredicto('basketball', gk)).acerto, true);
});

test('hallazgo 6: una publicación tardía no entra en ninguna vía, aunque haya una final válida', async () => {
  const v = await veredicto('football', 'late-1');
  assert.equal(v.acerto, null);
  assert.equal((v.evaluacion as { motivo: string }).motivo, 'publicacion-tardia');
  const x = exportar('predicciones', { sport: 'football' }).datos.find((d) => d.match_key === 'late-1');
  assert.equal(x?.evaluacion, 'excluida');
  assert.equal(x?.motivo_exclusion, 'publicacion-tardia');
  assert.ok(!predicciones('football').some((p) => p.matchKey === 'late-1'));
  assert.ok(!historialReciente(NOW, 7).resultados.some((r) => r.casa === 'HL'));
});

test('hallazgo 5: la evaluación en vivo dice cuántas son final, legado y excluidas', () => {
  const tenis = evaluacionEnVivo().find((r) => r.deporte === 'tennis') as unknown as { evaluacion: { final: number; legado: number; excluidas: number } };
  assert.deepEqual({ ...tenis.evaluacion, politica: undefined }, { final: 1, legado: 0, excluidas: 1, politica: undefined });
  const futbol = evaluacionEnVivo().find((r) => r.deporte === 'football') as unknown as { evaluacion: { final: number; legado: number; excluidas: number } };
  assert.equal(futbol.evaluacion.final, 100);
});
