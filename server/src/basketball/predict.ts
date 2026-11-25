// ===========================================================================
// BASKETBALL PREDICTION = how the signals combine
// ===========================================================================
// Same principle as the tennis side: every signal is expressed in Elo points, so
// the number shown can be traced back through the breakdown. For each game:
//
//   rating_home  = Elo_home + rest_home
//   rating_away  = Elo_away + rest_away
//   P(home wins) = expectedScore(rating_home + HOME_COURT, rating_away)
//
// and three quantities a basketball bettor actually looks at come out of it:
//
//   • the moneyline probability,
//   • the expected MARGIN (comparable to a bookmaker's spread), from the Elo gap
//     at ~28 Elo per point,
//   • the expected TOTAL, from both teams' scoring and conceding rates.
//
// Everything is compared against the vig-free market probability, exactly as in
// tennis, and every figure comes with how much evidence sits behind it.
// ===========================================================================

import {
  calibratedHomeWinProbability,
  carryOver,
  SEASON_CARRYOVER,
  coverProbability,
  expectedMargin,
  expectedPoints,
  marginBands,
  overProbability,
  restAdjustment,
  LONG_LAYOFF_DAYS,
  TOTAL_SIGMA,
  type MarginBand,
} from './elo.ts';
import {
  compareToMarket,
  impliedProbabilities,
  VALUE_THRESHOLD,
  type MarketComparison,
  type MarketProbabilities,
} from '../model/market.ts';
import {
  getEloRank,
  getLastGameDate,
  getLeagueAverageScore,
  getLeagueLatestDate,
  getHomeAdvantage,
  getMarginSigma,
  getMeetings,
  getRating,
  getRecentGames,
  getRecords,
  getTeam,
  type RecentGame,
} from './repo.ts';
import { daysBetween } from './ratings.ts';
import type { LeagueId, TeamRecord } from './types.ts';
import { dec, exactoSigno, explica, frases, int, motivos, porc, resumen, sinTexto, txt, type Explicacion, type ExplicacionConTexto, type ParamExp, type Resumen, EXPLICACIONES } from '../explicaciones/index.ts';

/** El aviso de este deporte, del catálogo de explicaciones (la web lo escribe en su idioma con `aviso.basketball`). */
export const DISCLAIMER: string = EXPLICACIONES['aviso.basketball'];

export type ConfidenceTier = 'toss_up' | 'slight' | 'clear' | 'strong';
export type ReliabilityLevel = 'high' | 'medium' | 'low';

/** Elo noise for a team with one game behind it; shrinks as C/√n. */
const ELO_SIGMA_C = 220;
/** Extra noise per month of staleness (an idle team's rating describes the past). */
const STALE_SIGMA_PER_MONTH = 25;
const STALE_SIGMA_CAP = 120;
const MIN_GAMES_FOR_ANY_CONFIDENCE = 10;
const GAMES_FOR_HIGH = 40;
const MARGIN_HIGH_MAX = 4;
const MARGIN_LOW_MIN = 9;

export interface Reliability {
  level: ReliabilityLevel;
  label: string;
  marginPp: number;
  range: { low: number; high: number };
  reasons: string[];
  /** Los mismos motivos, como códigos (explicaciones/): la web los escribe en su idioma. */
  explicaciones: Explicacion[];
  gamesBehind: { home: number; away: number };
}

export interface TeamSide {
  id: string;
  name: string;
  abbreviation: string | null;
  logo: string | null;
  elo: number;
  eloRank: number;
  gamesInDb: number;
  ppg: number | null;
  papg: number | null;
  record: TeamRecord;
  /** Record at this venue: home record for the home team, away for the away. */
  venueRecord: TeamRecord;
  /** Days since this team's previous game (null when unknown). */
  daysRest: number | null;
  /** True when the team played the day before — the classic fatigue case. */
  backToBack: boolean;
  /** Elo points this team gains or loses from its rest situation. */
  restAdjustment: number;
  last10: { won: boolean; pts: number; oppPts: number; home: boolean }[];
}

export interface ReasoningFactor {
  key: 'rating' | 'home' | 'rest';
  label: string;
  /** Elo points in favour of the HOME team (signed). */
  pointsForHome: number;
  /** La etiqueta como código (explicaciones/). */
  explicacion: Explicacion;
}

export interface HeadToHead {
  total: number;
  homeWins: number;
  awayWins: number;
  /** Average margin from the home team's perspective across all meetings. */
  averageMargin: number | null;
  /**
   * The same tally restricted to recent seasons. An all-time NBA head-to-head can
   * span 60 years and two different franchises' worth of players, so it says very
   * little about tonight; the recent window is the informative one.
   */
  recentSeasons: { seasons: number; homeWins: number; awayWins: number } | null;
  recent: {
    date: string;
    homeId: string;
    awayId: string;
    homePts: number;
    awayPts: number;
    isPlayoff: boolean;
  }[];
}

export interface ScoreProjection {
  /** Expected margin for the home team; negative means the away team is favoured. */
  margin: number;
  /** How the app would phrase a spread, e.g. "Celtics -6.5". */
  spreadLabel: string;
  /** El mismo hándicap como código (explicaciones/): la web lo escribe en su idioma. */
  spreadExplicacion: Explicacion;
  home: number | null;
  away: number | null;
  total: number | null;
  /**
   * The spread and the total as PROBABILITIES rather than point estimates.
   *
   * "Celtics −6.5" says how much; it does not say how likely, and those are the
   * two markets people actually bet. The margin residual is close to normal
   * (sd 11.7, ±1σ within 2 pp of textbook over 58k games), so a normal is an
   * honest way to answer the second question.
   *
   * NOTE THE ABSENCE OF A WIN PROBABILITY HERE, on purpose. Integrating this
   * normal above zero gives ~72% where the Elo curve gives ~76% for the same
   * game: the two mappings (Elo→probability, and Elo→margin→probability) are
   * calibrated separately and are not forced to agree, and the normal
   * under-states big favourites because its tail is thinner than the logistic's.
   * The Elo probability is the one that was MEASURED against 58k results
   * (calibration within 0.7 pp in every band), so it stays the single answer to
   * "who wins" and this distribution answers only the two questions it was
   * measured for: covering the handicap (Brier 0.2495) and the total. Publishing
   * both would put two different numbers for one question on the same card.
   */
  distribution: {
    marginSigma: number;
    totalSigma: number;
    /** The line the app quotes: the projected margin rounded to a half point. */
    spreadLine: number;
    /** Probability the home team covers `spreadLine`. */
    homeCovers: number;
    totalLine: number | null;
    over: number | null;
    under: number | null;
    bands: MarginBand[];
  };
}

export interface GamePrediction {
  league: LeagueId;
  neutral: boolean;
  teams: { home: TeamSide; away: TeamSide };
  model: { probHome: number; probAway: number };
  projection: ScoreProjection;
  market: MarketComparison;
  h2h: HeadToHead;
  reasoning: { factors: ReasoningFactor[]; topFactor: ReasoningFactor | null; text: string; explicaciones: Explicacion[] };
  reliability: Reliability;
  summary: Resumen;
  verdict: {
    favored: 'home' | 'away' | null;
    favoredName: string | null;
    confidence: ConfidenceTier;
    marginPct: number;
  };
  disclaimer: string;
}

function confidenceTier(prob: number): ConfidenceTier {
  const gap = Math.abs(prob - 0.5);
  if (gap < 0.05) return 'toss_up';
  if (gap < 0.12) return 'slight';
  if (gap < 0.25) return 'clear';
  return 'strong';
}

/** A gap in the largest unit that reads naturally ("~4 años", not "1489 días"). */
function humanGap(days: number): ExplicacionConTexto {
  if (days < 60) return explica('tiempo.dias', { n: int(days) });
  const months = Math.round(days / 30);
  if (months < 24) return explica('tiempo.meses', { n: int(months) });
  return explica('tiempo.anios', { n: int(Math.round(days / 365)) });
}

function sigmaFor(games: number, monthsStale: number): number {
  const sample = ELO_SIGMA_C / Math.sqrt(games + 1);
  const stale = Math.min(monthsStale * STALE_SIGMA_PER_MONTH, STALE_SIGMA_CAP);
  return Math.sqrt(sample * sample + stale * stale);
}

/**
 * How much evidence backs this probability. Same reasoning as the tennis version:
 * a first-order error propagation with a hand-set noise scale, honest about being
 * a heuristic, whose ORDER is what the backtest can validate.
 */
function computeReliability(
  probHome: number,
  home: { games: number; monthsStale: number; name: string },
  away: { games: number; monthsStale: number; name: string },
): Reliability {
  const s1 = sigmaFor(home.games, home.monthsStale);
  const s2 = sigmaFor(away.games, away.monthsStale);
  const sigmaGap = Math.sqrt(s1 * s1 + s2 * s2);
  // Slope of the Elo curve at this probability: how much one Elo point is worth.
  const slope = (Math.LN10 * probHome * (1 - probHome)) / 400;
  const marginPp = Math.round(Math.min(sigmaGap * slope * 100, 25) * 10) / 10;

  const reasons: ExplicacionConTexto[] = [];
  for (const t of [home, away]) {
    if (t.games < MIN_GAMES_FOR_ANY_CONFIDENCE) {
      reasons.push(explica('baloncesto.fiab.pocosPartidos', { equipo: txt(t.name), n: int(t.games) }));
    } else if (t.games < GAMES_FOR_HIGH) {
      reasons.push(explica('baloncesto.fiab.inestable', { equipo: txt(t.name), n: int(t.games) }));
    }
    if (t.monthsStale >= 4) {
      reasons.push(explica('baloncesto.fiab.parado', { equipo: txt(t.name), tiempo: frases([humanGap(Math.round(t.monthsStale * 30))], 'coma') }));
    }
  }

  const worstGames = Math.min(home.games, away.games);
  const worstStale = Math.max(home.monthsStale, away.monthsStale);
  let level: ReliabilityLevel;
  if (worstGames < MIN_GAMES_FOR_ANY_CONFIDENCE || marginPp >= MARGIN_LOW_MIN || worstStale >= 4) {
    level = 'low';
  } else if (worstGames >= GAMES_FOR_HIGH && marginPp <= MARGIN_HIGH_MAX && worstStale < 2) {
    level = 'high';
  } else {
    level = 'medium';
  }

  return {
    level,
    label:
      level === 'high' ? 'fiabilidad alta' : level === 'medium' ? 'fiabilidad media' : 'fiabilidad baja',
    marginPp,
    range: {
      low: clamp01(probHome - marginPp / 100),
      high: clamp01(probHome + marginPp / 100),
    },
    ...motivos(reasons),
    gamesBehind: { home: home.games, away: away.games },
  };
}

function buildSide(
  league: LeagueId,
  id: string,
  isHome: boolean,
  referenceDate: string | null,
): TeamSide {
  const team = getTeam(league, id);
  const rating = getRating(league, id);
  const records = getRecords(league, id);
  const lastDate = getLastGameDate(league, id);
  // Rest is measured against the newest game in the LEAGUE, not today's date, so
  // a stale download isn't mistaken for a team that stopped playing — the same
  // choice the tennis side makes, and for the same reason.
  const rest = referenceDate ? daysBetween(lastDate, referenceDate) : null;
  const recent: RecentGame[] = getRecentGames(league, id, 10);
  return {
    id,
    name: team?.name ?? id,
    abbreviation: team?.abbreviation ?? null,
    logo: team?.logo ?? null,
    elo: rating.elo,
    eloRank: getEloRank(league, id),
    gamesInDb: rating.games_played,
    ppg: rating.ppg,
    papg: rating.papg,
    record: records.overall,
    venueRecord: isHome ? records.home : records.away,
    daysRest: rest,
    backToBack: rest === 0,
    restAdjustment: round1(restAdjustment(rest)),
    last10: recent.map((g) => ({ won: g.won, pts: g.pts, oppPts: g.oppPts, home: g.home })),
  };
}

const H2H_RECENT_SEASONS = 3;

function buildH2H(league: LeagueId, homeId: string, awayId: string): HeadToHead {
  const meetings = getMeetings(league, homeId, awayId);
  const latestSeason = meetings.length ? Math.max(...meetings.map((m) => m.season)) : 0;
  const cutoff = latestSeason - (H2H_RECENT_SEASONS - 1);
  let homeWins = 0;
  let awayWins = 0;
  let marginSum = 0;
  let recentHome = 0;
  let recentAway = 0;
  for (const m of meetings) {
    // Express every meeting from the CURRENT home team's point of view, whichever
    // side hosted back then — otherwise the tally silently mixes perspectives.
    const homeIsSubject = m.homeId === homeId;
    const subjectPts = homeIsSubject ? m.homePts : m.awayPts;
    const otherPts = homeIsSubject ? m.awayPts : m.homePts;
    const subjectWon = subjectPts > otherPts;
    if (subjectWon) homeWins++;
    else awayWins++;
    marginSum += subjectPts - otherPts;
    if (m.season >= cutoff) {
      if (subjectWon) recentHome++;
      else recentAway++;
    }
  }
  return {
    total: meetings.length,
    homeWins,
    awayWins,
    averageMargin: meetings.length ? round1(marginSum / meetings.length) : null,
    recentSeasons:
      recentHome + recentAway > 0
        ? { seasons: H2H_RECENT_SEASONS, homeWins: recentHome, awayWins: recentAway }
        : null,
    recent: meetings.slice(0, 6),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function clamp01(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 100000) / 100000;
}

/** Spread label in the form bettors read: favourite first, negative number. */
function spreadLabel(margin: number, homeName: string, awayName: string): ExplicacionConTexto {
  if (Math.abs(margin) < 0.25) return explica('baloncesto.spread.pickem');
  const fav = margin > 0 ? homeName : awayName;
  return explica('baloncesto.spread', { equipo: txt(fav), linea: dec(-Math.abs(margin), 1) });
}

function describeRest(side: TeamSide): ExplicacionConTexto | null {
  if (side.daysRest == null) return null;
  if (side.backToBack) return explica('baloncesto.descanso.b2b', { equipo: txt(side.name) });
  if (side.daysRest === 1) return null; // the normal case; not worth a bullet
  // Past a week the gap is no longer "rest" but a layoff of unknown cause — most
  // often that the results simply end there. Saying "llega con 4064 días de
  // descanso" would be technically true and completely misleading.
  if (side.daysRest >= LONG_LAYOFF_DAYS) {
    return explica('baloncesto.descanso.parado', { equipo: txt(side.name), tiempo: frases([humanGap(side.daysRest)], 'coma') });
  }
  return explica('baloncesto.descanso.dias', { equipo: txt(side.name), n: int(side.daysRest) });
}

/** Días sin partidos a partir de los cuales el siguiente es de otra temporada. */
export const OFFSEASON_GAP_DAYS = 60;

/** Build the full, explainable prediction for one game. */
export function buildGamePrediction(
  league: LeagueId,
  homeId: string,
  awayId: string,
  market: { homeOdds: number | null; awayOdds: number | null } = { homeOdds: null, awayOdds: null },
  opts: { neutral?: boolean; gameDate?: string | null } = {},
): GamePrediction {
  // Rest is days from each team's previous game to THIS game. For a scheduled
  // fixture that is its own date; without one, fall back to the newest game on
  // record, which keeps a stale download from looking like an idle team.
  const reference = opts.gameDate ?? getLeagueLatestDate(league);
  const home = buildSide(league, homeId, true, reference);
  const away = buildSide(league, awayId, false, reference);
  const neutral = !!opts.neutral;

  // ===========================================================================
  // PRETEMPORADA: los ratings de junio no valen a plena fuerza en octubre
  // ===========================================================================
  // La reproducción acerca cada equipo a la media al cruzar un verano (SEASON_CARRYOVER),
  // porque las plantillas cambian. Pero lo hace al encontrar el PRIMER partido de la
  // temporada nueva, y hasta que ese partido está en la base, los ratings guardados son
  // los de final de curso. Resultado: el vivo predecía la jornada 1 con los Elo de las
  // Finales sin regresar, más confiado de lo que el backtest mide. La NFL tuvo el mismo
  // fallo y el mismo arreglo (ageAcrossOffseasons en nfl/predict.ts).
  //
  // La temporada nueva se detecta por el hueco de calendario y no por un número de
  // temporada: más de 60 días desde el último partido de la liga no es el parón del
  // All-Star (una semana), es un verano. Así vale para cualquier liga sin suponer cómo
  // numera sus temporadas.
  const ultimo = getLeagueLatestDate(league);
  const hueco = opts.gameDate && ultimo ? daysBetween(ultimo, opts.gameDate) : null;
  const pretemporada = hueco != null && hueco > OFFSEASON_GAP_DAYS;
  if (pretemporada) {
    home.elo = round1(carryOver(home.elo));
    away.elo = round1(carryOver(away.elo));
  }

  const homeAdj = home.elo + home.restAdjustment;
  const awayAdj = away.elo + away.restAdjustment;
  // La ventaja de campo APRENDIDA, no la constante: ver HOME_ADV_RATE.
  const homeAdvantage = getHomeAdvantage(league);

  // Round once and derive the complement, so the two sides always sum to exactly
  // 100.0% at the precision shown.
  const probHome = round5(
    calibratedHomeWinProbability(homeAdj, awayAdj, { neutral, homeAdvantage }),
  );
  const probAway = round5(1 - probHome);

  const margin = round1(
    expectedMargin(homeAdj, awayAdj, { neutral, homeAdvantage }),
  );
  const leagueAvg = getLeagueAverageScore(league);
  const points = expectedPoints(
    { ppg: home.ppg, papg: home.papg },
    { ppg: away.ppg, papg: away.papg },
    leagueAvg,
  );
  // Keep the projected score consistent with the projected margin: the Elo gap is
  // the better-measured quantity (MAE 9.2 points, zero bias in the backtest), so
  // the totals are re-centred on it rather than left to disagree.
  let projHome: number | null = null;
  let projAway: number | null = null;
  if (points) {
    const total = points.total;
    projHome = round1(total / 2 + margin / 2);
    projAway = round1(total / 2 - margin / 2);
  }

  // A half-point line never pushes, which is why books use them.
  const spreadLine = -(Math.round(margin * 2) / 2 + (Number.isInteger(margin * 2) ? 0.5 : 0));
  const totalLine =
    projHome != null && projAway != null
      ? Math.round((projHome + projAway) * 2) / 2 + 0.5
      : null;
  // Measured from recent seasons, not the frozen constant — and read ONCE, so the
  // handicap, the bands and the σ printed on the card can never describe three
  // different distributions.
  const marginSigma = getMarginSigma(league);
  const distribution = {
    // Reported EXACTLY as used, not rounded again: the stored value already carries
    // two decimals, and re-rounding to 14.1 here while `coverProbability` below runs
    // on 14.14 would publish a σ that does not reproduce the probabilities beside it.
    marginSigma,
    totalSigma: TOTAL_SIGMA,
    spreadLine: round1(spreadLine),
    homeCovers: round5(coverProbability(margin, spreadLine, marginSigma)),
    totalLine,
    over: totalLine != null ? round5(overProbability(projHome! + projAway!, totalLine)) : null,
    under: totalLine != null ? round5(1 - overProbability(projHome! + projAway!, totalLine)) : null,
    bands: marginBands(margin, marginSigma),
  };

  let marketProbs: MarketProbabilities | null = null;
  if (market.homeOdds && market.awayOdds) {
    marketProbs = impliedProbabilities(market.homeOdds, market.awayOdds);
  }
  const marketComparison = compareToMarket(probHome, marketProbs);

  const ratingGap = round1(home.elo - away.elo);
  const homeCourt = neutral ? 0 : homeAdvantage;
  const restGap = round1(home.restAdjustment - away.restAdjustment);
  // Cada factor con su código, y el código de la misma señal dentro de una frase («lo que más pesa es…»).
  const variante = (key: ReasoningFactor['key']) => (key === 'home' && neutral ? 'neutral' : key);
  const factor = (key: ReasoningFactor['key'], pointsForHome: number): ReasoningFactor => {
    const e = explica(`baloncesto.factor.${variante(key)}`);
    return { key, label: e.texto, pointsForHome, explicacion: sinTexto(e) };
  };
  const factors: ReasoningFactor[] = [factor('rating', ratingGap), factor('home', homeCourt), factor('rest', restGap)];
  const ranked = [...factors].sort((a, b) => Math.abs(b.pointsForHome) - Math.abs(a.pointsForHome));
  const top = ranked[0] ?? null;
  const favoredIsHome = probHome >= 0.5;
  const favName = favoredIsHome ? home.name : away.name;
  const dogName = favoredIsHome ? away.name : home.name;

  let lectura: ExplicacionConTexto;
  if (!top || Math.abs(top.pointsForHome) < 1) {
    lectura = explica('baloncesto.lectura.igualados');
  } else {
    const driver = top.pointsForHome >= 0 ? home.name : away.name;
    const enFrase = frases([explica(`baloncesto.factorEnFrase.${variante(top.key)}`)], 'coma');
    lectura =
      driver === favName
        ? explica('baloncesto.lectura.favorece', { fav: txt(favName), factor: enFrase })
        : explica('baloncesto.lectura.matiza', { fav: txt(favName), factor: enFrase, otro: txt(driver) });
  }
  const reasoningText = lectura.texto;

  const monthsStale = (d: number | null) => (d == null ? 0 : d / 30);
  const reliability = computeReliability(
    probHome,
    { games: home.gamesInDb, monthsStale: monthsStale(home.daysRest), name: home.name },
    { games: away.gamesInDb, monthsStale: monthsStale(away.daysRest), name: away.name },
  );

  const h2h = buildH2H(league, homeId, awayId);
  const spread = spreadLabel(margin, home.name, away.name);
  const confidence = confidenceTier(probHome);

  // ---------------- Plain-Spanish summary ----------------
  // Everything below restates figures computed above; no new modelling, so the
  // prose can never disagree with the numbers next to it.
  const favProb = porc(Math.max(probHome, probAway));
  const headline =
    confidence === 'toss_up'
      ? explica('baloncesto.titular.parejo', { fav: txt(favName), p: favProb })
      : Math.abs(margin) >= 0.5
        ? explica('baloncesto.titular.margen', { fav: txt(favName), p: favProb, puntos: dec(Math.abs(margin), 1) })
        : explica('baloncesto.titular.ajustado', { fav: txt(favName), p: favProb });

  const local = txt(home.name);
  const visitante = txt(away.name);
  const bullets: ExplicacionConTexto[] = [];

  bullets.push(
    neutral
      ? explica('baloncesto.cancha.neutral')
      : // Del número y no de una frase fija: la frase antigua decía «~60 %», que era
        // la NBA de hace veinte años y justo el error que la ventaja aprendida corrige.
        explica('baloncesto.cancha.casa', { equipo: local, puntos: int(homeAdvantage), p: porc(1 / (1 + Math.pow(10, -homeAdvantage / 400)), 0) }),
  );

  if (pretemporada) bullets.push(explica('baloncesto.pretemporada', { p: porc(SEASON_CARRYOVER, 0) }));

  bullets.push(
    explica('baloncesto.elo', { local, eloLocal: int(home.elo), rankLocal: int(home.eloRank), visitante, eloVisitante: int(away.elo), rankVisitante: int(away.eloRank) }),
  );

  if (projHome != null && projAway != null) {
    bullets.push(explica('baloncesto.marcador', { local, pLocal: int(projHome), pVisitante: int(projAway), visitante, total: int(projHome + projAway) }));
  }

  bullets.push(explica('baloncesto.diferencia', { dif: frases([spread], 'coma') }));

  // Records, split by venue because that's the relevant one for each side.
  bullets.push(
    explica('baloncesto.balance', {
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

  const formOf = (s: TeamSide): ExplicacionConTexto | null => {
    const last = s.last10.slice(0, 5);
    if (last.length === 0) return null;
    const w = last.filter((g) => g.won).length;
    return explica('baloncesto.forma.equipo', { equipo: txt(s.name), g: int(w), p: int(last.length - w), n: int(last.length) });
  };
  const f1 = formOf(home);
  const f2 = formOf(away);
  if (f1 && f2) bullets.push(explica('baloncesto.forma', { partes: frases([f1, f2], 'pyc') }));

  const restNotes = [describeRest(home), describeRest(away)].filter((x): x is ExplicacionConTexto => x != null);
  if (restNotes.length) bullets.push(explica('baloncesto.descanso', { partes: frases(restNotes, 'pyc') }));

  if (h2h.total > 0) {
    const rs = h2h.recentSeasons;
    const base = { local, visitante, hg: int(h2h.homeWins), hp: int(h2h.awayWins), total: int(h2h.total) };
    const margen: Record<string, ParamExp> = h2h.averageMargin != null ? { margen: exactoSigno(h2h.averageMargin) } : {};
    const conMargen = h2h.averageMargin != null;
    bullets.push(
      rs
        ? explica(conMargen ? 'baloncesto.h2h.reciente.margen' : 'baloncesto.h2h.reciente', { ...base, ...margen, temporadas: int(rs.seasons), g: int(rs.homeWins), p: int(rs.awayWins) })
        : explica(conMargen ? 'baloncesto.h2h.margen' : 'baloncesto.h2h', { ...base, ...margen }),
    );
  } else {
    bullets.push(explica('baloncesto.h2h.nunca'));
  }

  if (marketComparison.market) {
    const mFav = favoredIsHome
      ? marketComparison.market.implied1
      : marketComparison.market.implied2;
    const gapPp = (Math.max(probHome, probAway) - mFav) * 100;
    const pMercado = porc(mFav);
    if (Math.abs(gapPp) < VALUE_THRESHOLD * 100) {
      bullets.push(explica('baloncesto.mercado.coincide', { pMercado, fav: txt(favName) }));
    } else if (gapPp > 0) {
      bullets.push(explica('baloncesto.mercado.optimista', { fav: txt(favName), pModelo: favProb, pMercado }));
    } else {
      bullets.push(explica('baloncesto.mercado.pesimista', { fav: txt(favName), pMercado, pModelo: favProb, dog: txt(dogName) }));
    }
  } else {
    bullets.push(explica('baloncesto.mercado.sin'));
  }

  if (reliability.level !== 'high') {
    const banda = { p: favProb, margen: dec(reliability.marginPp, 1) };
    const primero = reliability.explicaciones[0];
    bullets.push(
      primero
        ? explica(`baloncesto.aviso.${reliability.level}.motivo`, { ...banda, motivo: { t: 'frases', v: [primero], sep: 'coma' } })
        : explica(`baloncesto.aviso.${reliability.level}`, banda),
    );
  }

  return {
    league,
    neutral,
    teams: { home, away },
    model: { probHome, probAway },
    projection: {
      margin,
      spreadLabel: spread.texto,
      spreadExplicacion: sinTexto(spread),
      home: projHome,
      away: projAway,
      total: projHome != null && projAway != null ? round1(projHome + projAway) : null,
      distribution,
    },
    market: marketComparison,
    h2h,
    reasoning: { factors, topFactor: top, text: reasoningText, explicaciones: [sinTexto(lectura)] },
    reliability,
    summary: resumen(headline, bullets),
    verdict: {
      favored: probHome === 0.5 ? null : favoredIsHome ? 'home' : 'away',
      favoredName: probHome === 0.5 ? null : favName,
      confidence,
      marginPct: Math.round(Math.abs(probHome - 0.5) * 1000) / 10,
    },
    disclaimer: DISCLAIMER,
  };
}

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}
