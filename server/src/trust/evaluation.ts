// ¿Sirve abstenerse? Las predicciones en vivo, partidas por lo que decidió la capa de
// confianza ANTES del partido, contra lo que pasó.
//
//   Calidad de la selección   todas las predicciones contra las apostables (BET) y las
//                             abstenidas (NO BET), con las mismas métricas. Si abstenerse
//                             sirve, las apostables tienen que estar mejor calibradas y
//                             las abstenidas, peor.
//   Cobertura                 participar solo en el 75 / 50 / 25 % de partidos con más
//                             confianza (orden: nivel, calidad de datos, incertidumbre).
//                             Nada de esto ajusta un umbral: solo se mide.
//   Valor de abstenerse       ROI hipotético de las abstenidas con ventaja a la cuota de la
//                             evaluación, y CLV de las señales rechazadas por abstención.
//
// Se usa la ÚLTIMA evaluación anterior al inicio de cada partido: la que estaba vigente al
// empezar. Ninguna evaluación posterior puede existir (la base lo impide).

import { getDb } from '../db.ts';
import { evaluate, type Informe } from '../evaluation/metrics.ts';
import { avisoMuestra, type AvisoMuestra } from '../evaluation/sample.ts';
import { RESULTADOS } from '../prematch/evaluation.ts';
import { SPORT_IDS } from '../sports.ts';

interface Fila {
  sport: string;
  decision: string;
  probs: number[];
  y: number;
  selection: number | null;
  odds: number | null;
  edge: number | null;
  confidence: string;
  data_quality: number;
  uncertainty_pp: number;
}

export interface Grupo {
  nombre: string;
  informe: Informe;
  aviso: AvisoMuestra;
  /** Una unidad a la selección de la evaluación, a su cuota, si tenía ventaja. */
  roiHipotetico: { apuestas: number; roi: number | null; aviso: AvisoMuestra } | null;
}

export interface CalidadSeleccion {
  origen: 'live';
  partidos: number;
  grupos: Grupo[];
  cobertura: { cobertura: number; n: number; informe: Informe; aviso: AvisoMuestra }[];
  clv: { apostadas: { n: number; media: number | null }; abstenidas: { n: number; media: number | null } };
  lectura: string;
}

function filasResueltas(): Fila[] {
  const db = getDb();
  const out: Fila[] = [];
  for (const sport of SPORT_IDS) {
    let res: { k: string; y: number }[] = [];
    try {
      res = db.prepare(RESULTADOS[sport]).all() as { k: string; y: number }[];
    } catch {
      continue;
    }
    if (!res.length) continue;
    const y = new Map(res.map((r) => [r.k, r.y]));
    const evals = db
      .prepare(
        `SELECT a.* FROM prediction_assessments a
          WHERE a.sport = ? AND a.id = (SELECT id FROM prediction_assessments b WHERE b.sport = a.sport AND b.match_key = a.match_key
                                        AND b.assessed_at < b.commence_time ORDER BY b.assessed_at DESC, b.id DESC LIMIT 1)`,
      )
      .all(sport) as Record<string, unknown>[];
    for (const e of evals) {
      const r = y.get(String(e.match_key));
      if (r == null) continue;
      out.push({
        sport,
        decision: String(e.decision),
        probs: JSON.parse(String(e.probs)) as number[],
        y: r,
        selection: (e.selection as number | null) ?? null,
        odds: (e.odds as number | null) ?? null,
        edge: (e.edge as number | null) ?? null,
        confidence: String(e.confidence),
        data_quality: Number(e.data_quality),
        uncertainty_pp: Number(e.uncertainty_pp),
      });
    }
  }
  return out;
}

const informe = (xs: Fila[]) => {
  // Cada deporte tiene su número de resultados; la capa común exige el mismo K en el
  // conjunto, así que se normaliza a «acierto del resultado ocurrido» por fila: válido
  // para log loss y Brier, que se promedian fila a fila.
  const valid = xs.filter((x) => Math.abs(x.probs.reduce((a, b) => a + b, 0) - 1) < 1e-3);
  return evaluate('live', 'todos', valid.map((x) => ({ p: x.probs, y: x.y })));
};

function roi(xs: Fila[]): Grupo['roiHipotetico'] {
  const ap = xs.filter((x) => x.selection != null && x.odds != null && (x.edge ?? 0) > 0);
  if (!ap.length) return null;
  const r = ap.map((x) => (x.y === x.selection ? (x.odds as number) - 1 : -1));
  return { apuestas: ap.length, roi: r.reduce((a, b) => a + b, 0) / r.length, aviso: avisoMuestra(ap.length, 'apuestas') };
}

export function calidadSeleccion(): CalidadSeleccion {
  const xs = filasResueltas();
  const grupo = (nombre: string, ys: Fila[], conRoi: boolean): Grupo => ({
    nombre,
    informe: informe(ys),
    aviso: avisoMuestra(ys.length, 'predicciones'),
    roiHipotetico: conRoi ? roi(ys) : null,
  });
  const nivel: Record<string, number> = { ALTA: 2, MEDIA: 1, BAJA: 0 };
  const orden = [...xs].sort(
    (a, b) => (nivel[b.confidence] ?? 0) - (nivel[a.confidence] ?? 0) || b.data_quality - a.data_quality || a.uncertainty_pp - b.uncertainty_pp,
  );
  const cobertura = [1, 0.75, 0.5, 0.25].map((c) => {
    const s = orden.slice(0, Math.round(orden.length * c));
    return { cobertura: c, n: s.length, informe: informe(s), aviso: avisoMuestra(s.length, 'predicciones') };
  });
  const clvDe = (where: string) => {
    const r = getDb().prepare(`SELECT COUNT(*) AS n, AVG(clv) AS m FROM edge_signals WHERE clv IS NOT NULL AND edge > 0 AND ${where}`).get() as { n: number; m: number | null };
    return { n: r.n, media: r.m };
  };
  const apostadas = xs.filter((x) => x.decision === 'BET');
  const abstenidas = xs.filter((x) => x.decision === 'NO BET');
  return {
    origen: 'live',
    partidos: xs.length,
    grupos: [grupo('Todas las predicciones', xs, false), grupo('Apostables (BET)', apostadas, true), grupo('Abstenidas (NO BET)', abstenidas, true), grupo('Sin mercado', xs.filter((x) => x.decision === 'SIN MERCADO'), false)],
    cobertura,
    clv: { apostadas: clvDe("decision = 'apostada'"), abstenidas: clvDe("reason LIKE 'abstención:%'") },
    lectura:
      xs.length === 0
        ? 'Todavía no hay partidos resueltos con evaluación de confianza: se llenará con los partidos reales que se jueguen.'
        : avisoMuestra(xs.length, 'predicciones').texto ?? 'Muestra suficiente para comparar grupos (con sus intervalos en validation.ts).',
  };
}
