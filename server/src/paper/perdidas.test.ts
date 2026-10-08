// Los límites de pérdida del banco de papel miran SUS pérdidas (paper_bets), no el registro
// personal (`bets`). Antes leían el personal y, con él vacío, el banco de papel no tenía límite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { place, perdidasPapel } = await import('./bankroll.ts');
const { perdidasRealizadas } = await import('../staking/policy.ts');
const { recordOddsResponse } = await import('../odds/snapshots.ts');

const db = getDb();
const H = 3_600_000;
const ahora = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

/** Un partido de fútbol con cuotas reales, la predicción registrada y su evaluación de confianza. */
function partido(id: string, local: string, visitante: string, enHoras: number) {
  const inicio = iso(ahora + enHoras * H);
  const k = `epl|${local}|${visitante}|x`;
  for (const [hace, cuota] of [
    [3, 2.6],
    [1, 2.5],
  ] as const)
    recordOddsResponse('soccer_epl', 'h2h', {
      fetchedAt: iso(ahora - hace * H),
      events: [
        {
          id,
          sport_key: 'soccer_epl',
          commence_time: inicio,
          home_team: local,
          away_team: visitante,
          bookmakers: [{ key: 'pinnacle', title: 'P', markets: [{ key: 'h2h', outcomes: [{ name: local, price: cuota }, { name: 'Draw', price: 3.4 }, { name: visitante, price: 3.0 }] }] }],
        },
      ],
    });
  db.prepare(
    `INSERT INTO fb_upcoming (id, league, commence_time, home_name, away_name, home_id, away_id, odds_home, odds_draw, odds_away, books, source, updated_at)
     VALUES (?, 'epl', ?, ?, ?, ?, ?, 2.5, 3.4, 3.0, 6, 'live', ?)`,
  ).run(id, inicio, local, visitante, local, visitante, iso(ahora - 30 * 60_000));
  db.prepare(
    `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
       prob_home, prob_draw, prob_away, shown_home, shown_draw, shown_away,
       market_prob_home, market_prob_draw, market_prob_away, reliability, predicted_at)
     VALUES (?, 'epl', ?, ?, ?, ?, ?, ?, 0.54, 0.24, 0.22, 0.52, 0.25, 0.23, 0.385, 0.283, 0.332, 'high', ?)`,
  ).run(k, id, inicio, local, visitante, local, visitante, iso(ahora - H));
  db.prepare(
    `INSERT INTO prediction_assessments (sport, match_key, event_id, commence_time, assessed_at, probs, decision, selection, odds, edge,
       stake_factor, confidence, data_quality, uncertainty_pp, stability, stability_pp, disagreement, disagreement_pp, market_quality,
       edge_vanish, ood, regime, reasons, model_version)
     VALUES ('football', ?, ?, ?, ?, '[0.52,0.25,0.23]', 'BET', 0, 2.5, 0.3, 1, 'ALTA', 90, 3,
       'ALTA', 2, 'BAJO', 2, 'ALTA', 0.01, '[]', 'temporada', '[]', 'football-x')`,
  ).run(k, id, inicio, iso(ahora - 10 * 60_000));
}

test('la regla: hoy y desde el lunes, por día local de liquidación', () => {
  const miercoles = new Date(2026, 9, 7, 18, 0); // miércoles 7 de octubre de 2026, hora local
  const en = (dia: number, hora = 12) => new Date(2026, 9, dia, hora, 0).toISOString();
  const r = perdidasRealizadas(
    [
      { settled_at: en(7, 9), profit: -20 }, // hoy
      { settled_at: en(5), profit: -30 }, // lunes de esta semana
      { settled_at: en(4), profit: -500 }, // domingo pasado: otra semana
      { settled_at: en(6), profit: 15 }, // las ganancias también cuentan
      { settled_at: en(7, 9), profit: null }, // anulada: cero
    ],
    miercoles,
  );
  assert.deepEqual(r, { hoy: -20, semana: -35 });
});

test('el registro personal no frena al banco de papel', () => {
  partido('epl-uno', 'Arsenal', 'Chelsea', 48);
  // Una semana horrible en el registro PERSONAL: antes, esto bloqueaba (o no) al banco de papel.
  db.prepare(
    `INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status, payout)
     VALUES (?, ?, 'football', 'X vs Y', 'moneyline', 'X', 2.0, 500, 'lost', 0)`,
  ).run(iso(ahora), new Date(ahora).toISOString().slice(0, 10));
  assert.deepEqual(perdidasPapel(new Date(ahora)), { hoy: 0, semana: 0 });
  const r = place();
  assert.equal(r.colocadas, 1, JSON.stringify(r));
});

test('con sus propias pérdidas de hoy por encima del 5 % del banco, el banco de papel no apuesta', () => {
  partido('epl-dos', 'Liverpool', 'Everton', 50);
  // Dos apuestas de papel perdidas hoy: −60 sobre un banco de 1.000 (el límite diario es el 5 %).
  // Se dan de alta pendientes y se liquidan una vez, como lo hace el banco.
  for (const i of [1, 2]) {
    db.prepare(
      `INSERT INTO paper_bets (placed_at, sport, match_key, event_id, label, selection, p_model, p_market, odds, stake, bankroll_at, commence_time)
       VALUES (?, 'football', ?, ?, 'A vs B', 'A', 0.5, 0.4, 2.0, 30, 1000, ?)`,
    ).run(iso(ahora - 10 * H), `perdida|${i}`, `perdida-${i}`, iso(ahora - 8 * H));
    db.prepare("UPDATE paper_bets SET status = 'lost', settled_at = ?, profit = -30, event_result = 'B gana', bankroll_after = ?, roi = -1 WHERE event_id = ?").run(
      iso(ahora - 60_000),
      1000 - 30 * i,
      `perdida-${i}`,
    );
  }
  const p = perdidasPapel(new Date(ahora));
  assert.equal(p.hoy, -60);
  const r = place();
  assert.equal(r.colocadas, 0, JSON.stringify(r));
  assert.ok(r.detalle.some((d) => /Liverpool.*límite de pérdida DIARIA/.test(d)), r.detalle.join('\n'));
  const s = db.prepare("SELECT decision, reason FROM edge_signals WHERE event_id = 'epl-dos'").get() as { decision: string; reason: string };
  assert.deepEqual({ ...s }, { decision: 'rechazada', reason: 'límite de pérdida DIARIA alcanzado' });
});
