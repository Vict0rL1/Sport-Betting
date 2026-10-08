// Inteligencia de mercado sobre snapshots sintéticos: steam, surebet y referencia afilada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { steamDe, surebetDe, referenciaDe, inteligenciaMercado, STEAM_MIN_PP } = await import('./intel.ts');
const { getDb } = await import('../db.ts');

const q = (bookmaker: string, odds: number, observedAt = '2026-10-07T10:00:00Z') => ({ bookmaker, odds, line: null, observedAt });

test('steamDe: solo movimientos rápidos, con casas suficientes', () => {
  const p = (at: string, consensus: number, books = 4) => ({ at, consensus, books });
  assert.equal(steamDe([p('2026-10-07T09:00:00Z', 2.0), p('2026-10-07T09:30:00Z', 1.98)]), null, 'medio punto no es steam');
  const s = steamDe([p('2026-10-07T08:00:00Z', 2.2), p('2026-10-07T09:10:00Z', 2.1), p('2026-10-07T09:40:00Z', 1.9)]);
  assert.ok(s && s.movimientoPp >= STEAM_MIN_PP);
  assert.equal(s?.minutos, 30, 'solo lo movido dentro de la ventana');
  assert.equal(steamDe([p('2026-10-07T09:00:00Z', 2.2, 2), p('2026-10-07T09:30:00Z', 1.8, 2)]), null, 'dos casas no bastan');
});

test('surebetDe y referenciaDe', () => {
  const sb = surebetDe([
    { seleccion: 'A', cuotas: [q('x', 2.1), q('y', 2.0)] },
    { seleccion: 'B', cuotas: [q('x', 1.9), q('y', 2.1)] },
  ]);
  assert.ok(sb && sb.suma < 1);
  assert.deepEqual(sb?.patas.map((p) => p.casa), ['x', 'y']);
  assert.equal(surebetDe([{ seleccion: 'A', cuotas: [q('x', 1.9)] }, { seleccion: 'B', cuotas: [q('x', 1.9)] }]), null);
  const ref = referenciaDe([
    { seleccion: 'A', cuotas: [q('pinnacle', 1.95), q('y', 1.8)] },
    { seleccion: 'B', cuotas: [q('pinnacle', 1.95), q('y', 2.1)] },
  ]);
  assert.ok(ref);
  assert.equal(ref?.selecciones[0].referencia, 0.5);
  assert.ok((ref?.selecciones[0].desviacionPp as number) > 0, 'el consenso acorta A frente a Pinnacle');
  assert.equal(referenciaDe([{ seleccion: 'A', cuotas: [q('y', 1.8)] }, { seleccion: 'B', cuotas: [q('y', 2.1)] }]), null);
});

test('inteligenciaMercado lee los snapshots reales y con la base vacía no inventa nada', () => {
  const vacio = inteligenciaMercado(new Date('2026-10-07T10:00:00Z'));
  assert.equal(vacio.eventos, 0);
  assert.deepEqual([vacio.steam, vacio.surebets, vacio.referencia], [[], [], []]);
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO odds_snapshots (event_id, sport, league, market, selection, bookmaker, odds_decimal, line, home_team, away_team, commence_time, observed_at, source, is_live)
     VALUES ('ev1', 'football', 'soccer_epl', 'h2h', ?, ?, ?, NULL, 'Casa', 'Fuera', '2026-10-08T15:00:00Z', ?, 'test', 0)`,
  );
  for (const [sel, casa, cuota, at] of [
    ['Casa', 'pinnacle', 2.0, '2026-10-07T08:00:00Z'], ['Casa', 'x', 2.0, '2026-10-07T08:00:00Z'], ['Casa', 'y', 2.0, '2026-10-07T08:00:00Z'],
    ['Fuera', 'pinnacle', 2.0, '2026-10-07T08:00:00Z'], ['Fuera', 'x', 2.0, '2026-10-07T08:00:00Z'], ['Fuera', 'y', 2.1, '2026-10-07T08:00:00Z'],
    ['Casa', 'pinnacle', 1.8, '2026-10-07T09:50:00Z'], ['Casa', 'x', 1.8, '2026-10-07T09:50:00Z'], ['Casa', 'y', 1.8, '2026-10-07T09:50:00Z'],
  ] as [string, string, number, string][]) ins.run(sel, casa, cuota, at);
  const r = inteligenciaMercado(new Date('2026-10-07T10:00:00Z'));
  assert.equal(r.eventos, 1);
  assert.equal(r.steam.length, 1);
  assert.equal(r.steam[0].seleccion, 'Casa');
  assert.ok(r.steam[0].movimientoPp > 0);
  assert.equal(r.surebets.length, 0, '1/1.8 + 1/2.1 > 1');
  assert.equal(r.referencia.length, 1);
  assert.match(r.etiqueta, /Aproximación/);
});
