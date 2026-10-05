// Deriva reciente: ¿el modelo está acertando EN VIVO peor de lo que su backtest promete?
//
// Las últimas VENTANA predicciones resueltas, su log loss medio contra el del backtest de
// referencia (experiments/backtest_metrics.json). Se declara deriva solo si es peor por
// más de dos errores típicos: con 100 partidos, el log loss de un modelo sano se mueve
// ±0,02 por azar, y llamar «deriva» a eso sería cambiar de opinión con cada racha.
// No abstiene: recorta el importe (ver trust/decision.ts).

import { predicciones } from '../evaluation/live.ts';
import { leerMetricasBacktest } from '../evaluation/report.ts';
import type { SportId } from '../sports.ts';

export const VENTANA = 100;

export interface Deriva {
  sport: SportId;
  n: number;
  logLossReciente: number | null;
  logLossBacktest: number | null;
  errorTipico: number | null;
  deriva: boolean;
  texto: string;
}

export function derivaReciente(sport: SportId): Deriva {
  const base = leerMetricasBacktest()[sport]?.logLoss ?? null;
  let xs: { p: number[]; y: number }[] = [];
  try {
    xs = predicciones(sport).slice(-VENTANA);
  } catch {
    xs = [];
  }
  const ll = xs.map((x) => -Math.log(Math.max(x.p[x.y], 1e-15)));
  const n = ll.length;
  if (n < VENTANA || base == null) {
    return { sport, n, logLossReciente: null, logLossBacktest: base, errorTipico: null, deriva: false, texto: `sin muestra para medir deriva (${n} de ${VENTANA} predicciones en vivo resueltas)` };
  }
  const m = ll.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(ll.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const deriva = m - base > 2 * se;
  return {
    sport, n, logLossReciente: m, logLossBacktest: base, errorTipico: se, deriva,
    texto: deriva
      ? `log loss de las últimas ${n} en vivo ${m.toFixed(3)} contra ${base.toFixed(3)} del backtest (más de 2 errores típicos peor)`
      : `sin deriva: ${m.toFixed(3)} en vivo contra ${base.toFixed(3)} del backtest`,
  };
}
