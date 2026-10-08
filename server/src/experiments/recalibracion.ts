// La recalibración como experimento formal (Fase 4.1).
//
// El walk-forward ya mide, periodo a periodo, el modelo publicado contra el mismo modelo
// recalibrado SOLO con el pasado (Platt a dos salidas, potencia a tres). Lo que faltaba era
// la decisión escrita: un bootstrap emparejado sobre las pérdidas por partido, un intervalo, y
// una entrada en el registro de experimentos con el veredicto y su motivo. La promoción exige
// el holdout final, que está cerrado (regla del proyecto: nunca `--unlock`), así que el
// candidato NUNCA se acepta aquí: queda registrado con su cifra y a la espera.

import { pairedBootstrap, readRegistry, recordExperiment, type Experiment } from './registry.ts';
import type { ResultadoWalkForward } from '../evaluation/walkforward.ts';
import type { SportId } from '../sports.ts';

export const MIN_PARES = 1000;

export const NOTA_HOLDOUT = 'la promoción exige medirlo en el holdout final, que sigue cerrado (nunca --unlock): se queda como sombra';

/** Decide y escribe el experimento. Devuelve la entrada, o null si no hay muestra o ya está hoy. */
export function registrarRecalibracion(sport: SportId, wf: ResultadoWalkForward, ahora = new Date()): Experiment | null {
  const pares = wf.pares;
  if (!pares || pares.modelo.length < MIN_PARES) return null;
  const hypothesis = `${sport}: recalibrar con el pasado (${sport === 'football' ? 'potencia' : 'Platt'}) mejora el log loss del campeón`;
  const hoy = ahora.toISOString().slice(0, 10);
  const yaHoy = readRegistry().experiments.some((e) => e.hypothesis === hypothesis && e.date.slice(0, 10) === hoy && e.dataset.n === pares.modelo.length);
  if (yaHoy) return null;
  const bs = pairedBootstrap(pares.modelo, pares.recalibrado);
  const n = pares.modelo.length;
  const mejora = bs.hi < 0;
  const empeora = bs.lo > 0;
  const metricsBefore = { logLoss: pares.modelo.reduce((a, b) => a + b, 0) / n };
  const metricsAfter = { logLoss: pares.recalibrado.reduce((a, b) => a + b, 0) / n };
  return recordExperiment({
    hypothesis,
    dataset: { sport, split: 'validation', n },
    features: ['recalibración ajustada solo con periodos anteriores'],
    hyperparams: { metodo: sport === 'football' ? 'potencia' : 'Platt', minPasado: 300 },
    metric: 'logloss',
    baseline: 'campeón (modelo publicado, mismo flujo)',
    result: { delta: bs.mean, ciLo: bs.lo, ciHi: bs.hi, p: bs.p, n },
    verdict: empeora ? 'rejected' : 'inconclusive',
    modelVersion: wf.model_version,
    featureChange: 'sustituir la probabilidad publicada por la recalibrada con el pasado',
    trainPeriod: 'ventana creciente: todos los periodos anteriores al evaluado',
    validationPeriod: 'cada periodo del walk-forward, fuera de muestra (sin holdout)',
    metricsBefore,
    metricsAfter,
    accepted: false,
    reason: empeora
      ? `empeora al campeón fuera de muestra; ${NOTA_HOLDOUT}`
      : mejora
        ? `mejora fuera de muestra; ${NOTA_HOLDOUT}`
        : `el intervalo no permite decidir; ${NOTA_HOLDOUT}`,
  });
}
