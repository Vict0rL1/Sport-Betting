// El archivo de predicciones: lo que dijo cada registro, con resultado, confianza de entonces,
// CLV y política; filtros y paginación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { buscarEnArchivo, bandaDe } = await import('./index.ts');

const db = getDb();
// Fútbol resuelto: el modelo daba al local (0,52) y ganó el local.
db.prepare(
  `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away,
     shown_home, shown_draw, shown_away, market_prob_home, market_prob_draw, market_prob_away, reliability, predicted_at, home_goals, away_goals, resolved_at)
   VALUES ('epl|ars|che', 'epl', 'ev-ars', '2026-10-04T15:00:00Z', 'ars', 'che', 'Arsenal', 'Chelsea', 0.54, 0.24, 0.22, 0.52, 0.25, 0.23, 0.45, 0.28, 0.27, 'high', '2026-10-03T10:00:00Z', 2, 1, '2026-10-04T18:00:00Z')`,
).run();
// NFL empatado: el moneyline se devuelve.
db.prepare(
  `INSERT INTO naf_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, shown_home, reliability, predicted_at, home_points, away_points, resolved_at)
   VALUES ('nfl|kc|lv', 'nfl', 'odds-kc', '2026-10-05T17:00:00Z', 'KC', 'LV', 'Chiefs', 'Raiders', 0.8, 0.78, 'high', '2026-10-04T10:00:00Z', 20, 20, '2026-10-05T21:00:00Z')`,
).run();
// Tenis pendiente: favorito el segundo jugador.
db.prepare(
  `INSERT INTO prediction_log (match_key, tour, upcoming_id, tournament_name, commence_time, p1_id, p2_id, p1_name, p2_name, prob1, market_prob1, reliability, predicted_at)
   VALUES ('atp|1|2', 'atp', 'ev-t', 'Shanghái', '2026-10-09T08:00:00Z', 1, 2, 'Álvarez', 'Sinner', 0.3, 0.35, 'high', '2026-10-07T08:00:00Z')`,
).run();
// Dos evaluaciones antes del inicio (la base no admite otras): cuenta la última.
const ev = db.prepare(
  `INSERT INTO prediction_assessments (sport, match_key, event_id, commence_time, assessed_at, probs, decision, selection, odds, edge, stake_factor, confidence, data_quality,
     uncertainty_pp, stability, stability_pp, disagreement, disagreement_pp, market_quality, edge_vanish, ood, regime, reasons, model_version)
   VALUES ('football', 'epl|ars|che', 'ev-ars', '2026-10-04T15:00:00Z', ?, '[0.52,0.25,0.23]', 'BET', 0, 2.2, 0.1, 1, ?, 90, 3, 'ALTA', 2, 'BAJO', 2, 'ALTA', 0.01, '[]', 'temporada', '[]', 'v')`,
);
ev.run('2026-10-04T10:00:00Z', 'BAJA');
ev.run('2026-10-04T12:00:00Z', 'ALTA');
// Una señal con su CLV y política.
db.prepare(
  `INSERT INTO edge_signals (created_at, sport, event_id, selection, model_probability_calibrated, odds, edge, decision, commence_time, closing_odds, clv, policy_version_id)
   VALUES ('2026-10-04T12:00:00Z', 'football', 'ev-ars', 'Arsenal', 0.52, 2.2, 0.14, 'rechazada', '2026-10-04T15:00:00Z', 2.0, 0.1, 3)`,
).run();

test('todas las predicciones, las más recientes primero, normalizadas', () => {
  const a = buscarEnArchivo();
  assert.equal(a.total, 3);
  assert.deepEqual(a.filas.map((f) => f.sport), ['tennis', 'nfl', 'football']);
  const t = a.filas[0];
  assert.equal(t.favorito, 'Sinner');
  assert.ok(Math.abs(t.probabilidad - 0.7) < 1e-12);
  assert.equal(t.resultado, 'pendiente');
  assert.equal(t.liga, 'Shanghái');
  const n = a.filas[1];
  assert.equal(n.partido, 'Raiders @ Chiefs');
  assert.equal(n.probabilidad, 0.78, 'la probabilidad ENSEÑADA, no la cruda');
  assert.equal(n.resultado, 'nulo', 'empate de NFL: ni acierto ni fallo');
  const f = a.filas[2];
  assert.deepEqual(f.salidas, ['Arsenal', 'Empate', 'Chelsea']);
  assert.equal(f.favorito, 'Arsenal');
  assert.equal(f.resultado, 'acierto');
  assert.equal(f.marcador, '2-1');
  assert.equal(f.confianza, 'ALTA', 'la última evaluación antes del inicio');
  assert.equal(f.clv, 0.1);
  assert.equal(f.clvDe, 'señal');
  assert.equal(f.politica, 3);
  assert.equal(f.url, '/partido/football/ev-ars?clave=epl%7Cars%7Cche');
  assert.deepEqual([a.resumen.resueltas, a.resumen.aciertos, a.resumen.pendientes], [1, 1, 1]);
  assert.equal(a.resumen.aviso.nivel, 'insuficiente');
});

test('filtros: texto sin tildes, deporte, liga, confianza, banda, resultado y fechas', () => {
  assert.equal(buscarEnArchivo({ q: 'alvarez' }).total, 1);
  assert.equal(buscarEnArchivo({ sport: 'nfl' }).total, 1);
  assert.equal(buscarEnArchivo({ liga: 'epl' }).total, 1);
  assert.equal(buscarEnArchivo({ confianza: 'ALTA' }).total, 1);
  assert.equal(buscarEnArchivo({ confianza: 'ninguna' }).total, 2);
  assert.equal(buscarEnArchivo({ banda: '≥ 75 %' }).total, 1);
  assert.equal(buscarEnArchivo({ resultado: 'acierto' }).total, 1);
  assert.equal(buscarEnArchivo({ desde: '2026-10-05', hasta: '2026-10-05' }).total, 1);
  const p = buscarEnArchivo({ porPagina: 2, pagina: 2 });
  assert.equal(p.filas.length, 1);
  assert.equal(p.total, 3);
  assert.ok(buscarEnArchivo().ligas.some((l) => l.liga === 'epl'));
});

test('bandas de la probabilidad del favorito', () => {
  assert.deepEqual([bandaDe(0.55), bandaDe(0.6), bandaDe(0.8)], ['50–60 %', '60–75 %', '≥ 75 %']);
});
