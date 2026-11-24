// Build the full, explainable prediction for one baseball game.
//
// Like football, everything comes out of ONE run distribution — the winner, the
// total, the run line, the likely scores — so the figures cannot contradict each
// other. Unlike football, the biggest single input is a named individual, so the
// breakdown has to say who is pitching and what the model thinks that is worth.

import { VALUE_THRESHOLD } from '../model/market.ts';
import {
  expectedRuns,
  expectedTotalRuns,
  gridForDisplay,
  impliedFromMoneyline,
  marginDistribution,
  overProbability,
  pythagorean,
  runDistribution,
  runLine,
  topScorelines,
  winProbability,
  carryOver,
  HOME_ADVANTAGE,
  SEASON_CARRYOVER,
  RUN_SENSITIVITY,
  type MarketProbabilities,
  type RunMargin,
  type ScoreLine,
} from './model.ts';
import {
  getEloRank,
  getLeagueLatestDate,
  getMeetings,
  getPitcher,
  getRating,
  getRecentGames,
  getRecords,
  getRotation,
  getTeam,
} from './repo.ts';
import { getHomePark, getParkFactor } from './parkFactors.ts';
import { getLeagueRunsPerGame, PITCHER_CARRYOVER } from './ratings.ts';
import type { BsbRecord, LeagueId } from './types.ts';
import { dec, exacto, exactoSigno, explica, fecha, frases, int, motivos, porc, resumen, sinTexto, txt, type Explicacion, type ExplicacionConTexto, type ParamExp, type Resumen } from '../explicaciones/index.ts';

export const DISCLAIMER =
  'Estimación estadística basada en Elo con ventaja de campo, el lanzador abridor anunciado, ' +
  'el factor del estadio y una distribución binomial negativa de carreras, comparada con las ' +
  'cuotas del mercado. NO conoce el bullpen, ni la alineación, ni las lesiones de última hora, ' +
  'ni el clima del día. No es una certeza ni una recomendación para apostar.';

/** The over/under line the app quotes when the market doesn't supply one. */
export const DEFAULT_TOTAL_LINE = 8.5;

export type ReliabilityLevel = 'high' | 'medium' | 'low';

const ELO_SIGMA_C = 200;
/**
 * Games of history that actually inform TODAY's rating.
 *
 * Capped at roughly one season. The database holds sixteen years, and taken at
 * face value that makes every Elo look known to within a hair — the badge came
 * out "fiabilidad alta ±0.8 pp" for every MLB game, which is both wrong and
 * useless. What limits the precision of a rating is not how many games were ever
 * played, it is how many of them describe the current roster; a 2011 Brewers game
 * says nothing about the 2025 Brewers. So the sample that counts is bounded.
 */
const EFFECTIVE_GAMES_CAP = 162;
const STALE_SIGMA_PER_MONTH = 25;
const STALE_SIGMA_CAP = 150;
const MIN_GAMES_FOR_ANY_CONFIDENCE = 30;
const GAMES_FOR_HIGH = 200;
const MARGIN_HIGH_MAX = 3;
const MARGIN_LOW_MIN = 7;

export interface BsbStarter {
  id: string | null;
  name: string | null;
  starts: number;
  /** Runs allowed per start, raw. */
  runsPerStart: number | null;
  /** Opponent-adjusted run-suppression ratio; below 1 = better than average. */
  rating: number | null;
  /** How this starter multiplies the runs the OTHER team is expected to score. */
  runFactor: number;
  /** Plain wording for the card. */
  label: string;
  /** La misma descripción como código (explicaciones/); null mientras no hay abridor construido. */
  explicacion: Explicacion | null;
}

export interface BsbSide {
  id: string;
  name: string;
  elo: number;
  eloRank: number;
  gamesInDb: number;
  rs: number | null;
  ra: number | null;
  pythagorean: number | null;
  record: BsbRecord;
  venueRecord: BsbRecord;
  last10: ('W' | 'L')[];
  expectedRuns: number;
  starter: BsbStarter;
}

export interface BsbReliability {
  level: ReliabilityLevel;
  label: string;
  marginPp: number;
  reasons: string[];
  /** Los mismos motivos, como códigos (explicaciones/): la web los escribe en su idioma. */
  explicaciones: Explicacion[];
  gamesBehind: { home: number; away: number };
}

export interface BsbMarketComparison {
  market: (MarketProbabilities & { odds: { home: number; away: number } }) | null;
  edge: { home: number; away: number } | null;
  verdict: 'value_home' | 'value_away' | 'agree' | 'no_market';
}

// El umbral del aviso «posible valor» es UNO para los cinco deportes y vive en
// model/market.ts: estaba copiado aquí a mano, como en otros tres sitios.
export { VALUE_THRESHOLD };

export interface BsbPrediction {
  league: LeagueId;
  teams: { home: BsbSide; away: BsbSide };
  model: { home: number; away: number };
  runs: {
    expectedHome: number;
    expectedAway: number;
    expectedTotal: number;
    totalLine: number;
    over: number;
    under: number;
    /** Home team wins by 2+ / everything else. Baseball's fixed ±1.5 handicap. */
    runLine: { homeCovers: number; awayCovers: number };
    /** Probability the nine innings end level. */
    extraInnings: number;
    scorelines: (ScoreLine & { label: string })[];
    grid: { cells: number[][]; maxRuns: number; tail: number };
    margins: RunMargin[];
  };
  /**
   * The ballpark, when it is known.
   *
   * On the prediction and not just inside the arithmetic, because this app's whole
   * claim is that every signal is visible. A reader who sees "202 carreras
   * esperadas" at Coors deserves to know that 23 % of it is the altitude, not the
   * two line-ups.
   */
  park: {
    site: string;
    name: string;
    factor: number;
    games: number;
    /** Runs the stadium adds or removes versus a neutral one, for this matchup. */
    runsVsNeutral: number;
  } | null;
  market: BsbMarketComparison;
  h2h: {
    total: number;
    homeWins: number;
    awayWins: number;
    recent: { date: string; homeId: string; awayId: string; homeRuns: number; awayRuns: number }[];
  };
  reasoning: {
    factors: { key: 'rating' | 'home' | 'pitching'; label: string; pointsForHome: number; explicacion: Explicacion }[];
    text: string;
    /** El mismo texto, como códigos (explicaciones/). */
    explicaciones: Explicacion[];
  };
  reliability: BsbReliability;
  summary: Resumen;
  /** `label` es una frase («Gana …»): `explicacion`, su código. */
  verdict: { outcome: 'home' | 'away'; label: string; explicacion: Explicacion; probability: number; close: boolean };
  disclaimer: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function sigmaFor(games: number, monthsStale: number): number {
  const sample = ELO_SIGMA_C / Math.sqrt(games + 1);
  const stale = Math.min(monthsStale * STALE_SIGMA_PER_MONTH, STALE_SIGMA_CAP);
  return Math.sqrt(sample * sample + stale * stale);
}

function humanGap(days: number): ExplicacionConTexto {
  if (days < 60) return explica('tiempo.dias', { n: int(days) });
  const months = Math.round(days / 30);
  if (months < 24) return explica('tiempo.meses', { n: int(months) });
  return explica('tiempo.anios', { n: int(Math.round(days / 365)) });
}

function describeStarter(rating: number | null, starts: number): ExplicacionConTexto {
  if (rating == null || starts === 0) return explica('beisbol.abridor.sinDatos');
  const pctBetter = Math.round((1 - rating) * 100);
  if (Math.abs(pctBetter) < 4) return explica('beisbol.abridor.media', { n: int(starts) });
  return pctBetter > 0
    ? explica('beisbol.abridor.mejor', { pct: int(pctBetter), n: int(starts) })
    : explica('beisbol.abridor.peor', { pct: int(-pctBetter), n: int(starts) });
}

function buildStarter(league: LeagueId, id: string | null, weightApplied: number): BsbStarter {
  const row = id ? getPitcher(league, id) : null;
  const rating = row?.rating ?? null;
  const descripcion = describeStarter(rating, row?.starts ?? 0);
  return {
    id: id ?? null,
    name: row?.name ?? null,
    starts: row?.starts ?? 0,
    runsPerStart: row?.runs_per_9 ?? null,
    rating,
    runFactor: weightApplied,
    label: descripcion.texto,
    explicacion: sinTexto(descripcion),
  };
}

function buildSide(league: LeagueId, id: string, isHome: boolean): BsbSide {
  const team = getTeam(league, id);
  const rating = getRating(league, id);
  const rec = getRecords(league, id);
  return {
    id,
    name: team?.name ?? id,
    elo: rating.elo,
    eloRank: getEloRank(league, id),
    gamesInDb: rating.games_played,
    rs: rating.rs,
    ra: rating.ra,
    pythagorean: rating.rs != null && rating.ra != null ? pythagorean(rating.rs, rating.ra) : null,
    record: rec.overall,
    venueRecord: isHome ? rec.home : rec.away,
    last10: getRecentGames(league, id, 10).map((g) => g.result),
    expectedRuns: 0,
    starter: { id: null, name: null, starts: 0, runsPerStart: null, rating: null, runFactor: 1, label: '', explicacion: null },
  };
}

/**
 * Fall back to a team's most-used starter when the probables feed is silent.
 *
 * Better than assuming an average arm — a rotation's number one starts about a
 * fifth of the games and is a genuinely better guess than nobody — but it is a
 * GUESS, and the card says so rather than presenting it as an announcement.
 */
function guessStarter(league: LeagueId, teamId: string): string | null {
  const rotation = getRotation(league, teamId, 1);
  return rotation[0]?.id ?? null;
}

export function buildBaseballPrediction(
  league: LeagueId,
  homeId: string,
  awayId: string,
  market: { oddsHome: number | null; oddsAway: number | null } = { oddsHome: null, oddsAway: null },
  opts: {
    homeStarter?: string | null;
    awayStarter?: string | null;
    /** Fill unknown starters with the team's most-used arm. */
    guessStarters?: boolean;
    totalLine?: number;
    /** Fecha del partido, AAAAMMDD: decide si hay que cruzar un invierno (ver abajo). */
    gameDate?: string | null;
  } = {},
): BsbPrediction {
  const home = buildSide(league, homeId, true);
  const away = buildSide(league, awayId, false);

  // ===========================================================================
  // TEMPORADAS QUE LA BASE AÚN NO TIENE
  // ===========================================================================
  // La reproducción acerca equipos y abridores a la media al cruzar cada invierno, pero
  // al encontrar el primer partido de la temporada nueva. Si ese partido no está en la
  // base —el día inaugural, o toda una temporada si la fuente en curso (MLB Stats API)
  // no respondió—, el vivo predecía con los ratings del octubre anterior a plena
  // fuerza. Simulado prediciendo cada temporada 2016–2025 con los ratings congelados de
  // la anterior (12.884 partidos): log loss 0,68309 sin regresión, 0,68196 con ella.
  //
  // Una regresión por temporada cruzada, como en la reproducción. En el béisbol la
  // temporada es el año natural, así que se cuentan años.
  const ultimo = getLeagueLatestDate(league);
  const inviernos =
    opts.gameDate && ultimo ? Math.max(0, Number(opts.gameDate.slice(0, 4)) - Number(ultimo.slice(0, 4))) : 0;
  for (let i = 0; i < inviernos; i++) {
    home.elo = carryOver(home.elo, SEASON_CARRYOVER);
    away.elo = carryOver(away.elo, SEASON_CARRYOVER);
  }
  home.elo = Math.round(home.elo * 10) / 10;
  away.elo = Math.round(away.elo * 10) / 10;
  const regresarAbridor = (r: number | null): number | null =>
    r == null ? null : 1 + (r - 1) * Math.pow(PITCHER_CARRYOVER, inviernos);
  const leagueRuns = getLeagueRunsPerGame(league);
  const totalLine = opts.totalLine ?? DEFAULT_TOTAL_LINE;

  const guess = opts.guessStarters !== false;
  const homeSpId = opts.homeStarter ?? (guess ? guessStarter(league, homeId) : null);
  const awaySpId = opts.awayStarter ?? (guess ? guessStarter(league, awayId) : null);
  const homeSp = regresarAbridor(getPitcher(league, homeSpId ?? '')?.rating ?? null);
  const awaySp = regresarAbridor(getPitcher(league, awaySpId ?? '')?.rating ?? null);

  // The ballpark. Read from the home team's recent schedule rather than
  // configured, so a club that changed stadium is followed automatically.
  const park = getParkFactor(league, getHomePark(league, homeId));

  const lambda = expectedRuns(home.elo, away.elo, leagueRuns, {
    homePitcher: homeSp,
    awayPitcher: awaySp,
    parkFactor: park?.factor ?? null,
  });
  home.expectedRuns = round2(lambda.home);
  away.expectedRuns = round2(lambda.away);
  // A starter's factor lands on the OPPOSITION's runs, so the number shown next
  // to a pitcher is how much he suppresses what the other side scores.
  home.starter = buildStarter(league, homeSpId, round2(lambda.away / lambda.baseAway));
  away.starter = buildStarter(league, awaySpId, round2(lambda.home / lambda.baseHome));

  const dist = runDistribution(lambda.home, lambda.away);
  // Named once and used everywhere it is quoted, so the total on the card, the
  // park's contribution and the bullet text cannot come from different bases.
  const expectedTotal = round2(expectedTotalRuns(dist));
  const win = winProbability(dist);
  const over = overProbability(dist, totalLine);
  const line = runLine(dist);
  const scorelines = topScorelines(dist, 6).map((s) => ({ ...s, label: `${s.home}-${s.away}` }));

  // ---- market ----
  let marketComparison: BsbMarketComparison = { market: null, edge: null, verdict: 'no_market' };
  if (market.oddsHome && market.oddsAway) {
    const implied = impliedFromMoneyline(market.oddsHome, market.oddsAway);
    if (implied) {
      const edge = { home: win.home - implied.home, away: win.away - implied.away };
      const best = edge.home >= edge.away ? 'home' : 'away';
      marketComparison = {
        market: { ...implied, odds: { home: market.oddsHome, away: market.oddsAway } },
        edge,
        verdict: edge[best] > VALUE_THRESHOLD ? (`value_${best}` as 'value_home' | 'value_away') : 'agree',
      };
    }
  }

  // ---- head to head ----
  const meetings = getMeetings(league, homeId, awayId, 8);
  let hw = 0;
  let aw = 0;
  for (const m of meetings) {
    const homeIsSubject = m.homeId === homeId;
    const rf = homeIsSubject ? m.homeRuns : m.awayRuns;
    const ra = homeIsSubject ? m.awayRuns : m.homeRuns;
    if (rf > ra) hw++;
    else if (rf < ra) aw++;
  }

  // ---- reliability ----
  const latest = getLeagueLatestDate(league);
  const staleMonths = (lastDate: string | null): number => {
    if (!lastDate || !latest) return 0;
    const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    return Math.max(0, (d(latest) - d(lastDate)) / 86_400_000 / 30);
  };
  const homeStale = staleMonths(getRating(league, homeId).last_date);
  const awayStale = staleMonths(getRating(league, awayId).last_date);
  const effective = (games: number) => Math.min(games, EFFECTIVE_GAMES_CAP);
  const sigmaGap = Math.sqrt(
    sigmaFor(effective(home.gamesInDb), homeStale) ** 2 +
      sigmaFor(effective(away.gamesInDb), awayStale) ** 2,
  );
  const pTop = Math.max(win.home, win.away);
  const slope = (Math.LN10 * pTop * (1 - pTop)) / 400;
  const marginPp = Math.round(Math.min(sigmaGap * slope * 100, 20) * 10) / 10;

  const reasons: ExplicacionConTexto[] = [];
  for (const [side, stale] of [
    [home, homeStale],
    [away, awayStale],
  ] as [BsbSide, number][]) {
    if (side.gamesInDb < MIN_GAMES_FOR_ANY_CONFIDENCE) {
      reasons.push(explica('beisbol.fiab.pocosPartidos', { equipo: txt(side.name), n: int(side.gamesInDb) }));
    }
    if (stale >= 5) {
      reasons.push(explica('beisbol.fiab.parado', { equipo: txt(side.name), tiempo: frases([humanGap(Math.round(stale * 30))], 'coma') }));
    }
  }
  for (const side of [home, away]) {
    if (!side.starter.id) {
      reasons.push(explica('beisbol.fiab.sinAbridor', { equipo: txt(side.name) }));
    } else if (side.starter.starts < 10) {
      // Sin nombre en la base, el identificador que trae el dato: nunca un nombre inventado.
      reasons.push(explica('beisbol.fiab.pocasAperturas', { abridor: txt(side.starter.name ?? side.starter.id), n: int(side.starter.starts) }));
    }
  }
  const worstGames = Math.min(home.gamesInDb, away.gamesInDb);
  const worstStale = Math.max(homeStale, awayStale);
  const unknownStarter = !home.starter.id || !away.starter.id;
  const level: ReliabilityLevel =
    worstGames < MIN_GAMES_FOR_ANY_CONFIDENCE || marginPp >= MARGIN_LOW_MIN || worstStale >= 5
      ? 'low'
      : worstGames >= GAMES_FOR_HIGH && marginPp <= MARGIN_HIGH_MAX && worstStale < 2 && !unknownStarter
        ? 'high'
        : 'medium';
  const reliability: BsbReliability = {
    level,
    label: level === 'high' ? 'fiabilidad alta' : level === 'medium' ? 'fiabilidad media' : 'fiabilidad baja',
    marginPp,
    ...motivos(reasons),
    gamesBehind: { home: home.gamesInDb, away: away.gamesInDb },
  };

  // ---- verdict ----
  const outcome: 'home' | 'away' = win.home >= win.away ? 'home' : 'away';
  const outcomeProb = outcome === 'home' ? win.home : win.away;
  const veredicto = explica('beisbol.veredicto', { equipo: txt(outcome === 'home' ? home.name : away.name) });
  const outcomeLabel = veredicto.texto;
  // Baseball is a coin flip far more often than the other three sports. Anything
  // under 55% deserves to be called what it is rather than dressed up as a pick.
  const close = outcomeProb < 0.55;

  // ---- reasoning ----
  const ratingGap = Math.round((home.elo - away.elo) * 10) / 10;
  // The pitching matchup expressed in Elo points, by inverting the Elo→runs
  // conversion, so it sits on the same scale as the other two factors.
  const pitchRatio = (lambda.home / lambda.baseHome) / (lambda.away / lambda.baseAway);
  const pitchingElo = Math.round((Math.log10(pitchRatio) * 400) / RUN_SENSITIVITY);
  const factor = (key: 'rating' | 'home' | 'pitching', pointsForHome: number) => {
    const e = explica(`beisbol.factor.${key}`);
    return { key, label: e.texto, pointsForHome, explicacion: sinTexto(e) };
  };
  const factors: BsbPrediction['reasoning']['factors'] = [factor('rating', ratingGap), factor('home', HOME_ADVANTAGE)];
  if (Math.abs(pitchingElo) >= 1) factors.push(factor('pitching', pitchingElo));
  // La diferencia de Elo con sus decimales y la coma (antes salía «45.3 puntos»).
  const puntos = exacto(Math.abs(ratingGap));
  const lectura =
    Math.abs(ratingGap) < 20
      ? explica('beisbol.lectura.igualados')
      : ratingGap > 0
        ? explica('beisbol.lectura.mejorLocal', { equipo: txt(home.name), puntos })
        : explica('beisbol.lectura.mejorVisitante', { equipo: txt(away.name), puntos });
  const reasoningText = lectura.texto;

  // ---- summary ----
  const top = scorelines[0];
  const headline = close
    ? explica('beisbol.titular.igualado', { equipo: txt(outcome === 'home' ? home.name : away.name), p: porc(outcomeProb) })
    : explica('beisbol.titular', { opcion: frases([veredicto], 'coma'), p: porc(outcomeProb), marcador: txt(top.label), pMarcador: porc(top.probability) });

  const local = txt(home.name);
  const visitante = txt(away.name);
  const bullets: ExplicacionConTexto[] = [];
  if (inviernos > 0) {
    bullets.push(
      inviernos === 1
        ? explica('beisbol.invierno.uno', { fecha: fecha(ultimo!) })
        : explica('beisbol.invierno.varios', { fecha: fecha(ultimo!), n: int(inviernos) }),
    );
  }
  bullets.push(explica('beisbol.ganador', { local, pLocal: porc(win.home), visitante, pVisitante: porc(win.away) }));
  const abridor = (x: BsbStarter): ParamExp => (x.name ? txt(x.name) : frases([explica('beisbol.sinAnunciar')], 'coma'));
  const detalle = (x: BsbStarter): ParamExp => frases([describeStarter(x.rating, x.starts)], 'coma');
  bullets.push(
    explica('beisbol.abridores', {
      local,
      abridorLocal: abridor(home.starter),
      detalleLocal: detalle(home.starter),
      visitante,
      abridorVisitante: abridor(away.starter),
      detalleVisitante: detalle(away.starter),
    }),
  );
  bullets.push(
    explica('beisbol.carreras', { local, cLocal: exacto(home.expectedRuns), cVisitante: exacto(away.expectedRuns), visitante, total: exacto(round2(expectedTotalRuns(dist))) }),
  );
  bullets.push(
    explica('beisbol.total', { linea: exacto(totalLine), pMas: porc(over), pMenos: porc(1 - over), local, hcp: exactoSigno(-1.5), pLinea: porc(line.homeCovers) }),
  );
  if (park && Math.abs(park.factor - 1) >= 0.02) {
    const pct = Math.round((park.factor - 1) * 100);
    const runs = round2(expectedTotal - expectedTotal / park.factor);
    bullets.push(
      explica(pct > 0 ? 'beisbol.estadio.sube' : 'beisbol.estadio.baja', { estadio: txt(park.name), pct: int(Math.abs(pct)), carreras: exactoSigno(runs), n: int(park.games) }),
    );
  }
  bullets.push(explica('beisbol.extras', { p: porc(dist.extraInnings) }));
  bullets.push(
    explica('beisbol.elo', { local, eloLocal: int(home.elo), rankLocal: int(home.eloRank), visitante, eloVisitante: int(away.elo), rankVisitante: int(away.eloRank) }),
  );
  bullets.push(
    explica('beisbol.balance', {
      local,
      g: int(home.record.wins),
      p: int(home.record.losses),
      gCasa: int(home.venueRecord.wins),
      pCasa: int(home.venueRecord.losses),
      visitante,
      g2: int(away.record.wins),
      p2: int(away.record.losses),
      gFuera: int(away.venueRecord.wins),
      pFuera: int(away.venueRecord.losses),
    }),
  );
  if (home.pythagorean != null && away.pythagorean != null) {
    bullets.push(explica('beisbol.pitagorico', { local, pLocal: porc(home.pythagorean), visitante, pVisitante: porc(away.pythagorean) }));
  }
  if (home.last10.length && away.last10.length) {
    bullets.push(explica('beisbol.ultimos10', { local, fLocal: txt(home.last10.join('')), visitante, fVisitante: txt(away.last10.join('')) }));
  }
  if (meetings.length > 0) {
    bullets.push(explica('beisbol.h2h', { local, g: int(hw), p: int(aw), visitante, n: int(meetings.length) }));
  }
  if (marketComparison.market) {
    const m = marketComparison.market;
    if (marketComparison.verdict === 'agree') {
      bullets.push(explica('beisbol.mercado.coincide', { pLocal: porc(m.home), pVisitante: porc(m.away) }));
    } else {
      const which = marketComparison.verdict === 'value_home' ? local : visitante;
      const diff = marketComparison.verdict === 'value_home' ? marketComparison.edge!.home : marketComparison.edge!.away;
      bullets.push(explica('beisbol.mercado.value', { pp: dec(diff * 100, 1), quien: which }));
    }
  } else {
    bullets.push(explica('beisbol.mercado.sin'));
  }
  if (reliability.level !== 'high') {
    const margen = dec(reliability.marginPp, 1);
    const primero = reliability.explicaciones[0];
    bullets.push(
      primero
        ? explica(`beisbol.aviso.${reliability.level}.motivo`, { margen, motivo: { t: 'frases', v: [primero], sep: 'coma' } })
        : explica(`beisbol.aviso.${reliability.level}`, { margen }),
    );
  }

  return {
    league,
    teams: { home, away },
    model: {
      home: Math.round(win.home * 100000) / 100000,
      away: Math.round(win.away * 100000) / 100000,
    },
    runs: {
      expectedHome: home.expectedRuns,
      expectedAway: away.expectedRuns,
      expectedTotal,
      totalLine,
      over: Math.round(over * 100000) / 100000,
      under: Math.round((1 - over) * 100000) / 100000,
      runLine: {
        homeCovers: Math.round(line.homeCovers * 100000) / 100000,
        awayCovers: Math.round(line.awayCovers * 100000) / 100000,
      },
      extraInnings: Math.round(dist.extraInnings * 100000) / 100000,
      scorelines,
      grid: gridForDisplay(dist),
      margins: marginDistribution(dist),
    },
    park: park
      ? {
          site: park.site,
          name: park.name,
          factor: park.factor,
          games: park.games,
          // What the factor is WORTH here, in runs — the unit the over/under is
          // priced in. A percentage is not actionable; "+1.9 carreras" is.
          //
          // Derived from expectedTotal and NOT from the raw lambdas, even though the
          // factor was applied to the lambdas: the distribution is truncated, so its
          // mean sits a little under their sum. Using the lambdas made the card claim
          // "+2.00 carreras" next to a total that had only moved 1.93 — two numbers
          // on one card computed from two different bases. The audit caught it.
          runsVsNeutral: round2(expectedTotal - expectedTotal / park.factor),
        }
      : null,
    market: marketComparison,
    h2h: { total: meetings.length, homeWins: hw, awayWins: aw, recent: meetings },
    reasoning: { factors, text: reasoningText, explicaciones: [sinTexto(lectura)] },
    reliability,
    summary: resumen(headline, bullets),
    verdict: { outcome, label: outcomeLabel, explicacion: sinTexto(veredicto), probability: outcomeProb, close },
    disclaimer: DISCLAIMER,
  };
}
