// Registro personal (Fase 5.16): importación CSV, sugerencia de stake con la política Kelly y
// CLV de las apuestas propias cuando hay snapshot que casar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { parsearCsv, importarCsv } = await import('./importar.ts');
const { sugerenciaStake } = await import('./sugerencia.ts');
const { clvDeApuesta } = await import('./clv.ts');
const { createBet, getBet } = await import('../bets.ts');
const { guardarAjustes } = await import('../ajustes/index.ts');
const { politica } = await import('../staking/policyStore.ts');
const { getDb } = await import('../db.ts');

test('parsearCsv: comas o punto y coma, comillas con comas y comillas dobles dentro', () => {
  assert.deepEqual(parsearCsv('a,b\n"x, y","he dijo ""no"""\r\n'), [['a', 'b'], ['x, y', 'he dijo "no"']]);
  assert.deepEqual(parsearCsv('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']]);
});

test('importarCsv: guarda las filas válidas con etiquetas y devuelve las malas con su línea', () => {
  const csv = 'sport,event,market,selection,odds,stake,placed_on,tags\nnfl,Jets @ Bills,moneyline,Bills,1.80,10,2026-10-01,valor|nfl\nnfl,Jets @ Bills,moneyline,Jets,0.9,10,,\nfootball,Betis vs Sevilla,moneyline,Sevilla,"2,40",5,01/10/2026,';
  const r = importarCsv(csv, (input) => createBet(input));
  assert.equal(r.importadas, 1);
  assert.deepEqual(r.rechazadas.map((x) => x.linea), [3, 4]);
  assert.match(r.rechazadas[0].error, /odds/);
  assert.match(r.rechazadas[1].error, /placed_on/);
  const b = getBet(r.ids[0]);
  assert.deepEqual(b?.tags, ['valor', 'nfl']);
  assert.equal(importarCsv('sport,event\nnfl,x', (i) => createBet(i)).rechazadas[0].error, 'falta la columna market');
});

test('sugerenciaStake: misma política Kelly con tope; sin ventaja, cero; con banco personal, importe', () => {
  const p = politica().staking;
  const s0 = sugerenciaStake(0.4, 2.0);
  assert.equal(s0.fraccion, 0);
  assert.match(s0.nota, /no apostaría/);
  const s1 = sugerenciaStake(0.6, 2.1);
  assert.ok(s1.fraccion > 0 && s1.fraccion <= p.maxPerEvent);
  assert.equal(s1.importe, null, 'sin banco personal no hay importe');
  guardarAjustes({ bancoPersonal: 500 });
  const s2 = sugerenciaStake(0.6, 2.1);
  assert.equal(s2.importe, Math.round(s2.fraccion * 500 * 100) / 100);
});

test('clvDeApuesta: casa el evento por nombres y fecha, y la selección por texto; sin snapshot lo dice', () => {
  const db = getDb();
  const ins = db.prepare(
    `INSERT INTO odds_snapshots (event_id, sport, league, market, selection, bookmaker, odds_decimal, line, home_team, away_team, commence_time, observed_at, source, is_live)
     VALUES ('evc', 'nfl', 'americanfootball_nfl', 'h2h', ?, ?, ?, NULL, 'Buffalo Bills', 'New York Jets', '2026-10-04T17:00:00Z', ?, 'test', 0)`,
  );
  for (const [sel, casa, cuota] of [['Buffalo Bills', 'a', 1.7], ['Buffalo Bills', 'b', 1.72], ['New York Jets', 'a', 2.2], ['New York Jets', 'b', 2.15]] as [string, string, number][]) ins.run(sel, casa, cuota, '2026-10-04T16:00:00Z');
  db.prepare("INSERT INTO odds_event_observations (event_id, sport, league, markets, commence_time, observed_at, bookmakers) VALUES ('evc', 'nfl', 'americanfootball_nfl', 'h2h', '2026-10-04T17:00:00Z', '2026-10-04T16:00:00Z', 2)").run();
  const b = createBet({ sport: 'nfl', event: 'New York Jets @ Buffalo Bills', market: 'moneyline', selection: 'Buffalo Bills', odds: 1.85, stake: 10, placed_on: '2026-10-03' });
  const c = clvDeApuesta(b);
  assert.equal(c.eventId, 'evc');
  assert.equal(c.seleccion, 'Buffalo Bills');
  assert.ok(c.clv != null && Math.abs(c.clv - (1.85 / 1.71 - 1)) < 1e-9, 'contra la mediana de cierre');
  const otra = createBet({ sport: 'nfl', event: 'Chiefs @ Ravens', market: 'moneyline', selection: 'Chiefs', odds: 2, stake: 5, placed_on: '2026-10-03' });
  assert.equal(clvDeApuesta(otra).clv, null);
  assert.match(clvDeApuesta(otra).motivo ?? '', /sin snapshot/);
  const total = createBet({ sport: 'nfl', event: 'Jets @ Bills', market: 'total', selection: 'Over 44.5', odds: 1.9, stake: 5, placed_on: '2026-10-03' });
  assert.match(clvDeApuesta(total).motivo ?? '', /ganador/);
});
