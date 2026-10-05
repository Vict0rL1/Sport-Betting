// Lo que el precio hizo alrededor de una ventaja: cuánto duró, cuánto se perdió por llegar
// tarde y cuánto cambia según la casa. Todo sale de los snapshots por casa (odds/), que
// guardan cada cambio y cada observación; nada se interpola.
//
//   Duración del edge   con la probabilidad del modelo FIJA (la de la señal), en qué
//                       intervalos la cuota de consenso daba una ventaja ≥ umbral: inicio,
//                       fin, duración, máximo y último valor. Un edge de 30 segundos no es
//                       lo mismo que uno que aguanta una tarde.
//   Slippage            detección (mercado cuando el modelo registró su predicción) →
//                       apuesta (cuota registrada) → siguiente observación del mercado.
//                       En este banco la decisión y el registro ocurren en la misma pasada,
//                       así que «decisión» y «registro» coinciden y se dice.
//   Mejor línea         a la hora de apostar: mejor, mediana y peor cuota por casa, y la
//                       ventaja con cada una. El ROI con la mejor cuota es una COTA
//                       SUPERIOR: no siempre se puede apostar en todas las casas.

import { getDb } from '../db.ts';
import { quotesAt, type MarketPoint, marketAt } from './snapshots.ts';
import { DEFAULT_CONFIG } from '../staking/policy.ts';
import { avisoMuestra, type AvisoMuestra } from '../evaluation/sample.ts';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// ---------------------------------------------------------------------------
// DURACIÓN DEL EDGE
// ---------------------------------------------------------------------------

export interface Durabilidad {
  umbral: number;
  /** Intervalos con ventaja ≥ umbral, en orden. `fin` null = seguía al cerrar la observación. */
  intervalos: { inicio: string; fin: string | null; duracionMin: number; maximo: number }[];
  /** La ventaja máxima vista y la última observada antes del inicio. */
  maximo: number | null;
  ultimo: number | null;
  /** Minutos totales con ventaja. */
  totalMin: number;
  observaciones: number;
}

/** Los instantes en que el evento se observó (aunque nada cambiara), hasta `hasta`. */
function observaciones(eventId: string, hasta: string): string[] {
  return (
    getDb()
      .prepare('SELECT observed_at FROM odds_event_observations WHERE event_id = ? AND observed_at < ? ORDER BY observed_at')
      .all(eventId, hasta) as { observed_at: string }[]
  ).map((r) => r.observed_at);
}

export function durabilidad(eventId: string, selection: string, p: number, hasta: string, umbral = DEFAULT_CONFIG.minEdge): Durabilidad {
  const obs = observaciones(eventId, hasta);
  const puntos = obs.map((t) => marketAt(eventId, 'h2h', selection, t)).filter((x): x is MarketPoint => !!x);
  const intervalos: Durabilidad['intervalos'] = [];
  let abierto: { inicio: string; maximo: number } | null = null;
  let maximo: number | null = null;
  let ultimo: number | null = null;
  for (const pt of puntos) {
    const e = p * pt.consensus - 1;
    ultimo = e;
    maximo = maximo == null ? e : Math.max(maximo, e);
    if (e >= umbral) {
      if (!abierto) abierto = { inicio: pt.at, maximo: e };
      else abierto.maximo = Math.max(abierto.maximo, e);
    } else if (abierto) {
      intervalos.push({ inicio: abierto.inicio, fin: pt.at, duracionMin: Math.round((Date.parse(pt.at) - Date.parse(abierto.inicio)) / 60_000), maximo: abierto.maximo });
      abierto = null;
    }
  }
  if (abierto) {
    const finObs = puntos[puntos.length - 1].at;
    intervalos.push({ inicio: abierto.inicio, fin: null, duracionMin: Math.round((Date.parse(finObs) - Date.parse(abierto.inicio)) / 60_000), maximo: abierto.maximo });
  }
  return { umbral, intervalos, maximo, ultimo, totalMin: intervalos.reduce((a, i) => a + i.duracionMin, 0), observaciones: puntos.length };
}

// ---------------------------------------------------------------------------
// SLIPPAGE Y MEJOR LÍNEA, SOBRE LAS APUESTAS DE PAPEL
// ---------------------------------------------------------------------------

export interface FilaSlippage {
  id: number;
  label: string;
  detectada: number | null;
  apostada: number;
  siguiente: number | null;
  /** apostada / detectada − 1 (negativo = se apostó peor de lo que se detectó). */
  slippage: number | null;
  /** siguiente / apostada − 1. */
  despues: number | null;
  /** Ventaja perdida entre detección y apuesta, en pp de EV. */
  edgePerdido: number | null;
  /** A la hora de apostar. */
  mejor: number | null;
  mejorCasa: string | null;
  peor: number | null;
  casas: number;
}

export interface ResumenMercado {
  apuestas: FilaSlippage[];
  slippage: { n: number; mediana: number | null; p90Adverso: number | null; edgePerdidoMedio: number | null; aviso: AvisoMuestra };
  /** ROI de las liquidadas con distintas cuotas, a igual importe y resultado. */
  roiPorLinea: {
    n: number;
    apostada: number | null;
    mejor: number | null;
    peor: number | null;
    unaCasa: { casa: string; n: number; roi: number | null } | null;
    nota: string;
    aviso: AvisoMuestra;
  };
  nota: string;
}

export function resumenMercado(): ResumenMercado {
  const db = getDb();
  const bets = db
    .prepare(
      `SELECT id, label, provider_event_id AS ev, provider_selection AS sel, odds, signal_odds, placed_at, status, stake,
              COALESCE(model_probability_calibrated, p_model) AS p
         FROM paper_bets WHERE provider_event_id IS NOT NULL ORDER BY placed_at`,
    )
    .all() as { id: number; label: string; ev: string; sel: string; odds: number; signal_odds: number | null; placed_at: string; status: string; stake: number; p: number }[];
  const filas: FilaSlippage[] = [];
  const roi: { apostada: number; mejor: number | null; peor: number | null; porCasa: Map<string, number>; gana: boolean }[] = [];
  const conteoCasas = new Map<string, number>();
  for (const b of bets) {
    const siguiente = db
      .prepare('SELECT MIN(observed_at) AS t FROM odds_event_observations WHERE event_id = ? AND observed_at > ?')
      .get(b.ev, b.placed_at) as { t: string | null };
    const sig = siguiente.t ? marketAt(b.ev, 'h2h', b.sel, siguiente.t) : null;
    const qs = quotesAt(b.ev, 'h2h', b.sel, b.placed_at);
    const best = qs.length ? qs.reduce((a, q) => (q.odds > a.odds ? q : a)) : null;
    filas.push({
      id: b.id,
      label: b.label,
      detectada: b.signal_odds,
      apostada: b.odds,
      siguiente: sig?.consensus ?? null,
      slippage: b.signal_odds ? b.odds / b.signal_odds - 1 : null,
      despues: sig ? sig.consensus / b.odds - 1 : null,
      edgePerdido: b.signal_odds ? (b.p * b.signal_odds - 1 - (b.p * b.odds - 1)) * 100 : null,
      mejor: best?.odds ?? null,
      mejorCasa: best?.bookmaker ?? null,
      peor: qs.length ? Math.min(...qs.map((q) => q.odds)) : null,
      casas: qs.length,
    });
    for (const q of qs) conteoCasas.set(q.bookmaker, (conteoCasas.get(q.bookmaker) ?? 0) + 1);
    if (b.status === 'won' || b.status === 'lost') {
      roi.push({ apostada: b.odds, mejor: best?.odds ?? null, peor: qs.length ? Math.min(...qs.map((q) => q.odds)) : null, porCasa: new Map(qs.map((q) => [q.bookmaker, q.odds])), gana: b.status === 'won' });
    }
  }
  const sl = filas.map((f) => f.slippage).filter((x): x is number => x != null);
  const ep = filas.map((f) => f.edgePerdido).filter((x): x is number => x != null);
  const roiCon = (cuota: (r: (typeof roi)[number]) => number | null) => {
    const xs = roi.map((r) => ({ c: cuota(r), g: r.gana })).filter((x): x is { c: number; g: boolean } => x.c != null);
    return xs.length ? xs.reduce((a, x) => a + (x.g ? x.c - 1 : -1), 0) / xs.length : null;
  };
  // «Una sola casa»: la que más cotiza de todas, como si solo se tuviera cuenta allí.
  const casa = [...conteoCasas].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const enCasa = casa ? roi.filter((r) => r.porCasa.has(casa)) : [];
  return {
    apuestas: filas,
    slippage: {
      n: sl.length,
      mediana: sl.length ? median(sl) : null,
      p90Adverso: sl.length ? pct(sl, 0.1) : null,
      edgePerdidoMedio: ep.length ? ep.reduce((a, b) => a + b, 0) / ep.length : null,
      aviso: avisoMuestra(sl.length, 'apuestas'),
    },
    roiPorLinea: {
      n: roi.length,
      apostada: roiCon((r) => r.apostada),
      mejor: roiCon((r) => r.mejor),
      peor: roiCon((r) => r.peor),
      unaCasa: casa ? { casa, n: enCasa.length, roi: enCasa.length ? enCasa.reduce((a, r) => a + (r.gana ? (r.porCasa.get(casa) as number) - 1 : -1), 0) / enCasa.length : null } : null,
      nota:
        'Mismas apuestas, mismo resultado, distinta cuota. «Mejor» es una cota superior (exige cuenta en todas las casas y que acepten la apuesta); ' +
        '«una casa» simula tener cuenta solo en la que más cotiza.',
      aviso: avisoMuestra(roi.length, 'apuestas'),
    },
    nota: 'Detección = mercado cuando el modelo registró su predicción; decisión y registro ocurren en la misma pasada del banco y coinciden.',
  };
}
