import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { calidadSeleccion } = await import('./evaluation.ts');
const { avisoMuestra } = await import('../evaluation/sample.ts');
const { getDb } = await import('../db.ts');

test('avisos de muestra: 11 apuestas no permiten concluir; 150 son orientativas; 400 no avisan', () => {
  assert.equal(avisoMuestra(11, 'apuestas').nivel, 'insuficiente');
  assert.match(avisoMuestra(11, 'apuestas').texto ?? '', /demasiado pequeña/);
  assert.equal(avisoMuestra(150, 'apuestas').nivel, 'orientativa');
  assert.equal(avisoMuestra(400, 'apuestas').texto, null);
  assert.equal(avisoMuestra(80, 'predicciones').nivel, 'insuficiente');
});

const db = getDb();
const INICIO = '2026-09-20T18:00:00.000Z';
const insEval = db.prepare(
  `INSERT INTO prediction_assessments (sport, match_key, event_id, commence_time, assessed_at, probs, decision, selection, odds, edge,
     stake_factor, confidence, data_quality, uncertainty_pp, stability, stability_pp, disagreement, disagreement_pp, market_quality,
     edge_vanish, ood, regime, reasons, model_version)
   VALUES ('baseball', ?, 'e', ?, ?, ?, ?, 0, 2.0, ?, 1, ?, ?, 3, 'ALTA', 2, 'BAJO', 1, 'ALTA', 0.1, '[]', 'r', '[]', 'b')`,
);
const insLog = db.prepare(
  `INSERT INTO bsb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
     prob_home, reliability, predicted_at, home_runs, away_runs, resolved_at)
   VALUES (?, 'mlb', 'e', ?, 'a', 'b', 'A', 'B', 0.6, 'high', '2026-09-20T10:00:00Z', ?, ?, '2026-09-21T00:00:00Z')`,
);
// 8 apostables bien calibradas (dice 70 %, gana 6 de 8) y 8 abstenidas que fallan (dice 70 %, gana 2).
for (let i = 0; i < 16; i++) {
  const bet = i < 8;
  const gana = bet ? i < 6 : i < 10;
  const k = `m${i}`;
  insLog.run(k, INICIO, gana ? 5 : 2, gana ? 2 : 5);
  insEval.run(k, INICIO, '2026-09-20T12:00:00Z', '[0.7,0.3]', bet ? 'BET' : 'NO BET', bet ? 0.4 : 0.4, bet ? 'ALTA' : 'BAJA', bet ? 90 : 40);
}
// Una evaluación POSTERIOR al inicio no puede existir: la base la rechaza.
test('la base no admite evaluaciones tras el inicio', () => {
  assert.throws(() => insEval.run('m0', INICIO, '2026-09-20T19:00:00Z', '[0.1,0.9]', 'NO BET', 0, 'BAJA', 0), /CHECK/);
});

test('calidad de la selección: apostables contra abstenidas, con las mismas métricas', () => {
  const s = calidadSeleccion();
  assert.equal(s.partidos, 16);
  const g = Object.fromEntries(s.grupos.map((x) => [x.nombre, x]));
  assert.equal(g['Apostables (BET)'].informe.n, 8);
  assert.equal(g['Abstenidas (NO BET)'].informe.n, 8);
  assert.ok((g['Apostables (BET)'].informe.logLoss as number) < (g['Abstenidas (NO BET)'].informe.logLoss as number));
  // ROI hipotético a cuota 2,0: apostables 6/8 → +50 %; abstenidas 2/8 → −50 %.
  assert.equal(g['Apostables (BET)'].roiHipotetico?.roi, 0.5);
  assert.equal(g['Abstenidas (NO BET)'].roiHipotetico?.roi, -0.5);
  assert.equal(g['Apostables (BET)'].roiHipotetico?.aviso.nivel, 'insuficiente', '8 apuestas: aviso, no conclusión');
});

test('cobertura: el 50 % de más confianza son las apostables', () => {
  const c = calidadSeleccion().cobertura;
  assert.deepEqual(c.map((x) => x.n), [16, 12, 8, 4]);
  assert.ok((c[2].informe.logLoss as number) < (c[0].informe.logLoss as number));
});

// TEST NEGATIVO de la mezcla: apostables solo de béisbol (2 resultados) y abstenidas solo de
// fútbol (3), las dos diciendo «no sé» (uniforme). El log loss mezclado daría ventaja a las
// apostables (0,693 < 1,099) sin que la abstención sirva de nada; la ganancia las iguala.
test('la comparación entre grupos no la decide la mezcla de deportes', () => {
  const ins = db.prepare(
    `INSERT INTO prediction_assessments (sport, match_key, event_id, commence_time, assessed_at, probs, decision, selection, odds, edge,
       stake_factor, confidence, data_quality, uncertainty_pp, stability, stability_pp, disagreement, disagreement_pp, market_quality,
       edge_vanish, ood, regime, reasons, model_version)
     VALUES (?, ?, 'e', ?, ?, ?, ?, NULL, NULL, NULL, 1, 'MEDIA', 70, 3, 'ALTA', 2, 'BAJO', 1, 'ALTA', 0, '[]', 'r', '[]', 'v')`,
  );
  const fb = db.prepare(
    `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
       prob_home, prob_draw, prob_away, reliability, predicted_at, home_goals, away_goals, resolved_at)
     VALUES (?, 'epl', 'e', ?, 'a', 'b', 'A', 'B', 0.34, 0.33, 0.33, 'high', '2026-09-20T10:00:00Z', 1, 0, '2026-09-21T00:00:00Z')`,
  );
  for (let i = 0; i < 6; i++) {
    fb.run(`fb${i}`, INICIO);
    ins.run('football', `fb${i}`, INICIO, '2026-09-20T12:00:00Z', JSON.stringify([1 / 3, 1 / 3, 1 / 3]), 'NO BET');
  }
  const s = calidadSeleccion();
  // Las 8 abstenidas de béisbol de antes siguen ahí; se miran por deporte.
  const futbol = s.porDeporte.football.find((g) => g.nombre === 'Abstenidas (NO BET)')!;
  assert.equal(futbol.informe.n, 6);
  assert.ok(Math.abs(futbol.ganancia as number) < 1e-9, 'uniforme: ganancia 0, aunque su log loss sea 1,099');
  assert.ok(Math.abs((futbol.informe.logLoss as number) - Math.log(3)) < 1e-9);
  const todas = s.grupos.find((g) => g.nombre === 'Abstenidas (NO BET)')!;
  assert.deepEqual(todas.mezcla, { baseball: 8, football: 6 });
  assert.deepEqual(Object.keys(s.porDeporte).sort(), ['baseball', 'football']);
});
