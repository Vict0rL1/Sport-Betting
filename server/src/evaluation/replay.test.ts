// El backtest y «¿Acertó?» predicen igual: la misma liga sembrada, reproducida por la
// reconstrucción y por una repetición directa con el módulo compartido, da los mismos números.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { reconstruirDesde, olvidarReconstrucciones } = await import('../recent/reconstruct.ts');
const { loadMatches, replayMatches, DC_HYPER } = await import('../football/ratings.ts');
const { DcWalkForward } = await import('../football/bayes/walkforward.ts');
const { prediccionFutbolEnReplay, prediccionNflEnReplay } = await import('./replay.ts');
const { listGamesWithMarket } = await import('../nfl/repo.ts');
const { replayGames } = await import('../nfl/ratings.ts');

/** Una liga de 6 equipos, 4 temporadas de todos contra todos, con marcadores deterministas. */
function sembrarFutbol(): void {
  const db = getDb();
  const equipos = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (const e of equipos) db.prepare("INSERT OR IGNORE INTO fb_teams (id, league, name) VALUES (?, 'test_liga', ?)").run(e, e.toUpperCase());
  const ins = db.prepare("INSERT OR IGNORE INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result) VALUES ('test_liga', ?, ?, ?, ?, ?, ?, ?)");
  let semilla = 7;
  const rnd = () => (semilla = (semilla * 48271) % 2147483647) / 2147483647;
  for (let temporada = 2023; temporada <= 2026; temporada++) {
    let dia = 0;
    for (const h of equipos) {
      for (const a of equipos) {
        if (h === a) continue;
        dia++;
        const fecha = `${temporada}${String(1 + Math.floor(dia / 28)).padStart(2, '0')}${String(1 + (dia % 28)).padStart(2, '0')}`;
        const hg = Math.floor(rnd() * 4 + (h < 'c' ? 1 : 0));
        const ag = Math.floor(rnd() * 3);
        ins.run(temporada, fecha, h, a, hg, ag, hg > ag ? 'H' : hg === ag ? 'D' : 'A');
      }
    }
  }
}

test('fútbol: la reconstrucción y la repetición directa con el módulo compartido dan las mismas probabilidades', () => {
  sembrarFutbol();
  olvidarReconstrucciones();
  const desde = '20260101';
  const rec = reconstruirDesde(desde).partidos.filter((p) => p.deporte === 'Fútbol' && p.liga === 'test_liga');
  assert.ok(rec.length > 20, `reconstruidos: ${rec.length}`);
  // La repetición directa, como la haría el backtest.
  const partidos = loadMatches('test_liga' as never);
  const dc = new DcWalkForward(partidos.map((m) => ({ date: m.match_date, homeId: m.home_id, awayId: m.away_id, homeGoals: m.home_goals, awayGoals: m.away_goals })), DC_HYPER);
  const directo: { fecha: string; casa: string; fuera: string; probs: number[] }[] = [];
  replayMatches(partidos, {
    onMatch: ({ match, home, away, lambda }) => {
      if (match.match_date < desde || home.matches < 20 || away.matches < 20) return;
      directo.push({ fecha: match.match_date, casa: match.home_id, fuera: match.away_id, probs: prediccionFutbolEnReplay(dc, match, lambda).probs });
    },
  });
  assert.equal(directo.length, rec.length);
  for (let i = 0; i < rec.length; i++) {
    assert.equal(rec[i].fecha, directo[i].fecha);
    assert.equal(rec[i].casaId, directo[i].casa);
    assert.deepEqual(rec[i].probs, directo[i].probs, `partido ${i}: ${rec[i].casaId}-${rec[i].fueraId}`);
    assert.ok(Math.abs(rec[i].probs.reduce((x, y) => x + y, 0) - 1) < 1e-9);
  }
});

test('NFL: la reconstrucción usa la misma función de dos salidas que el backtest', () => {
  const db = getDb();
  for (const t of ['AAA', 'BBB', 'CCC', 'DDD']) db.prepare("INSERT OR IGNORE INTO naf_teams (id, league, name) VALUES (?, 'nfl', ?)").run(t, t);
  const ins = db.prepare("INSERT OR IGNORE INTO naf_games (league, season, week, game_date, home_id, away_id, home_points, away_points, neutral, playoff) VALUES ('nfl', ?, ?, ?, ?, ?, ?, ?, 0, 0)");
  let n = 0;
  for (let season = 2022; season <= 2026; season++) {
    for (let week = 1; week <= 12; week++) {
      const fecha = `${season}${String(9 + Math.floor((week - 1) / 4)).padStart(2, '0')}${String(1 + ((week - 1) % 4) * 7).padStart(2, '0')}`;
      ins.run(season, week, fecha, week % 2 ? 'AAA' : 'CCC', week % 2 ? 'BBB' : 'DDD', 20 + (n % 7), 17 + (n % 5));
      ins.run(season, week, fecha, week % 2 ? 'CCC' : 'BBB', week % 2 ? 'DDD' : 'AAA', 24 - (n % 6), 21 + (n % 4));
      n += 2;
    }
  }
  olvidarReconstrucciones();
  const rec = reconstruirDesde('20260901').partidos.filter((p) => p.deporte === 'NFL');
  assert.ok(rec.length > 0);
  const juegos = listGamesWithMarket('nfl' as never)
    .filter((r) => r.home_points != null && r.away_points != null)
    .map((r) => ({
      season: r.season, week: r.week, game_date: r.game_date, home_id: r.home_id, away_id: r.away_id,
      home_points: r.home_points, away_points: r.away_points, neutral: r.neutral, playoff: r.playoff,
      home_rest: r.home_rest, away_rest: r.away_rest, home_qb_id: r.home_qb_id, away_qb_id: r.away_qb_id,
      home_qb_name: r.home_qb_name, away_qb_name: r.away_qb_name, roof: r.roof, wind: r.wind,
    }));
  const directo: number[][] = [];
  replayGames(juegos as never, {
    onGame: ({ game, expectedMargin, expectedTotal }) => {
      if (game.game_date < '20260901' || game.home_points === game.away_points) return;
      directo.push(prediccionNflEnReplay(expectedMargin, expectedTotal));
    },
  });
  assert.deepEqual(rec.map((r) => r.probs), directo);
});
