import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { emitirAlerta, alertas } = await import('../alerts/engine.ts');
const { recordSnapshot } = await import('../prematch/snapshots.ts');
const { lineaTemporal } = await import('./timeline.ts');
const { reproducir } = await import('./reproduce.ts');
const { getDb } = await import('../db.ts');

const db = getDb();
const H = 3_600_000;
const ahora = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const INICIO = iso(ahora + 30 * H);
const KEY = 'mlb|nyy|bos|x';

const snap = (abridor: string | null, probs = [0.55, 0.45]) => ({
  sport: 'baseball' as const, matchKey: KEY, eventId: 'ev-a', commence: INICIO, outcomes: ['Red Sox', 'Yankees'], probs, probsRaw: null,
  odds: [1.9, 2.0], oddsAt: iso(ahora - 3 * H), dataAsOf: '2026-01-01T00:00:00.000Z', usaMercado: false,
  entradas: { abridorLocal: { etiqueta: 'abridor de Red Sox', valor: abridor } },
});

test('alertas: un abridor anunciado y un salto de 6 pp disparan alertas; la misma no se repite en 6 h; no se reescriben', () => {
  recordSnapshot(snap(null), new Date(ahora - 2 * H));
  recordSnapshot(snap('Sale', [0.61, 0.39]), new Date(ahora - H));
  const tipos = alertas({ matchKey: KEY }).map((a) => a.type).sort();
  assert.deepEqual(tipos, ['abridor_cambiado', 'cambio_prediccion']);
  assert.equal(emitirAlerta({ type: 'cambio_prediccion', sport: 'baseball', matchKey: KEY, title: 't', body: 'b' }), false, 'silencio de 6 h');
  assert.throws(() => db.prepare("UPDATE alerts SET title = 'x'").run(), /no se reescribe/);
  assert.throws(() => db.prepare('DELETE FROM alerts').run(), /no se borra/);
});

// Una apuesta con toda su vida, para la línea temporal y la reproducción.
db.prepare(
  `INSERT INTO bsb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
     prob_home, market_prob_home, reliability, predicted_at, model_version)
   VALUES (?, 'mlb', 'ev-a', ?, 'bos', 'nyy', 'Red Sox', 'Yankees', 0.55, 0.52, 'high', ?, 'baseball-viejo000000')`,
).run(KEY, INICIO, iso(ahora - 2 * H));
const { lastInsertRowid: betId } = db
  .prepare(
    `INSERT INTO paper_bets (placed_at, sport, match_key, event_id, label, selection, p_model, p_market, odds, stake, bankroll_at,
       commence_time, model_version, model_probability_calibrated, edge, confidence, data_quality, trust_stake_factor)
     VALUES (?, 'baseball', ?, 'ev-a', 'Red Sox vs Yankees', 'Red Sox', 0.61, 0.52, 1.9, 12, 1000, ?, 'baseball-viejo000000', 0.61, 0.159, 'MEDIA', 75, 0.5)`,
  )
  .run(iso(ahora - 0.5 * H), KEY, INICIO);
// Una instantánea POSTERIOR a la apuesta, con otro abridor: la reproducción no puede usarla.
recordSnapshot(snap('Bello', [0.5, 0.5]), new Date(ahora - 0.25 * H));

test('línea temporal: predicción, instantáneas, alertas y apuesta, en orden y solo de lo guardado', () => {
  const t = lineaTemporal('baseball', KEY);
  const tipos = t.hitos.map((h) => h.tipo);
  assert.ok(tipos.includes('predicción') && tipos.includes('instantánea') && tipos.includes('apuesta') && tipos.includes('alerta') && tipos.includes('inicio'));
  const ats = t.hitos.map((h) => h.at);
  assert.deepEqual(ats, [...ats].sort(), 'en orden');
  assert.match(t.nota, /Solo hechos guardados/);
});

test('reproducir una apuesta: lo guardado, las entradas de ANTES de apostar y aviso de versión distinta', () => {
  const r = reproducir(`apuesta:${betId}`);
  assert.equal(r.encontrado, true);
  const c = Object.fromEntries(r.campos);
  assert.equal(c['Model version'], 'baseball-viejo000000');
  assert.match(c['Features available'], /abridor de Red Sox = Sale/);
  assert.doesNotMatch(c['Features available'], /Bello/, 'la instantánea posterior a la apuesta no cuenta');
  assert.match(c['Calibrated prediction'], /61\.00 %/);
  assert.match(c['Raw prediction'], /no guardado/, 'lo que no se guardó se dice, no se reconstruye');
  assert.ok(r.avisos.some((a) => /otra versión/.test(a)));
  assert.equal(reproducir('apuesta:999999').encontrado, false);
});

test('reproducir una predicción registrada por su clave', () => {
  const r = reproducir(`baseball:${KEY}`);
  assert.equal(r.encontrado, true);
  assert.match(Object.fromEntries(r.campos)['Bet/no bet'], /BET/);
});
