// Comparador de líneas sobre snapshots sintéticos: mejor, peor, consenso, dispersión, línea más
// cotizada y surebet; con la base vacía no inventa nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { lineaDe, deLaLineaMasCotizada, margen, comparadorDeLineas, idProximo } = await import('./lineas.ts');
const { getDb } = await import('../db.ts');

const q = (bookmaker: string, odds: number, line: number | null = null) => ({ bookmaker, odds, line, observedAt: '2026-10-07T09:00:00Z' });

test('lineaDe: mejor, peor, consenso (mediana) y dispersión en pp', () => {
  const l = lineaDe('Casa', [q('a', 2.0), q('b', 2.1), q('c', 1.9)])!;
  assert.deepEqual(l.mejor, { cuota: 2.1, casa: 'b' });
  assert.deepEqual(l.peor, { cuota: 1.9, casa: 'c' });
  assert.equal(l.consenso, 2.0);
  assert.equal(l.casas, 3);
  assert.ok(l.dispersionPp > 1 && l.dispersionPp < 3, String(l.dispersionPp));
  assert.ok(Math.abs(l.mejorSobreConsenso - 0.05) < 1e-12);
  assert.equal(lineaDe('x', []), null);
});

test('hándicaps: solo se comparan cuotas de la misma línea, la más cotizada', () => {
  const r = deLaLineaMasCotizada([q('a', 1.9, -3.5), q('b', 1.95, -3.5), q('c', 2.3, -3)]);
  assert.equal(r.linea, -3.5);
  assert.equal(r.cuotas.length, 2);
  const l = lineaDe('Casa', [q('a', 1.9, -3.5), q('b', 1.95, -3.5), q('c', 2.3, -3)])!;
  assert.equal(l.mejor.cuota, 1.95, 'el 2,30 a −3 es otra apuesta');
});

test('margen: con las mejores cuotas, negativo es surebet', () => {
  assert.ok(Math.abs((margen([2.0, 2.0]) as number) - 0) < 1e-12);
  assert.ok((margen([2.1, 2.1]) as number) < 0);
  assert.equal(margen([2.0]), null);
});

test('comparadorDeLineas: con la base vacía no inventa; con snapshots, surebet arriba y enlace a la ficha', () => {
  const ahora = new Date('2026-10-07T10:00:00Z');
  assert.equal(comparadorDeLineas(ahora).mercados.length, 0);
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO odds_snapshots (event_id, sport, league, market, selection, bookmaker, odds_decimal, line, home_team, away_team, commence_time, observed_at, source, is_live)
     VALUES (?, ?, 'nfl', 'h2h', ?, ?, ?, NULL, 'Chiefs', 'Raiders', '2026-10-08T17:00:00Z', '2026-10-07T09:00:00Z', 'test', 0)`,
  );
  for (const [ev, sel, casa, cuota] of [
    ['e1', 'Chiefs', 'a', 1.5], ['e1', 'Chiefs', 'b', 1.55], ['e1', 'Raiders', 'a', 2.6], ['e1', 'Raiders', 'b', 2.7],
    ['e2', 'Chiefs', 'a', 2.15], ['e2', 'Chiefs', 'b', 1.9], ['e2', 'Raiders', 'a', 1.9], ['e2', 'Raiders', 'b', 2.1],
  ] as [string, string, string, number][]) ins.run(ev, 'nfl', sel, casa, cuota);
  db.prepare("INSERT INTO naf_upcoming (id, league, commence_time, home_id, away_id, home_name, away_name, source) VALUES ('odds-e1', 'nfl', '2026-10-08T17:00:00Z', 'KC', 'LV', 'Chiefs', 'Raiders', 'live')").run();
  const r = comparadorDeLineas(ahora);
  assert.equal(r.mercados.length, 2);
  assert.equal(r.mercados[0].eventId, 'e2', 'la surebet va primero');
  assert.equal(r.mercados[0].surebet, true);
  assert.ok((r.mercados[0].margenMejor as number) < 0);
  assert.equal(r.mercados[1].surebet, false);
  assert.equal(r.mercados[1].eventoId, 'odds-e1');
  assert.equal(idProximo('nfl', 'e2'), null);
  assert.equal(r.bancoApuestaA, 'consenso');
  assert.equal(comparadorDeLineas(ahora, { sport: 'football' }).mercados.length, 0);
});

test('el distintivo de surebet usa la misma regla que Destacados: líneas que se cubren y todas las salidas (revisión quant del 29 de octubre)', () => {
  const ahora = new Date('2026-10-07T10:00:00Z');
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO odds_snapshots (event_id, sport, league, market, selection, bookmaker, odds_decimal, line, home_team, away_team, commence_time, observed_at, source, is_live)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Casa', 'Fuera', '2026-10-08T17:00:00Z', '2026-10-07T09:00:00Z', 'test', 0)`,
  );
  // NFL, totales: el Over más cotizado en 45,5 y el Under en 44,5. Con un total de 45 pierden las dos.
  for (const [sel, casa, cuota, linea] of [['Over', 'a', 2.2, 45.5], ['Over', 'b', 2.1, 45.5], ['Over', 'c', 1.7, 44.5], ['Under', 'a', 2.2, 44.5], ['Under', 'b', 2.1, 44.5], ['Under', 'c', 1.7, 45.5]] as [string, string, number, number][]) {
    ins.run('e-totales', 'nfl', 'americanfootball_nfl', 'totals', sel, casa, cuota, linea);
  }
  // Premier, 1X2 con solo los dos equipos guardados.
  ins.run('e-sin-empate', 'football', 'soccer_epl', 'h2h', 'Casa', 'a', 2.9, null);
  ins.run('e-sin-empate', 'football', 'soccer_epl', 'h2h', 'Fuera', 'b', 2.9, null);
  const r = comparadorDeLineas(ahora);
  for (const ev of ['e-totales', 'e-sin-empate']) {
    const m = r.mercados.find((x) => x.eventId === ev);
    assert.ok(m, ev);
    assert.equal(m?.surebet, false, `${ev}: no se cubren`);
  }
});

test('la fila dice la surebet que hay, con sus líneas y el margen garantizado, aunque no sea la línea más cotizada (revisión quant)', () => {
  const ahora = new Date('2026-10-07T10:00:00Z');
  const ins = getDb().prepare(
    `INSERT INTO odds_snapshots (event_id, sport, league, market, selection, bookmaker, odds_decimal, line, home_team, away_team, commence_time, observed_at, source, is_live)
     VALUES ('e-push', 'nfl', 'americanfootball_nfl', 'spreads', ?, ?, ?, ?, 'Team A', 'Team B', '2026-10-08T17:00:00Z', '2026-10-07T09:00:00Z', 'test', 0)`,
  );
  // La más cotizada, ±3,5 a 1,9: sin hueco. La surebet está en ±3, a 2,2, en otras dos casas.
  for (const [sel, casa, cuota, linea] of [['Team A', 'a', 1.9, -3.5], ['Team A', 'b', 1.9, -3.5], ['Team A', 'c', 2.2, -3], ['Team B', 'a', 1.9, 3.5], ['Team B', 'b', 1.9, 3.5], ['Team B', 'd', 2.2, 3]] as [string, string, number, number][]) {
    ins.run(sel, casa, cuota, linea);
  }
  const m = comparadorDeLineas(ahora).mercados.find((x) => x.eventId === 'e-push');
  assert.equal(m?.surebet, true);
  assert.deepEqual(m?.detalleSurebet?.patas.map((p) => [p.seleccion, p.linea, p.casa]), [['Team A', -3, 'c'], ['Team B', 3, 'd']]);
  assert.equal(m?.detalleSurebet?.margenMinimoPct, 0, 'con 3 justos se devuelve todo');
  assert.equal(comparadorDeLineas(ahora).mercados.find((x) => x.eventId === 'e1')?.detalleSurebet, null, 'sin surebet, nada');
});
