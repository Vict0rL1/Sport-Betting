// Auditoría del 17 de octubre, punto 3: predicciones y apuestas sin resultado mucho después del
// inicio, y competiciones cuya fuente de resultados se ha quedado atrás.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { causaVencida, vencidas, motivoArchivoAtrasado, olvidarArchivoAtrasado, competicionDe, HORAS_GRACIA } = await import('./vencidas.ts');

const db = getDb();
const AHORA = new Date('2026-10-20T12:00:00Z');
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();

// La NHL: la fuente llega hasta el 6 de octubre.
db.prepare(
  `INSERT INTO nhl_games (id, season, game_type, game_date, home_id, away_id, home_goals, away_goals, ingested_at)
   VALUES (1, 2026, 2, '2026-10-06', 'EDM', 'CGY', 4, 1, '2026-10-07T06:00:00Z')`,
).run();
const nhl = (mk: string, commence: string, resuelta = false) =>
  db
    .prepare(
      `INSERT INTO nhl_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, predicted_at, home_goals, away_goals, resolved_at)
       VALUES (?, 'nhl', ?, 'EDM', 'ANA', 'Edmonton Oilers', 'Anaheim Ducks', 0.6, ?, ?, ?, ?)`,
    )
    .run(mk, commence, new Date(Date.parse(commence) - 3_600_000).toISOString(), resuelta ? 3 : null, resuelta ? 2 : null, resuelta ? hace(0) : null);
nhl('nhl|2026-10-06|EDM|CGY', '2026-10-06T01:00:00Z', true); // resuelta: no cuenta
nhl('nhl|2026-10-07|EDM|ANA', '2026-10-07T02:00:00Z'); // el día siguiente al último resultado: sin emparejar
nhl('nhl|2026-10-12|EDM|ANA', '2026-10-12T23:00:00Z'); // la fuente no llega: atrasada
nhl('nhl|2026-10-19|EDM|ANA', hace(HORAS_GRACIA - 1)); // dentro del margen: aún no vence

test('3: la causa compara la fecha del partido con hasta dónde llega la fuente de SU competición', () => {
  assert.equal(causaVencida('nhl', '2026-10-12T23:00:00Z', '2026-10-06'), 'fuente_atrasada');
  assert.equal(causaVencida('nhl', '2026-10-07T02:00:00Z', '2026-10-06'), 'sin_emparejar', 'un día de margen por la zona horaria');
  assert.equal(causaVencida('nhl', '2026-10-05T23:00:00Z', '2026-10-06'), 'sin_emparejar');
  assert.equal(causaVencida('nhl', null, '2026-10-06'), 'sin_hora');
  assert.equal(causaVencida('nhl', 'no es una fecha', '2026-10-06'), 'sin_hora');
  assert.equal(causaVencida('nhl', '2026-10-12T23:00:00Z', null), 'fuente_atrasada', 'una competición sin ningún resultado');
  // El tenis guarda la fecha de INICIO del torneo: un partido hasta 13 días después puede ser de él.
  assert.equal(causaVencida('tennis', '2026-01-25T10:00:00Z', '20260117'), 'sin_emparejar');
  assert.equal(causaVencida('tennis', '2026-10-10T10:00:00Z', '20260117'), 'fuente_atrasada');
});

test('3: la competición sale de la clave del partido (los siete registros la llevan delante)', () => {
  assert.equal(competicionDe('atp|104925|106421|20261012'), 'atp');
  assert.equal(competicionDe('laliga2|alm|cad|20261012'), 'laliga2');
  assert.equal(competicionDe('nhl|2026-10-08|CHI|NYI'), 'nhl');
  assert.equal(competicionDe('nfl|2026|3|ARI|SF'), 'nfl');
  assert.equal(competicionDe('ufc|2026-10-04|a|b'), 'ufc');
});

test('3: vencidas cuenta por competición y por causa, y no toca ninguna fila', () => {
  db.prepare(
    `INSERT INTO paper_bets (placed_at, sport, match_key, event_id, label, selection, p_model, p_market, odds, stake, bankroll_at, commence_time)
     VALUES (?, 'nhl', 'nhl|2026-10-12|EDM|ANA', 'ev-1012', 'EDM vs ANA', 'Edmonton Oilers', 0.6, 0.5, 2.0, 10, 1000, '2026-10-12T23:00:00Z')`,
  ).run('2026-10-12T20:00:00.000Z');
  db.prepare(
    `INSERT INTO paper_bets (placed_at, sport, match_key, event_id, label, selection, p_model, p_market, odds, stake, bankroll_at, commence_time)
     VALUES (?, 'football', 'epl|ars|che|20261010', 'ev-sin-registro', 'Arsenal vs Chelsea', 'Arsenal', 0.6, 0.5, 2.0, 10, 1000, '2026-10-10T14:00:00Z')`,
  ).run('2026-10-10T10:00:00.000Z');
  const antes = db.prepare('SELECT COUNT(*) AS n, SUM(resolved_at IS NULL) AS sin FROM nhl_prediction_log').get();

  const v = vencidas(AHORA);
  const c = v.competiciones.find((x) => x.sport === 'nhl' && x.competicion === 'nhl')!;
  assert.deepEqual(
    { ultimo: c.ultimoResultado, vencidas: c.vencidas, atrasada: c.fuenteAtrasada, sinEmparejar: c.sinEmparejar, masAntigua: c.masAntigua },
    { ultimo: '2026-10-06', vencidas: 2, atrasada: 1, sinEmparejar: 1, masAntigua: '2026-10-07T02:00:00Z' },
  );
  const a = v.apuestas.filter((x) => x.banco === 'papel');
  assert.deepEqual(
    a.map((x) => [x.sport, x.competicion, x.n, x.fuenteAtrasada, x.sinEmparejar, x.sinRegistro]).sort(),
    [
      ['football', 'epl', 1, 0, 0, 1],
      ['nhl', 'nhl', 1, 1, 0, 0],
    ],
  );
  assert.equal(v.total.predicciones, 2);
  assert.equal(v.total.apuestas, 2);
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n, SUM(resolved_at IS NULL) AS sin FROM nhl_prediction_log').get(), antes, 'solo lee');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM paper_bets WHERE status = 'pending'").get() as { n: number }).n, 2, 'siguen pendientes');
});

test('3: el freno por competición pide pruebas de dos días distintos: un aplazado solo no frena la liga', () => {
  olvidarArchivoAtrasado();
  // Solo el del 12 de octubre (el del 7 es «sin emparejar»): un día. Podría ser un aplazado.
  assert.equal(motivoArchivoAtrasado('nhl', 'nhl|2026-10-21|EDM|ANA', AHORA), null);

  nhl('nhl|2026-10-14|EDM|ANA', '2026-10-14T23:00:00Z');
  olvidarArchivoAtrasado();
  const m = motivoArchivoAtrasado('nhl', 'nhl|2026-10-21|EDM|ANA', AHORA);
  assert.match(m ?? '', /2 partido\(s\) de nhl empezados hace más de 48 h que la fuente no tiene, de 2 días distintos de los últimos 30 \(su último resultado es del 2026-10-06\)/);
  // La política puede alargar el margen: con 6 días, el del 14 aún no cuenta.
  assert.equal(motivoArchivoAtrasado('nhl', 'nhl|2026-10-21|EDM|ANA', AHORA, 144), null);
  // Otra competición, sin pruebas de retraso (la primera jornada de una temporada, por ejemplo): no frena.
  assert.equal(motivoArchivoAtrasado('football', 'epl|ars|che|20261025', AHORA), null);
});

test('3: la caché del freno es de su «ahora»: preguntar por otro momento vuelve a contar', () => {
  olvidarArchivoAtrasado();
  assert.ok(motivoArchivoAtrasado('nhl', 'nhl|x', AHORA));
  // El 13 de octubre por la tarde ni el del 12 llevaba 48 h: no había pruebas.
  assert.equal(motivoArchivoAtrasado('nhl', 'nhl|x', new Date('2026-10-13T18:00:00Z')), null);
});

test('3: pruebas de hace más de 30 días no frenan (unos playoffs que la fuente no trae no frenan la temporada siguiente)', () => {
  olvidarArchivoAtrasado();
  assert.equal(motivoArchivoAtrasado('nhl', 'nhl|x', new Date('2026-12-01T12:00:00Z')), null);
});

test('3: la NFL se mira por liga: una liga al día no tapa a otra atrasada', () => {
  const juego = db.prepare(
    `INSERT INTO naf_games (league, season, week, game_date, home_id, away_id, home_points, away_points) VALUES (?, 2026, 5, ?, 'KC', 'BUF', 24, 20)`,
  );
  juego.run('nfl', '20261005');
  juego.run('ncaaf', '20261018');
  const registro = db.prepare(
    `INSERT INTO naf_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, predicted_at)
     VALUES (?, ?, ?, 'KC', 'BUF', 'Kansas City', 'Buffalo', 0.6, ?)`,
  );
  registro.run('nfl|2026|6|BUF|KC', 'nfl', '2026-10-12T17:00:00Z', '2026-10-12T10:00:00.000Z');
  registro.run('nfl|2026|6|DAL|NYG', 'nfl', '2026-10-13T00:20:00Z', '2026-10-12T10:00:00.000Z');
  registro.run('ncaaf|2026|7|BUF|KC', 'ncaaf', '2026-10-17T17:00:00Z', '2026-10-17T10:00:00.000Z');
  olvidarArchivoAtrasado();
  assert.match(motivoArchivoAtrasado('nfl', 'nfl|2026|8|KC|BUF', AHORA) ?? '', /de nfl .*último resultado es del 2026-10-05/);
  assert.equal(motivoArchivoAtrasado('nfl', 'ncaaf|2026|8|KC|BUF', AHORA), null, 'la NCAA llega al 18: el del 17 está «sin emparejar», no atrasado');
});
