// La abstención dentro del banco de papel: falla cerrada, deja rastro y solo recorta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { place } = await import('./bankroll.ts');

const db = getDb();
const H = 3_600_000;
const ahora = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const INICIO = iso(ahora + 24 * H);

function partido(id: string, key: string) {
  db.prepare(
    `INSERT INTO bb_upcoming (id, league, commence_time, home_name, away_name, home_id, away_id, home_odds, away_odds, books, source, updated_at)
     VALUES (?, 'nba', ?, 'Lakers', 'Celtics', 'lal', 'bos', 2.2, 1.75, 8, 'live', ?)`,
  ).run(id, INICIO, iso(ahora - 30 * 60_000));
  db.prepare(
    `INSERT INTO bb_prediction_log (game_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
       prob_home, market_prob_home, reliability, predicted_at)
     VALUES (?, 'nba', ?, ?, 'lal', 'bos', 'Lakers', 'Celtics', 0.55, 0.44, 'high', ?)`,
  ).run(key, id, INICIO, iso(ahora - H));
}
function evaluacion(key: string, id: string, decision: string, factor: number, razones: string[] = [], probs = '[0.55,0.45]') {
  db.prepare(
    `INSERT INTO prediction_assessments (sport, match_key, event_id, commence_time, assessed_at, probs, decision, selection, odds, edge,
       stake_factor, confidence, data_quality, uncertainty_pp, stability, stability_pp, disagreement, disagreement_pp, market_quality,
       edge_vanish, ood, regime, reasons, model_version)
     VALUES ('basketball', ?, ?, ?, ?, ?, ?, 0, 2.2, 0.21, ?, 'MEDIA', 70, 3, 'ALTA', 2, 'SIN COMPONENTES', 0, 'ALTA', 0.1, '[]', 'temporada', ?, 'b')`,
  ).run(key, id, INICIO, iso(ahora - 5 * 60_000), probs, decision, factor, JSON.stringify(razones));
}
const apuesta = (id: string) => db.prepare('SELECT * FROM paper_bets WHERE event_id = ?').get(id) as Record<string, unknown> | undefined;
const senal = (id: string) =>
  db.prepare('SELECT decision, reason FROM edge_signals WHERE event_id = ? ORDER BY id DESC LIMIT 1').get(id) as { decision: string; reason: string } | undefined;

// Cuatro partidos con la misma ventaja aparente (+21 % al local), y cuatro situaciones.
partido('sin-eval', 'nba|lal|bos|1');
partido('no-bet', 'nba|lal|bos|2');
evaluacion('nba|lal|bos|2', 'no-bet', 'NO BET', 0, ['predicción inestable: entre 48 % y 61 % según los supuestos']);
partido('recorte', 'nba|lal|bos|3');
evaluacion('nba|lal|bos|3', 'recorte', 'BET', 0.5);
partido('desfasada', 'nba|lal|bos|4');
evaluacion('nba|lal|bos|4', 'desfasada', 'BET', 1, [], '[0.47,0.53]');

const r = place();

test('sin evaluación de confianza no se apuesta (falla cerrada), y queda la señal con el motivo', () => {
  assert.equal(apuesta('sin-eval'), undefined);
  assert.match(senal('sin-eval')!.reason, /^abstención: sin evaluación de confianza/);
});

test('NO BET de la evaluación: no se apuesta, con la razón de la evaluación', () => {
  assert.equal(apuesta('no-bet'), undefined);
  assert.equal(senal('no-bet')!.decision, 'rechazada');
  assert.match(senal('no-bet')!.reason, /inestable/);
});

test('la probabilidad registrada desfasada de la actual: no se apuesta', () => {
  assert.equal(apuesta('desfasada'), undefined);
  assert.match(senal('desfasada')!.reason, /desfasada/);
});

test('un recorte de confianza reduce el importe a la mitad, nunca lo sube', () => {
  const a = apuesta('recorte');
  assert.ok(a, JSON.stringify(r.detalle));
  assert.equal(a!.trust_stake_factor, 0.5);
  assert.equal(a!.confidence, 'MEDIA');
  // El tope por evento (2 % de 1.000) a la mitad.
  assert.ok((a!.stake as number) <= 10.0001, String(a!.stake));
  assert.equal(r.colocadas, 1);
});
