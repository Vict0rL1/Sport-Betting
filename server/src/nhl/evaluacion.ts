// El backtest de la NHL en sombra (Fase 8.1): el Elo recorre los partidos en orden, predice ANTES de
// actualizarse y se puntúa contra dos referencias (siempre el local según su tasa histórica, y un
// Elo básico sin margen ni Poisson). El holdout final (desde la temporada 2025-26) no se puntúa.
// Sin partidos en `nhl_games` no hay nada que evaluar, y se dice.

import { getDb } from '../db.ts';
import { evaluate, logLoss, type Informe, type Prediccion } from '../evaluation/metrics.ts';
import { isFinalHoldout } from '../experiments/holdout.ts';
import { avisoMuestra, type AvisoMuestra } from '../evaluation/sample.ts';
import { NHL, actualizar, esperado, predecir } from './model.ts';
import type { PartidoNhl } from './ingest.ts';

/** Partidos de calentamiento: los primeros, con todos los Elo en 1500, no dicen nada. */
export const CALENTAMIENTO = 300;

export interface EvaluacionNhl {
  partidos: number;
  puntuados: number;
  holdoutExcluido: number;
  modelo: Informe | null;
  referencias: { nombre: string; logLoss: number | null }[];
  porTemporada: { temporada: number; n: number; logLoss: number | null }[];
  aviso: AvisoMuestra;
  nota: string;
}

export function leerPartidos(): PartidoNhl[] {
  return getDb().prepare('SELECT * FROM nhl_games ORDER BY game_date, id').all() as unknown as PartidoNhl[];
}

export function evaluarNhl(partidos: PartidoNhl[] = leerPartidos()): EvaluacionNhl {
  const elo = new Map<string, number>();
  const basico = new Map<string, number>();
  const xs: Prediccion[] = [];
  const refLocal: Prediccion[] = [];
  const refBasico: Prediccion[] = [];
  const porTemp = new Map<number, Prediccion[]>();
  let localGana = 0;
  let vistos = 0;
  let holdoutExcluido = 0;
  for (const g of partidos) {
    const eh = elo.get(g.home_id) ?? NHL.inicial;
    const ea = elo.get(g.away_id) ?? NHL.inicial;
    const y = g.home_goals > g.away_goals ? 0 : 1;
    const enHoldout = isFinalHoldout('nhl', g.season);
    if (enHoldout) holdoutExcluido++;
    if (vistos >= CALENTAMIENTO && !enHoldout) {
      const p = predecir(eh, ea);
      const pred = { p: [p.local, p.visitante], y };
      xs.push(pred);
      (porTemp.get(g.season) ?? porTemp.set(g.season, []).get(g.season)!).push(pred);
      const tasa = localGana / vistos;
      refLocal.push({ p: [tasa, 1 - tasa], y });
      const bh = basico.get(g.home_id) ?? 1500;
      const ba = basico.get(g.away_id) ?? 1500;
      const pb = esperado(bh + NHL.campo - ba);
      refBasico.push({ p: [pb, 1 - pb], y });
    }
    // Actualizar DESPUÉS de predecir (y también en el holdout: el Elo sigue el calendario, solo no se puntúa).
    const [nh, na] = actualizar(eh, ea, g.home_goals, g.away_goals);
    elo.set(g.home_id, nh);
    elo.set(g.away_id, na);
    const bh = basico.get(g.home_id) ?? 1500;
    const ba = basico.get(g.away_id) ?? 1500;
    const eb = esperado(bh + NHL.campo - ba);
    const sb = y === 0 ? 1 : 0;
    basico.set(g.home_id, bh + 20 * (sb - eb));
    basico.set(g.away_id, ba - 20 * (sb - eb));
    if (y === 0) localGana++;
    vistos++;
  }
  const ll = (p: Prediccion[]) => (p.length ? logLoss(p) : null);
  return {
    partidos: partidos.length,
    puntuados: xs.length,
    holdoutExcluido,
    modelo: xs.length ? evaluate('backtest', 'nhl', xs) : null,
    referencias: [
      { nombre: 'Siempre el local (tasa histórica)', logLoss: ll(refLocal) },
      { nombre: 'Elo básico (sin margen ni Poisson)', logLoss: ll(refBasico) },
    ],
    porTemporada: [...porTemp].map(([temporada, p]) => ({ temporada, n: p.length, logLoss: ll(p) })),
    aviso: avisoMuestra(xs.length, 'predicciones'),
    nota:
      partidos.length === 0
        ? 'sin partidos en nhl_games: corre npm run update-data:nhl donde la red alcance api-web.nhle.com.'
        : 'Sombra: parámetros de partida sin ajustar; no se publica nada hasta que esto entre en el registro de experimentos con la misma evidencia que los demás deportes.',
  };
}
