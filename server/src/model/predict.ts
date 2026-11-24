// ===========================================================================
// PREDICTION = how the signals combine
// ===========================================================================
// Every signal is expressed in Elo points so the combination is transparent and
// auditable. For each player we build an "effective rating" for THIS match:
//
//   1. Surface blend:  R_eff = 0.7 * (surface Elo) + 0.3 * (overall Elo)
//      → mostly the surface rating, anchored by overall form/level.
//      (If the surface is unknown we fall back to overall only.)
//   2. + recent-form delta        (bounded, see form.ts)
//   3. + head-to-head delta       (bounded + shrunk, see h2h.ts; from p1's view)
//   4. + layoff penalty           (≤ 0, see elo.ts; a long absence costs points)
//
//   model P(p1 wins) = expectedScore(R_eff_p1_adjusted, R_eff_p2_adjusted)
//
// The probability is then calibrated with a factor that depends on the FORMAT:
// best-of-5 is less noisy than best-of-3, so the same rating gap deserves more
// confidence there (see calibrationScaleFor in elo.ts).
//
// Then we compare that against the vig-free market probability (market.ts) to
// flag agreement / possible value. The verdict names the favoured player and a
// confidence tier derived purely from how far the probability sits from 50%.
// ===========================================================================

import { dec, exacto, explica, frases, int, porc, resumen, sinTexto, txt, type Explicacion, type ExplicacionConTexto, type Resumen } from '../explicaciones/index.ts';
import {
  calibratedExpectedScore,
  calibrationScaleFor,
  layoffAdjustment,
  surfaceKey,
} from './elo.ts';
import { computeForm, type FormSignal } from './form.ts';
import { computeH2H, type H2HSignal } from './h2h.ts';
import {
  compareToMarket,
  impliedProbabilities,
  VALUE_THRESHOLD,
  type MarketComparison,
  type MarketProbabilities,
} from './market.ts';
import {
  getEloRank,
  getFitnessSignals,
  getH2HMeetings,
  getPlayer,
  getRating,
  getRecentForm,
  getServeStats,
  getSurfaceRecord,
  getTournamentHistory,
} from '../repo.ts';
import { scorelineDistribution, type ScorelineDistribution } from './scoreline.ts';
import { computeReliability, type Reliability } from './reliability.ts';
import type {
  FitnessSignals,
  ServeStats,
  SurfaceRecord,
  TournamentHistory,
  TourId,
} from '../types.ts';

// SURFACE_WEIGHT vive en elo.ts (ver allí por qué), y se reexporta desde aquí porque
// es donde lo buscan los que ya lo importaban.
import { SURFACE_WEIGHT } from './elo.ts';
export { SURFACE_WEIGHT };

export const DISCLAIMER =
  'Estimación estadística basada en Elo, forma reciente, head-to-head y odds de mercado. ' +
  'NO considera lesiones de último momento, clima, cansancio ni motivación (p. ej. exhibiciones). ' +
  'No es una certeza ni una recomendación para apostar.';

export type ConfidenceTier = 'toss_up' | 'slight' | 'clear' | 'strong';

export interface EffectiveRating {
  overall: number;
  surface: number | null; // surface-specific Elo (null if surface unknown)
  surfaceKey: string | null;
  effective: number; // blended, pre-adjustment
}

export interface PlayerLite {
  id: number;
  name: string;
  country: string | null;
}

/** One driver of the verdict, expressed as Elo points in favour of p1 (signed). */
export interface ReasoningFactor {
  key: 'rating' | 'form' | 'h2h' | 'layoff';
  label: string;
  pointsForP1: number;
  /** La misma etiqueta, como código (explicaciones/): la web la escribe en su idioma. */
  explicacion: Explicacion;
}

export interface Reasoning {
  factors: ReasoningFactor[];
  topFactor: ReasoningFactor | null;
  text: string; // plain-language summary (Spanish)
  /** El mismo texto, como códigos (explicaciones/), en orden. */
  explicaciones: Explicacion[];
}

export interface ExpectedScore {
  favoredSide: 1 | 2 | null;
  likelySets: string; // e.g. "2-0", "3-1"
  note: string;
}

/** Plain-language "what is most likely to happen" for this match (y sus códigos, ver explicaciones/). */
export type MatchSummary = Resumen;

export interface Prediction {
  tour: TourId;
  surface: string;
  players: { p1: PlayerLite; p2: PlayerLite };
  ratings: { p1: EffectiveRating; p2: EffectiveRating };
  ranks: { p1: number; p2: number }; // rank by overall Elo within the tour
  form: { p1: FormSignal; p2: FormSignal };
  last5: { p1: boolean[]; p2: boolean[] }; // most recent first (true = win)
  surfaceRecord: { p1: SurfaceRecord; p2: SurfaceRecord };
  serve: { p1: ServeStats; p2: ServeStats };
  h2h: H2HSignal; // deltas expressed from p1's perspective
  /** Layoff penalty in Elo points per player (≤ 0), so the breakdown adds up. */
  layoff: { p1: number; p2: number };
  adjustedRatings: { p1: number; p2: number };
  model: { prob1: number; prob2: number };
  market: MarketComparison;
  reasoning: Reasoning;
  expectedScore: ExpectedScore;
  /** Probability of every possible scoreline, derived from the match probability. */
  scorelines: ScorelineDistribution;
  /** Retirements / absences / workload per player, from results (not a diagnosis). */
  fitness: { p1: FitnessSignals; p2: FitnessSignals };
  /** Each player's record at this tournament (empty when the event is unknown). */
  tournamentHistory: { p1: TournamentHistory; p2: TournamentHistory } | null;
  /**
   * How much evidence backs THIS probability (see reliability.ts). Two matches
   * can show the same percentage while resting on wildly different amounts of
   * data; this is what tells them apart.
   */
  reliability: Reliability;
  summary: MatchSummary;
  verdict: {
    favoredSide: 1 | 2 | null;
    favoredName: string | null;
    confidence: ConfidenceTier;
    marginPct: number; // |prob − 50%| in percentage points
  };
  disclaimer: string;
}

function effectiveRating(
  rating: { overall: number; hard: number; clay: number; grass: number },
  surface: string,
): EffectiveRating {
  const sk = surfaceKey(surface);
  if (!sk) {
    return { overall: rating.overall, surface: null, surfaceKey: null, effective: rating.overall };
  }
  const surfaceElo = rating[sk];
  const effective = SURFACE_WEIGHT * surfaceElo + (1 - SURFACE_WEIGHT) * rating.overall;
  return {
    overall: rating.overall,
    surface: surfaceElo,
    surfaceKey: sk,
    effective: Math.round(effective * 10) / 10,
  };
}

function confidenceTier(prob1: number): ConfidenceTier {
  const gap = Math.abs(prob1 - 0.5);
  if (gap < 0.05) return 'toss_up';
  if (gap < 0.12) return 'slight';
  if (gap < 0.25) return 'clear';
  return 'strong';
}

/**
 * Break the adjusted-rating gap into its drivers so we can explain WHY the model
 * favours someone. Each factor is the points it contributes to the gap in p1's
 * favour: gap = (rating) + (form) + (h2h) + (layoff).
 */
function buildReasoning(
  p1Name: string,
  p2Name: string,
  ratingGap: number, // eff1 - eff2
  formGap: number, // form1.delta - form2.delta
  h2hGap: number, // 2 * h2h.delta
  layoffGap: number, // layoff1 - layoff2 (both ≤ 0)
): Reasoning {
  const factor = (key: ReasoningFactor['key'], pointsForP1: number): ReasoningFactor => {
    const e = explica(`tenis.factor.${key}`);
    return { key, label: e.texto, pointsForP1, explicacion: sinTexto(e) };
  };
  const factors: ReasoningFactor[] = [
    factor('rating', round1(ratingGap)),
    factor('form', round1(formGap)),
    factor('h2h', round1(h2hGap)),
    factor('layoff', round1(layoffGap)),
  ];
  const ranked = [...factors].sort((a, b) => Math.abs(b.pointsForP1) - Math.abs(a.pointsForP1));
  const top = ranked[0];
  const totalGap = ratingGap + formGap + h2hGap + layoffGap;
  const favored = totalGap >= 0 ? p1Name : p2Name;

  let lectura: ExplicacionConTexto;
  if (!top || Math.abs(top.pointsForP1) < 1) {
    lectura = explica('tenis.lectura.igualados');
  } else {
    const driverName = top.pointsForP1 >= 0 ? p1Name : p2Name;
    // La señal, dentro de la frase y en minúscula («su ventaja en forma reciente»).
    const enFrase = frases([explica(`tenis.factorEnFrase.${top.key}`)], 'coma');
    lectura =
      driverName === favored
        ? explica('tenis.lectura.favorece', { fav: txt(favored), factor: enFrase })
        : explica('tenis.lectura.matiza', { fav: txt(favored), factor: enFrase, otro: txt(driverName) });
  }
  return { factors, topFactor: top ?? null, text: lectura.texto, explicaciones: [sinTexto(lectura)] };
}

/** Rough scoreline estimate from the win probability. Honest: it's a heuristic. */
function estimateScoreline(prob1: number, bestOf: number | null): ExpectedScore {
  const favoredSide: 1 | 2 | null = prob1 === 0.5 ? null : prob1 > 0.5 ? 1 : 2;
  const pWin = Math.max(prob1, 1 - prob1);
  const setsToWin = bestOf === 5 ? 3 : 2;
  let likelySets: string;
  let note: string;
  if (pWin >= 0.75) {
    likelySets = `${setsToWin}-0`;
    note = 'Probablemente en sets corridos.';
  } else if (pWin >= 0.6) {
    likelySets = `${setsToWin}-1`;
    note = 'Favorito, pero puede ceder un set.';
  } else {
    likelySets = `${setsToWin}-${setsToWin - 1}`;
    note = 'Muy parejo: puede irse a set decisivo.';
  }
  return { favoredSide, likelySets, note };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}



/**
 * Write the "what's most likely to happen" summary in plain Spanish. Everything
 * here restates numbers already computed above — no new modelling — so the text
 * can never disagree with the figures shown next to it. Uncertainty is stated
 * explicitly (a coin-flip is described as such, not dressed up as a pick).
 */
function buildSummary(args: {
  p1: string;
  p2: string;
  prob1: number;
  confidence: ConfidenceTier;
  surface: string;
  eff1: EffectiveRating;
  eff2: EffectiveRating;
  form1: FormSignal;
  form2: FormSignal;
  h2h: H2HSignal;
  serve1: ServeStats;
  serve2: ServeStats;
  rec1: SurfaceRecord;
  rec2: SurfaceRecord;
  market: MarketComparison;
  scorelines: ScorelineDistribution;
  fitness: { p1: FitnessSignals; p2: FitnessSignals };
  tournamentHistory: { p1: TournamentHistory; p2: TournamentHistory } | null;
  reliability: Reliability;
}): MatchSummary {
  const { p1, p2, prob1, confidence, h2h, market } = args;
  const favIsP1 = prob1 >= 0.5;
  const fav = favIsP1 ? p1 : p2;
  const dog = favIsP1 ? p2 : p1;
  // One decimal everywhere, matching what the UI displays, so the prose and the
  // big numbers never show different figures for the same quantity.
  const favProb = porc(Math.max(prob1, 1 - prob1));
  const dogProb = porc(Math.min(prob1, 1 - prob1));
  // La superficie, como pieza de la frase en cada idioma; una desconocida, tal cual la trae el dato.
  const clave = args.surface.toLowerCase();
  const superficie =
    clave === 'hard' || clave === 'clay' || clave === 'grass' ? frases([explica(`tenis.superficie.${clave}`)], 'coma') : txt(clave);

  // --- Headline ---
  // Most likely single outcome, with its own probability — derived, not guessed.
  const top = args.scorelines.outcomes[0];
  const headline =
    confidence === 'toss_up'
      ? explica('tenis.titular.parejo', { fav: txt(fav), pFav: favProb, pDog: dogProb })
      : explica('tenis.titular', { fav: txt(fav), pFav: favProb, marcador: txt(top.label), lado: txt(top.side === 1 ? p1 : p2), pMarcador: porc(top.probability) });

  const bullets: ExplicacionConTexto[] = [];

  // --- Surface / rating ---
  const favEff = favIsP1 ? args.eff1 : args.eff2;
  const dogEff = favIsP1 ? args.eff2 : args.eff1;
  if (favEff.surface != null && dogEff.surface != null) {
    // Judge "who is better" on the very numbers shown, so the words can't
    // contradict the figures (a 2-point gap is not an advantage).
    const favS = Math.round(favEff.surface);
    const dogS = Math.round(dogEff.surface);
    const leader = favS >= dogS ? fav : dog;
    bullets.push(
      Math.abs(favS - dogS) >= 25
        ? explica('tenis.elo.mejor', { superficie, lider: txt(leader), alto: int(Math.max(favS, dogS)), bajo: int(Math.min(favS, dogS)) })
        : explica('tenis.elo.parejo', { superficie, fav: int(favS), dog: int(dogS) }),
    );
  } else {
    bullets.push(explica('tenis.elo.general', { fav: int(favEff.overall), dog: int(dogEff.overall) }));
  }

  // --- Surface record ---
  const favRec = favIsP1 ? args.rec1 : args.rec2;
  const dogRec = favIsP1 ? args.rec2 : args.rec1;
  if (favRec.wins + favRec.losses >= 5 && dogRec.wins + dogRec.losses >= 5) {
    bullets.push(
      explica('tenis.historialSuperficie', { superficie, fav: txt(fav), favG: int(favRec.wins), favP: int(favRec.losses), dog: txt(dog), dogG: int(dogRec.wins), dogP: int(dogRec.losses) }),
    );
  }

  // --- Form ---
  const favForm = favIsP1 ? args.form1 : args.form2;
  const dogForm = favIsP1 ? args.form2 : args.form1;
  const racha = (f: FormSignal, who: string): ExplicacionConTexto | null =>
    f.streak >= 2
      ? explica('tenis.forma.rachaGana', { quien: txt(who), n: int(f.streak) })
      : f.streak <= -2
        ? explica('tenis.forma.rachaPierde', { quien: txt(who), n: int(-f.streak) })
        : null;
  const rachas = [racha(favForm, fav), racha(dogForm, dog)].filter((x): x is ExplicacionConTexto => x != null);
  if (rachas.length) {
    bullets.push(explica('tenis.forma.rachas', { partes: frases(rachas, 'pyc') }));
  } else {
    bullets.push(explica('tenis.forma.parecida', { pFav: porc(favForm.winRate, 0), pDog: porc(dogForm.winRate, 0) }));
  }

  // --- Head-to-head ---
  if (h2h.total === 0) {
    bullets.push(explica('tenis.h2h.nunca'));
  } else {
    const favWins = favIsP1 ? h2h.p1Wins : h2h.p2Wins;
    const dogWins = favIsP1 ? h2h.p2Wins : h2h.p1Wins;
    const leader = favWins > dogWins ? fav : dog;
    const hi = Math.max(favWins, dogWins);
    const lo = Math.min(favWins, dogWins);
    if (favWins === dogWins) {
      bullets.push(explica('tenis.h2h.igualado', { a: int(hi), b: int(lo), total: int(h2h.total) }));
    } else if (h2h.total <= 2) {
      // One or two meetings is anecdote, not dominance — say it plainly.
      bullets.push(explica('tenis.h2h.pocos', { n: int(h2h.total), lider: txt(leader) }));
    } else {
      bullets.push(
        hi - lo >= 2
          ? explica('tenis.h2h.domina', { lider: txt(leader), a: int(hi), b: int(lo) })
          : explica('tenis.h2h.ajustado', { a: int(hi), b: int(lo), lider: txt(leader) }),
      );
    }
  }

  // --- Serve edge ---
  const favServe = favIsP1 ? args.serve1 : args.serve2;
  const dogServe = favIsP1 ? args.serve2 : args.serve1;
  if (favServe.acePct != null && dogServe.acePct != null) {
    const diff = favServe.acePct - dogServe.acePct;
    if (Math.abs(diff) >= 3) {
      const better = diff > 0 ? fav : dog;
      bullets.push(
        explica('tenis.saque', { mejor: txt(better), alto: exacto(Math.max(favServe.acePct, dogServe.acePct)), bajo: exacto(Math.min(favServe.acePct, dogServe.acePct)) }),
      );
    }
  }

  // --- Scoreline shape: how the match is likely to unfold ---
  bullets.push(
    explica('tenis.sets', { pDecisivo: porc(args.scorelines.decidingSetProbability), pCorridos: porc(args.scorelines.straightSetsProbability) }),
  );

  // --- Tournament history ---
  if (args.tournamentHistory) {
    const th = favIsP1 ? args.tournamentHistory.p1 : args.tournamentHistory.p2;
    const to = favIsP1 ? args.tournamentHistory.p2 : args.tournamentHistory.p1;
    if (th.played > 0 || to.played > 0) {
      const describe = (who: string, h: TournamentHistory): ExplicacionConTexto =>
        h.played === 0
          ? explica('tenis.torneo.nunca', { quien: txt(who) })
          : h.titles > 0
            ? explica('tenis.torneo.titulos', { quien: txt(who), g: int(h.wins), p: int(h.losses), t: int(h.titles) })
            : h.bestRound
              ? explica('tenis.torneo.ronda', { quien: txt(who), g: int(h.wins), p: int(h.losses), ronda: txt(h.bestRound) })
              : explica('tenis.torneo.balance', { quien: txt(who), g: int(h.wins), p: int(h.losses) });
      bullets.push(explica('tenis.torneo', { partes: frases([describe(fav, th), describe(dog, to)], 'pyc') }));
    }
  }

  // --- Physical availability (evidence from results, not a medical claim) ---
  const fitnessNotes: ExplicacionConTexto[] = [];
  for (const [who, f] of [
    [fav, favIsP1 ? args.fitness.p1 : args.fitness.p2],
    [dog, favIsP1 ? args.fitness.p2 : args.fitness.p1],
  ] as [string, FitnessSignals][]) {
    const flags: ExplicacionConTexto[] = [];
    if (f.retirements > 0) flags.push(explica('tenis.fisico.retiros', { n: int(f.retirements) }));
    if (f.walkovers > 0) flags.push(explica('tenis.fisico.wo', { n: int(f.walkovers) }));
    if (f.daysSinceLastMatch != null && f.daysSinceLastMatch > 45) flags.push(explica('tenis.fisico.inactivo', { n: int(f.daysSinceLastMatch) }));
    if (f.matchesLast30Days >= 12) flags.push(explica('tenis.fisico.carga', { n: int(f.matchesLast30Days) }));
    if (flags.length) fitnessNotes.push(explica('tenis.fisico.jugador', { quien: txt(who), senales: frases(flags, 'coma') }));
  }
  if (fitnessNotes.length) {
    bullets.push(explica('tenis.fisico', { partes: frases(fitnessNotes, 'pyc') }));
  }

  // --- Market agreement ---
  if (market.market) {
    const marketFav = favIsP1 ? market.market.implied1 : market.market.implied2;
    const modelFav = Math.max(prob1, 1 - prob1);
    const gapPp = (modelFav - marketFav) * 100; // percentage points
    const pMercado = porc(marketFav);
    if (Math.abs(gapPp) < VALUE_THRESHOLD * 100) {
      bullets.push(explica('tenis.mercado.coincide', { pMercado, fav: txt(fav) }));
    } else if (gapPp > 0) {
      bullets.push(explica('tenis.mercado.optimista', { fav: txt(fav), pModelo: favProb, pMercado }));
    } else {
      bullets.push(explica('tenis.mercado.pesimista', { fav: txt(fav), pMercado, pModelo: favProb, dog: txt(dog) }));
    }
  } else {
    bullets.push(explica('tenis.mercado.sin'));
  }

  // --- How solid is this prediction? (closing caveat, last on purpose) ---
  // Stated as a range rather than a single number when the evidence is thin, so
  // the confidence of the wording matches the confidence of the data.
  const rel = args.reliability;
  if (rel.level !== 'high') {
    const banda = { p: favProb, margen: dec(rel.marginPp, 1) };
    const primero = rel.explicaciones[0];
    bullets.push(
      primero
        ? explica(`tenis.aviso.${rel.level}.motivo`, { ...banda, motivo: { t: 'frases', v: [primero], sep: 'coma' } })
        : explica(`tenis.aviso.${rel.level}`, banda),
    );
  }

  return resumen(headline, bullets);
}


/**
 * Build a full, explainable prediction between two players on a given surface.
 * `market` is optional decimal odds {odds1, odds2} for the same p1/p2 order.
 */
export function buildPrediction(
  tour: TourId,
  p1Id: number,
  p2Id: number,
  surface: string,
  market?: { odds1: number | null; odds2: number | null } | null,
  bestOf = 3,
  tourneyName?: string,
): Prediction {
  const p1 = getPlayer(tour, p1Id);
  const p2 = getPlayer(tour, p2Id);
  const r1 = getRating(tour, p1Id);
  const r2 = getRating(tour, p2Id);

  const eff1 = effectiveRating(r1, surface);
  const eff2 = effectiveRating(r2, surface);

  const form1Results = getRecentForm(tour, p1Id);
  const form2Results = getRecentForm(tour, p2Id);
  const form1 = computeForm(form1Results);
  const form2 = computeForm(form2Results);

  const h2h = computeH2H(getH2HMeetings(tour, p1Id, p2Id), p1Id, p2Id);

  // Layoff: a rating earned before a long absence overstates the player today.
  // The gap is measured against the newest match in the dataset rather than
  // today's date (same choice as getFitnessSignals) so that a stale download is
  // never mistaken for a player who stopped competing — erring toward NOT
  // penalising someone for data we simply don't have yet.
  const fitness = { p1: getFitnessSignals(tour, p1Id), p2: getFitnessSignals(tour, p2Id) };
  const layoff1 = layoffAdjustment(fitness.p1.daysSinceLastMatch);
  const layoff2 = layoffAdjustment(fitness.p2.daysSinceLastMatch);

  // Combine: effective rating + form + head-to-head (h2h.delta favours p1) + layoff.
  const adj1 = eff1.effective + form1.delta + h2h.delta + layoff1;
  const adj2 = eff2.effective + form2.delta - h2h.delta + layoff2;

  // Calibrated (see elo.ts): the raw curve is over-confident on real matches,
  // and by different amounts at best-of-3 vs best-of-5.
  // Round once, then derive the complement, so the two probabilities always sum
  // to exactly 1 at the precision we expose (no 63.2% / 36.9% mismatches).
  const prob1 = round5(calibratedExpectedScore(adj1, adj2, calibrationScaleFor(bestOf)));
  const prob2 = round5(1 - prob1);

  let marketProbs: MarketProbabilities | null = null;
  if (market && market.odds1 && market.odds2) {
    marketProbs = impliedProbabilities(market.odds1, market.odds2);
  }
  const marketComparison = compareToMarket(prob1, marketProbs);

  const favoredSide: 1 | 2 | null = prob1 === 0.5 ? null : prob1 > 0.5 ? 1 : 2;
  const favoredName = favoredSide === 1 ? p1?.name ?? null : favoredSide === 2 ? p2?.name ?? null : null;

  const p1Name = p1?.name ?? `#${p1Id}`;
  const p2Name = p2?.name ?? `#${p2Id}`;
  const reasoning = buildReasoning(
    p1Name,
    p2Name,
    eff1.effective - eff2.effective,
    form1.delta - form2.delta,
    2 * h2h.delta,
    layoff1 - layoff2,
  );

  const confidence = confidenceTier(prob1);
  const expected = estimateScoreline(prob1, bestOf);
  const scorelines = scorelineDistribution(prob1, bestOf);
  const tournamentHistory = tourneyName
    ? {
        p1: getTournamentHistory(tour, p1Id, tourneyName),
        p2: getTournamentHistory(tour, p2Id, tourneyName),
      }
    : null;
  const serve1 = getServeStats(tour, p1Id);
  const serve2 = getServeStats(tour, p2Id);
  const rec1 = getSurfaceRecord(tour, p1Id, surface);
  const rec2 = getSurfaceRecord(tour, p2Id, surface);

  // How trustworthy is the number above? Built from evidence we already have:
  // matches behind each rating, matches on THIS surface, and how stale the
  // player's data is (measured against the dataset, not today).
  const reliability = computeReliability(
    prob1,
    {
      matches: r1.matches_played,
      surfaceMatches: rec1.wins + rec1.losses,
      daysStale: fitness.p1.daysSinceLastMatch,
    },
    {
      matches: r2.matches_played,
      surfaceMatches: rec2.wins + rec2.losses,
      daysStale: fitness.p2.daysSinceLastMatch,
    },
    { p1: p1Name, p2: p2Name },
  );

  const summary = buildSummary({
    p1: p1Name,
    p2: p2Name,
    prob1,
    confidence,
    surface,
    eff1,
    eff2,
    form1,
    form2,
    h2h,
    serve1,
    serve2,
    rec1,
    rec2,
    market: marketComparison,
    scorelines,
    fitness,
    tournamentHistory,
    reliability,
  });

  return {
    tour,
    surface,
    players: {
      p1: { id: p1Id, name: p1Name, country: p1?.country ?? null },
      p2: { id: p2Id, name: p2Name, country: p2?.country ?? null },
    },
    ratings: { p1: eff1, p2: eff2 },
    ranks: { p1: getEloRank(tour, p1Id), p2: getEloRank(tour, p2Id) },
    form: { p1: form1, p2: form2 },
    last5: {
      p1: form1Results.slice(0, 5).map((r) => r.won),
      p2: form2Results.slice(0, 5).map((r) => r.won),
    },
    surfaceRecord: { p1: rec1, p2: rec2 },
    serve: { p1: serve1, p2: serve2 },
    h2h,
    layoff: { p1: round1(layoff1), p2: round1(layoff2) },
    adjustedRatings: { p1: Math.round(adj1 * 10) / 10, p2: Math.round(adj2 * 10) / 10 },
    model: { prob1, prob2 },
    market: marketComparison,
    reasoning,
    expectedScore: expected,
    scorelines,
    fitness,
    tournamentHistory,
    reliability,
    summary,
    verdict: {
      favoredSide,
      favoredName,
      confidence,
      marginPct: Math.round(Math.abs(prob1 - 0.5) * 1000) / 10,
    },
    disclaimer: DISCLAIMER,
  };
}

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}
