// El núcleo de «Lo que el modelo destacaría» (lib/picks.ts): el tipo, los umbrales, quitar el
// margen, convertir candidatas en picks y ordenarlas. Partido de picks.ts en la Fase 7.
import { BASE_RATE, BASE_RATE_TIER2, TIER2 } from './picksDatos';

/** One suggested market on one match. */
export interface Pick {
  /** Match id, so the UI can point back at the card. */
  id: string;
  /** ISO kick-off. */
  when: string;
  /** "Toluca vs Necaxa" */
  match: string;
  /**
   * La liga, cuando el deporte la tiene. Solo la usa `lift`, para elegir la tabla de
   * referencia del escalón correcto; los deportes sin escalones la dejan sin poner.
   */
  league?: string;
  /** "Total de goles", "Doble oportunidad", "Ganador"… */
  market: string;
  /** The selection: "Over 2.5", "Toluca o empate", "Ambos marcan: Sí". */
  selection: string;
  /** What the model gives it. */
  modelProb: number;
  /** The bookmaker's probability with the margin removed. Null = no price. */
  marketProb: number | null;
  /** Decimal odds offered, when known. */
  odds: number | null;
  /** modelProb − marketProb. Null when there is no market. */
  edge: number | null;
  /**
   * Decimal odds at which this selection would be a break-even bet according to
   * the model — 1/modelProb.
   *
   * The most useful single number here and the one no bookmaker shows you: if the
   * offered odds are ABOVE this, the model thinks the price is generous. It also
   * makes the comparison concrete in the unit the slip is priced in.
   */
  fairOdds: number;
}

/**
 * Below this, a disagreement is noise.
 *
 * Both models and de-vigged prices are estimates; two estimates of the same
 * quantity differ by a couple of points routinely. 4 pp is wide enough that the
 * list stays short and every row on it is worth reading — the failure mode to
 * avoid is twenty rows of +0.6 pp, which trains the reader to ignore the panel.
 */
export const MIN_EDGE = 0.04;

/**
 * Rows shown at once.
 *
 * Was 6. Raised because six is thin on a full Saturday — the football tab can have
 * sixty fixtures across ten leagues and was showing six lines about them.
 *
 * It is raised and NOT the per-match cap, which stays at one. Two suggestions from
 * the same match are two ways of saying the same forecast, and filling a longer list
 * with them would make it look like more information while adding none. Ten rows
 * from ten different matches is more; ten rows from four matches is not.
 */
export const MAX_PICKS = 10;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
/**
 * A two-way market's probabilities with the bookmaker's margin removed.
 *
 * 1/odds sums to more than 1 — that excess IS the margin — so the pair is
 * normalised. Skipping this step makes every model look like it has found value,
 * because it would be compared against prices deliberately shaded against it.
 */
/**
 * Is this row's price an independent opinion, or our own model wearing a margin?
 *
 * `source: 'fixture'` means the app generated the odds from the model itself
 * because there was no API key. Comparing against those is circular, so they are
 * treated as absent.
 */
export function realMarket(source: string | undefined): boolean {
  return source !== 'fixture';
}

/**
 * Quita el margen de la casa de un mercado de DOS salidas.
 *
 * Exportada para que `slate.ts` use exactamente la misma aritmética: si la tabla de
 * partidos y la de mercados quitaran el margen de formas distintas, enseñarían dos
 * probabilidades de mercado diferentes para el mismo partido en la misma pantalla.
 */
export function devig2(oddsA: number, oddsB: number): [number, number] {
  const a = 1 / oddsA;
  const b = 1 / oddsB;
  const s = a + b;
  return [a / s, b / s];
}

export function devig3(o1: number, oX: number, o2: number): [number, number, number] {
  const a = 1 / o1;
  const b = 1 / oX;
  const c = 1 / o2;
  const s = a + b + c;
  return [a / s, b / s, c / s];
}

export interface Candidate {
  market: string;
  selection: string;
  modelProb: number;
  marketProb: number | null;
  odds: number | null;
}

export function toPicks(
  id: string,
  when: string,
  match: string,
  candidates: Candidate[],
  league?: string,
): Pick[] {
  return candidates
    // A market at 0 or 1 is not a market — it is a rounding artefact or a bug, and
    // 1/0 would print Infinity as "fair odds".
    .filter((c) => c.modelProb > 0.02 && c.modelProb < 0.98)
    .map((c) => ({
      id,
      when,
      match,
      league,
      market: c.market,
      selection: c.selection,
      modelProb: c.modelProb,
      marketProb: c.marketProb,
      odds: c.odds,
      edge: c.marketProb == null ? null : c.modelProb - c.marketProb,
      fairOdds: 1 / c.modelProb,
    }));
}

/** At most one row per match: six rows about one game is a card, not a shortlist. */
export const MAX_PER_MATCH = 1;

/**
 * How many rows one market may fill.
 *
 * Without a cap the list degenerates. Double chance is P(1)+P(X) — structurally
 * around 75 % in almost every fixture — so a ranking by probability filled all six
 * rows with double chances: six near-identical numbers on six different games, a
 * list whose rows differ only in the team name.
 *
 * But a FIXED cap is wrong in the other direction. Tennis produces exactly one
 * market, the winner, so a cap of two left that tab with two rows and four empty
 * slots — punishing the sport for having less to say instead of just saying it. So
 * the cap is derived from how many markets there actually are.
 */
export function marketCap(distinctMarkets: number): number {
  return Math.max(2, Math.ceil(MAX_PICKS / Math.max(1, distinctMarkets)));
}

/**
 * How often each market comes true ON AVERAGE, measured over this repo's own archives.
 *
 * WHY THIS EXISTS. Without prices the list is ordered by the model's probability, and
 * that quietly ranks MARKETS instead of opinions: "doble oportunidad" is structurally
 * around 69 %, so it beat every straight winner pick and the football tab opened with
 * three double-chance rows and not one answer to "who wins". The model was not being
 * more confident about them — that market simply starts higher.
 *
 * So the confidence ordering uses the LIFT over the base rate: how much the model is
 * actually saying beyond what the market says on its own. Arsenal at 70.6 % is +27.3
 * over the 43.3 % a home side wins; a double chance at 88.7 % is +20.1 over 68.6 %.
 * The winner pick is the stronger claim and now sorts first.
 *
 * Measured 2026-08 over: fútbol 21.769 partidos, baloncesto (desde 2015) 46.6k,
 * béisbol 37.262, NFL 7.276. A market with no entry falls back to 0.5, which for a
 * two-way market is exactly right and for anything else is the conservative choice.
 */
// ---------------------------------------------------------------------------
// MEDIDAS SOBRE EL ARCHIVO, no constantes de manual. Remedidas sobre 30.321
// partidos tras completar las segundas divisiones.
//
// Y SEPARADAS POR ESCALÓN, porque los dos no juegan al mismo fútbol:
//
//                        1ª (17.880)   2ª (12.441)
//     gana el local         43.5 %        42.7 %
//     1X                    68.5 %        71.2 %
//     ambos marcan          53.8 %        51.1 %
//     más de 2.5 goles      53.0 %        46.3 %
//
// Seis puntos y medio en el over: en Segunda se marca bastante menos. Antes había
// una sola cifra global (50.3 %) para las dos, así que un «Over 2.5» de Segunda se
// comparaba contra una referencia inflada por la Primera y subía en la lista sin
// merecerlo, mientras que uno de Primera se comparaba contra una rebajada por la
// Segunda y bajaba. Con una lista de diez filas, eso decide qué se lee.
//
// Esto solo ORDENA; no se publica ninguna de estas cifras como probabilidad.
// ---------------------------------------------------------------------------

/** How much the model is saying beyond the market's own base rate. */
export function lift(p: Pick): number {
  const table = p.league && TIER2.has(p.league) ? BASE_RATE_TIER2 : BASE_RATE;
  return p.modelProb - (table[p.market] ?? BASE_RATE[p.market] ?? 0.5);
}

/**
 * Rank, diversify and trim.
 *
 * Two regimes, and the caller is told which one it got. With prices, order by
 * edge and drop anything under the threshold. Without, order by the model's own
 * confidence — a weaker basis, so it is never mixed with the other: a list that
 * silently blends "the market disagrees" with "the model is sure" is two different
 * claims wearing one hat.
 *
 * Then the caps above, applied greedily down the sorted list, so the strongest row
 * always survives and the diversity comes out of the weaker ones.
 */
export function rankPicks(
  all: Pick[],
  now: number = Date.now(),
  opts: {
    /**
     * Force ranking by the model's own probability even when market prices exist.
     *
     * The NFL passes this, and it is not a preference — it is the measurement. On
     * that sport the closing line is a BETTER forecast than the model (Brier 0.2115
     * against 0.2180 over 7,276 games; the model wins no walk-forward cut and no
     * regime). Ranking by edge means ranking by "how far the model is from a more
     * accurate number", which puts the model's worst disagreements at the top of a
     * list headed "what the model sees as most likely". The market column is still
     * shown — the reader should see both — it just does not drive the order.
     */
    basis?: 'confidence';
  } = {},
): { picks: Pick[]; basis: 'edge' | 'confidence'; considered: number } {
  // A match that has already kicked off is not a suggestion. The schedule keeps
  // today's games on screen all day on purpose (see server/freshness.ts), which is
  // right for reading a RESULT and wrong for proposing a bet — the basketball tab
  // was topping this list with a game that had started 59 minutes earlier.
  const upcoming = all.filter((p) => Date.parse(p.when) > now);

  const priced = upcoming.filter((p) => p.edge != null);
  const basis: 'edge' | 'confidence' =
    opts.basis === 'confidence' ? 'confidence' : priced.length > 0 ? 'edge' : 'confidence';
  const sorted =
    basis === 'edge'
      ? priced.filter((p) => (p.edge ?? 0) >= MIN_EDGE).sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0))
      : [...upcoming].sort((a, b) => lift(b) - lift(a));

  const cap = marketCap(new Set(sorted.map((p) => p.market)).size);
  const perMatch = new Map<string, number>();
  const perMarket = new Map<string, number>();
  const picks: Pick[] = [];
  for (const p of sorted) {
    if (picks.length >= MAX_PICKS) break;
    if ((perMatch.get(p.id) ?? 0) >= MAX_PER_MATCH) continue;
    if ((perMarket.get(p.market) ?? 0) >= cap) continue;
    perMatch.set(p.id, (perMatch.get(p.id) ?? 0) + 1);
    perMarket.set(p.market, (perMarket.get(p.market) ?? 0) + 1);
    picks.push(p);
  }
  // `considered` is how many candidates existed BEFORE any filtering. The panel
  // needs it to tell two very different situations apart: "there were matches and
  // the model agreed with every price" — a real finding — and "there were no
  // matches at all", which is not a finding about anything. Without it the WTA tab,
  // which has zero players and zero fixtures, announced that the model did not
  // disagree with the market.
  return { picks, basis, considered: upcoming.length };
}

// ---------------------------------------------------------------------------
// Per-sport adapters
//
// Each takes what its tab already fetched and returns candidate markets. Reading
// from the same objects the cards render means the panel and the card underneath
// it cannot disagree about a number — there is only one source.
// ---------------------------------------------------------------------------
