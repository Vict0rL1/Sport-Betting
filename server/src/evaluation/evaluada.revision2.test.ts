// Revisión quant de B1, segunda pasada: M1 (la deriva no depende de la política), M2 (la regla de
// la publicación tardía también en /api/prematch), M3 (la evaluación por horizontes, orientada como
// el registro), L3 (la UFC tiene orden fijo) y L4 (espacios de más en un nombre).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { recordSnapshot, freezeFinals } = await import('../prematch/snapshots.ts');
const { derivaReciente } = await import('../trust/drift.ts');
const { evaluacionPorHorizonte } = await import('../prematch/evaluation.ts');
const { resolverEvaluada, ORDEN_LIBRE } = await import('./evaluada.ts');
const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');

const db = getDb();
const H = 3_600_000;
const NOW = new Date();
const snap = (sport: string, mk: string, commence: string, outcomes: string[], probs: number[], at: Date) =>
  recordSnapshot({ sport, matchKey: mk, eventId: null, commence, outcomes, probs, probsRaw: null, odds: null, oddsAt: null, dataAsOf: null, usaMercado: false, entradas: { x: { etiqueta: 'x', valor: probs[0] } } } as never, at);

// M1: cien partidos de tenis publicados al 20 % (gana p1), con finales cuyos nombres no casan.
for (let i = 0; i < 100; i++) {
  const ko = new Date(NOW.getTime() - (300 - i) * H);
  const mk = `atp|${2 * i + 10}|${2 * i + 11}|${ko.toISOString().slice(0, 10).replaceAll('-', '')}`;
  db.prepare(`INSERT INTO prediction_log (match_key, tour, commence_time, p1_id, p2_id, p1_name, p2_name, prob1, predicted_at, winner_id, resolved_at) VALUES (?, 'atp', ?, ?, ?, ?, ?, 0.2, ?, ?, ?)`).run(
    mk, ko.toISOString(), 2 * i + 10, 2 * i + 11, `P${i}`, `Q${i}`, new Date(ko.getTime() - 30 * H).toISOString(), 2 * i + 10, NOW.toISOString(),
  );
  db.prepare(`INSERT INTO prematch_final (sport, match_key, commence_time, frozen_at, source, snapshot_id, captured_at, outcomes, probs, market_probs, model_version) VALUES ('tennis', ?, ?, ?, 'prediction_log', NULL, ?, ?, '[0.2,0.8]', NULL, 'v')`).run(
    mk, ko.toISOString(), NOW.toISOString(), new Date(ko.getTime() - H).toISOString(), JSON.stringify([`P${i}.`, `Q${i}`]),
  );
}

// M2: una publicación tardía (de antes del trigger) con una instantánea anterior al inicio.
const lko = new Date(NOW.getTime() - 7 * H);
snap('football', 'late-2', lko.toISOString(), ['HL', 'Empate', 'AL'], [0.6, 0.2, 0.2], new Date(lko.getTime() - 2 * H));
db.exec('DROP TRIGGER IF EXISTS fb_prediction_log_prepartido');
db.prepare(
  `INSERT INTO fb_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, predicted_at, home_goals, away_goals, resolved_at, model_version)
   VALUES ('late-2', 'esp', ?, 'hl', 'al', 'HL', 'AL', 0.2, 0.2, 0.6, ?, 1, 0, ?, 'fb-v1')`,
).run(lko.toISOString(), new Date(lko.getTime() + 10 * 60_000).toISOString(), NOW.toISOString());

// M3: tenis con las instantáneas al revés ([B, A] = [0,7, 0,3]) en todas las marcas; gana A.
const tko = new Date(NOW.getTime() - 4 * H);
const tk = `atp|1|2|${tko.toISOString().slice(0, 10).replaceAll('-', '')}`;
db.prepare(`INSERT INTO prediction_log (match_key, tour, commence_time, p1_id, p2_id, p1_name, p2_name, prob1, predicted_at, winner_id, resolved_at) VALUES (?, 'atp', ?, 1, 2, 'A', 'B', 0.3, ?, 1, ?)`).run(
  tk, tko.toISOString(), new Date(tko.getTime() - 40 * H).toISOString(), NOW.toISOString(),
);
for (const h of [30, 10, 3, 0.5]) snap('tennis', tk, tko.toISOString(), ['B', 'A'], [0.7 + h / 1000, 0.3 - h / 1000], new Date(tko.getTime() - h * H));

freezeFinals(NOW);

test('M1: la deriva mide las publicaciones aunque sus finales queden excluidas', () => {
  const d = derivaReciente('tennis');
  assert.ok(d.n >= 100, `n ${d.n}: la ventana sale de lo publicado, no de lo evaluado`);
});

test('M2: /api/prematch tampoco señala evaluada una final cuya publicación fue tardía', async () => {
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  try {
    const j = (await app.inject({ method: 'GET', url: '/api/prematch/football/late-2' })).json() as { evaluada: { tipo: string | null; motivo: string | null }; historial: { papel: string }[] };
    assert.equal(j.evaluada.tipo, null);
    assert.equal(j.evaluada.motivo, 'publicacion-tardia');
    assert.ok(!j.historial.some((x) => x.papel === 'evaluada'));
  } finally {
    await app.close();
  }
});

test('M3: la evaluación por horizontes lee las instantáneas en el orden del registro', () => {
  const tenis = evaluacionPorHorizonte().find((x) => x.deporte === 'tennis')!;
  const final = tenis.horizontes.find((h) => h.etiqueta === 'Final pre-partido')!;
  assert.equal(final.informe.n, 1);
  assert.ok(Math.abs((final.informe.logLoss ?? 0) - -Math.log(0.2995)) < 1e-3, `log loss ${final.informe.logLoss}: A tenía ~30 % y ganó`);
});

test('L3 / L4: la UFC tiene orden fijo (un nombre cambiado no excluye) y los espacios de más no excluyen en el tenis', () => {
  const pub = { probs: [0.4, 0.6], mercado: null, version: null, en: '2026-11-01T00:00:00Z' };
  const final = (outcomes: string[]) => ({ source: 'snapshot', outcomes, probs: [0.55, 0.45], market_probs: null, model_version: null, captured_at: '2026-11-01T01:00:00Z', snapshot_id: 1 });
  assert.equal(ORDEN_LIBRE.has('ufc'), false, 'la clave de la UFC fija A y B (ufc/trackRecord.ts)');
  const ufc = resolverEvaluada(pub, final(['Alex Pereira', 'J. Hill']), 2, { nombres: ['Alex Pereira', 'Jamahal Hill'], ordenLibre: ORDEN_LIBRE.has('ufc') });
  assert.ok(ufc.ok);
  const tenis = resolverEvaluada(pub, final(['Jannik Sinner ', 'Carlos Alcaraz']), 2, { nombres: ['Jannik Sinner', 'Carlos Alcaraz'], ordenLibre: true });
  assert.ok(tenis.ok, 'un espacio al final no cambia de jugador');
});
