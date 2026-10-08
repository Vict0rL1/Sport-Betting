// La predicción DENTRO de una repetición, en un solo sitio (Fase 3.1).
//
// El backtest de fútbol y la reconstrucción de «¿Acertó?» (recent/reconstruct.ts) recorrían el
// archivo con la misma función de repetición, pero cada uno calculaba la probabilidad por su
// cuenta: Dixon-Coles si conoce a los dos equipos, Elo si no, y luego la rejilla de marcadores.
// Dos copias de la misma aritmética son dos sitios que pueden divergir sin que nadie lo vea,
// y entonces «lo que el backtest mide» y «lo que la pantalla puntúa» dejan de ser lo mismo. El
// test de al lado comprueba que los dos caminos producen exactamente los mismos números.

import { expectedGoalsDc, type DcParams } from '../football/bayes/dixonColes.ts';
import type { DcWalkForward } from '../football/bayes/walkforward.ts';
import { scoreDistribution, outcomeProbabilities, DIXON_COLES_RHO } from '../football/model.ts';
import { buildDistribution, outcomeProbabilities as resultadosNfl } from '../nfl/model.ts';

export interface PrediccionFutbolReplay {
  /** [local, empate, visitante], renormalizado por si la rejilla truncada suma 0,9999. */
  probs: [number, number, number];
  /** Si salió del Dixon-Coles (conocía a los dos) o del camino de Elo. */
  viaDc: boolean;
  lambda: { home: number; away: number };
  rho: number;
}

/**
 * Lo mismo que hace `predict.ts` en vivo: Dixon-Coles cuando conoce a los dos equipos, y si
 * no, el camino de Elo (`lambda` viene de la repetición, no de una segunda llamada).
 */
export function prediccionFutbolEnReplay(
  dc: DcWalkForward | null,
  match: { match_date: string; home_id: string; away_id: string },
  lambda: { home: number; away: number },
  rhoElo: number = DIXON_COLES_RHO,
): PrediccionFutbolReplay {
  const p: DcParams | null = dc?.paramsFor(match.match_date) ?? null;
  const usable = !!p && p.attack.has(match.home_id) && p.attack.has(match.away_id);
  const lam = usable && p ? expectedGoalsDc(p, match.home_id, match.away_id) : lambda;
  const rho = usable && p ? p.rho : rhoElo;
  const o = outcomeProbabilities(scoreDistribution(lam.home, lam.away, rho));
  const t = o.home + o.draw + o.away;
  return { probs: [o.home / t, o.draw / t, o.away / t], viaDc: usable, lambda: lam, rho };
}

/**
 * NFL: la distribución con números clave y, como el moneyline se anula con empate, la
 * probabilidad a dos salidas.
 */
export function prediccionNflEnReplay(expectedMargin: number, expectedTotal: number): [number, number] {
  const o = resultadosNfl(buildDistribution(expectedMargin, expectedTotal, { marginWeights: true, totalWeights: true }));
  const p = o.home / (o.home + o.away);
  return [p, 1 - p];
}
