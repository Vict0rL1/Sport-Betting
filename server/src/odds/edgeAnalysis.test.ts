import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { durabilidad, resumenMercado } = await import('./edgeAnalysis.ts');
const { recordOddsResponse } = await import('./snapshots.ts');
const { getDb } = await import('../db.ts');

const db = getDb();
const T0 = Date.parse('2026-11-01T14:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const INICIO = at(600);

function obs(min: number, local: number, otraCasa = local) {
  recordOddsResponse('basketball_nba', 'h2h', {
    fetchedAt: at(min),
    events: [
      {
        id: 'ev-dur', sport_key: 'basketball_nba', commence_time: INICIO, home_team: 'Lakers', away_team: 'Celtics',
        bookmakers: [
          { key: 'pinnacle', title: 'P', markets: [{ key: 'h2h', outcomes: [{ name: 'Lakers', price: local }, { name: 'Celtics', price: 1.9 }] }] },
          { key: 'bet365', title: 'B', markets: [{ key: 'h2h', outcomes: [{ name: 'Lakers', price: otraCasa }, { name: 'Celtics', price: 1.9 }] }] },
        ],
      },
    ],
  });
}
// p = 0,50. Edge = 0,5·cuota − 1. Umbral de la política: 2 %.
obs(0, 2.0); // 0 %
obs(3, 2.12); // +6 % → empieza
obs(20, 2.14); // +7 %
obs(41, 2.02); // +1 % → termina: 38 minutos
obs(60, 2.06); // +3 % → vuelve y sigue hasta el final

test('duración del edge: inicio, fin, máximo y último, con la probabilidad fija', () => {
  const d = durabilidad('ev-dur', 'Lakers', 0.5, INICIO);
  assert.equal(d.intervalos.length, 2);
  assert.equal(d.intervalos[0].inicio, at(3));
  assert.equal(d.intervalos[0].fin, at(41));
  assert.equal(d.intervalos[0].duracionMin, 38);
  assert.ok(Math.abs(d.intervalos[0].maximo - 0.07) < 1e-9);
  assert.equal(d.intervalos[1].fin, null, 'seguía en la última observación');
  assert.ok(Math.abs((d.ultimo as number) - 0.03) < 1e-9);
  assert.ok(Math.abs((d.maximo as number) - 0.07) < 1e-9);
});

test('nada posterior al inicio cuenta', () => {
  obs(700, 3.0); // después del inicio: no debe aparecer
  const d = durabilidad('ev-dur', 'Lakers', 0.5, INICIO);
  assert.ok((d.maximo as number) < 0.1);
});

test('slippage, siguiente observación y mejor línea de una apuesta de papel', () => {
  // Detectada a 2,14 (minuto 20), apostada a 2,06 (minuto 70), con una casa a 2,20.
  obs(65, 2.06, 2.2);
  const { lastInsertRowid: id } = db
    .prepare(
      `INSERT INTO paper_bets (placed_at, sport, match_key, event_id, label, selection, p_model, p_market, odds, stake, bankroll_at,
         provider_event_id, provider_selection, signal_odds, model_probability_calibrated, commence_time)
       VALUES (?, 'basketball', 'k', 'ev-dur', 'Lakers vs Celtics', 'Lakers', 0.5, 0.48, 2.06, 10, 1000, 'ev-dur', 'Lakers', 2.14, 0.5, ?)`,
    )
    .run(at(70), INICIO);
  obs(90, 1.98, 1.98); // la siguiente observación, peor
  db.prepare("UPDATE paper_bets SET status = 'won', profit = 10.6, settled_at = ? WHERE id = ?").run(at(800), id);
  const r = resumenMercado();
  const f = r.apuestas.find((x) => x.id === Number(id))!;
  assert.ok(Math.abs((f.slippage as number) - (2.06 / 2.14 - 1)) < 1e-12);
  assert.ok(Math.abs((f.despues as number) - (1.98 / 2.06 - 1)) < 1e-12);
  assert.ok(Math.abs((f.edgePerdido as number) - 4) < 1e-9, '0,5·(2,14 − 2,06) = 4 pp de EV perdidos');
  assert.equal(f.mejor, 2.2);
  assert.equal(f.mejorCasa, 'bet365');
  assert.equal(r.roiPorLinea.n, 1);
  assert.ok(Math.abs((r.roiPorLinea.mejor as number) - 1.2) < 1e-12, 'ganó: con la mejor cuota, +120 %');
  assert.ok(Math.abs((r.roiPorLinea.apostada as number) - 1.06) < 1e-12);
  assert.equal(r.roiPorLinea.aviso.nivel, 'insuficiente');
  assert.match(r.roiPorLinea.nota, /cota superior/);
});
