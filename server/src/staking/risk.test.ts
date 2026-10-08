import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { gruposDe, cabeEnGrupos, riesgoCartera, LIMITES } = await import('./risk.ts');
const { getDb } = await import('../db.ts');

const db = getDb();
const INICIO = new Date(Date.now() + 48 * 3_600_000).toISOString();
function abierta(id: string, sport: string, stake: number, grupos: string[]) {
  db.prepare(
    `INSERT INTO paper_bets (placed_at, sport, match_key, event_id, label, selection, p_model, p_market, odds, stake, bankroll_at, commence_time, correlation_groups)
     VALUES (?, ?, ?, ?, 'x', 'x', 0.5, 0.5, 2, ?, 1000, ?, ?)`,
  ).run(new Date().toISOString(), sport, id, id, stake, INICIO, JSON.stringify(grupos));
}

test('grupos: el evento primero, y cada participante (jugador en tenis, equipo en el resto)', () => {
  assert.deepEqual(gruposDe('basketball', 'ev1', ['lal', 'bos']), ['evento:basketball:ev1', 'equipo:basketball:lal', 'equipo:basketball:bos']);
  assert.deepEqual(gruposDe('tennis', 'm1', ['104925', '']), ['evento:tennis:m1', 'jugador:tennis:104925']);
});

test('tope por equipo: con 25 ya abiertos en los Lakers, a otra de los Lakers solo le caben 5 (3 % de 1.000)', () => {
  abierta('a1', 'basketball', 25, gruposDe('basketball', 'a1', ['lal', 'bos']));
  const g = gruposDe('basketball', 'a2', ['lal', 'mia']);
  const r = cabeEnGrupos(g, 1000);
  assert.equal(r.cabe, LIMITES.max_same_team_exposure * 1000 - 25);
  assert.equal(r.limitante, 'equipo:basketball:lal');
  // Lo decidido en la misma pasada también cuenta.
  assert.equal(cabeEnGrupos(g, 1000, new Map([['equipo:basketball:lal', 5]])).cabe, 0);
  // Otro partido sin equipos en común: cabe el tope del evento.
  assert.equal(cabeEnGrupos(gruposDe('basketball', 'a3', ['den', 'phx']), 1000).cabe, LIMITES.max_same_event_exposure * 1000);
});

test('riesgo de cartera: total, por deporte y grupos con más de una apuesta', () => {
  abierta('t1', 'tennis', 15, gruposDe('tennis', 't1', ['1', '2']));
  abierta('a4', 'basketball', 10, gruposDe('basketball', 'a4', ['lal', 'den']));
  const r = riesgoCartera(1000);
  assert.equal(r.total.importe, 50);
  assert.ok(Math.abs(r.total.pct - 0.05) < 1e-12);
  assert.deepEqual(r.porDeporte.map((d) => d.deporte), ['basketball', 'tennis']);
  const lal = r.grupos.find((g) => g.grupo === 'equipo:basketball:lal')!;
  assert.equal(lal.apuestas, 2);
  assert.equal(lal.excede, true, '35 > 30: se avisa (las ya abiertas no se tocan)');
});
