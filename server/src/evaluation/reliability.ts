// Diagramas de fiabilidad (Fase 4.3): cubetas de probabilidad predicha → frecuencia observada.
//
// Una por deporte y por origen, sin mezclarlos nunca: el backtest (lo guarda `informeComun`
// en experiments/reliability.json al correr el backtest de referencia) y lo vivo (las
// predicciones puntuadas del registro). Cada cubeta lleva su recuento: una frecuencia
// observada de 3 partidos no es una frecuencia, es anécdota, y la pantalla lo dice.
//
// Se cuenta CADA probabilidad dicha (todas las salidas de cada partido), la misma
// definición que el ECE de evaluation/metrics.ts: así las dos cifras hablan de lo mismo.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import type { Prediccion } from './metrics.ts';
import { predicciones } from './live.ts';
import { avisoMuestra, type AvisoMuestra } from './sample.ts';
import { versionsFor } from '../versions.ts';
import type { SportId } from '../sports.ts';

export const RELIABILITY_PATH = path.join(ROOT, 'experiments', 'reliability.json');
/** Cubetas de 10 puntos: 0–10 %, 10–20 %, …, 90–100 %. */
export const CUBETAS = 10;

export interface Cubeta {
  /** Límites de la cubeta, en probabilidad [desde, hasta). */
  desde: number;
  hasta: number;
  /** Probabilidades dichas que cayeron aquí. */
  n: number;
  /** Media de lo dicho y frecuencia de lo que pasó. */
  predicha: number | null;
  observada: number | null;
}

export interface Diagrama {
  origen: 'backtest' | 'live';
  deporte: SportId;
  /** Predicciones (partidos) de las que salen las cubetas; `n` de cada cubeta cuenta salidas. */
  partidos: number;
  cubetas: Cubeta[];
  /** Σ (n/N) · |predicha − observada|: el mismo ECE que la capa común. */
  ece: number | null;
  aviso: AvisoMuestra;
  generado: string;
  model_version: string | null;
}

/** Las cubetas de un conjunto de predicciones. Vacío → cubetas a cero, no a NaN. */
export function diagrama(origen: Diagrama['origen'], deporte: SportId, xs: Prediccion[], cubetas = CUBETAS): Diagrama {
  const acc = Array.from({ length: cubetas }, () => ({ n: 0, p: 0, y: 0 }));
  let total = 0;
  for (const x of xs) {
    x.p.forEach((pk, k) => {
      const i = Math.min(cubetas - 1, Math.max(0, Math.floor(pk * cubetas)));
      acc[i].n++;
      acc[i].p += pk;
      acc[i].y += k === x.y ? 1 : 0;
      total++;
    });
  }
  const out: Cubeta[] = acc.map((c, i) => ({
    desde: i / cubetas,
    hasta: (i + 1) / cubetas,
    n: c.n,
    predicha: c.n ? c.p / c.n : null,
    observada: c.n ? c.y / c.n : null,
  }));
  const ece = total ? out.reduce((a, c) => (c.n ? a + (c.n / total) * Math.abs((c.predicha as number) - (c.observada as number)) : a), 0) : null;
  return {
    origen,
    deporte,
    partidos: xs.length,
    cubetas: out,
    ece,
    aviso: avisoMuestra(xs.length, 'predicciones'),
    generado: new Date().toISOString(),
    model_version: null,
  };
}

export type Diagramas = Partial<Record<SportId, Diagrama>>;

export function leerDiagramasBacktest(): Diagramas {
  try {
    return JSON.parse(fs.readFileSync(RELIABILITY_PATH, 'utf8')) as Diagramas;
  } catch {
    return {};
  }
}

/** Lo llama `informeComun` en la corrida de referencia de cada backtest. */
export function guardarDiagramaBacktest(deporte: SportId, xs: Prediccion[]): Diagrama {
  const d = { ...diagrama('backtest', deporte, xs), model_version: versionsFor(deporte).model_version };
  const todo = { ...leerDiagramasBacktest(), [deporte]: d };
  const ordenado = Object.fromEntries(Object.keys(todo).sort().map((k) => [k, todo[k as SportId]]));
  fs.mkdirSync(path.dirname(RELIABILITY_PATH), { recursive: true });
  fs.writeFileSync(RELIABILITY_PATH, JSON.stringify(ordenado, null, 2) + '\n');
  return d;
}

/** El diagrama en vivo de un deporte, de sus predicciones ya puntuadas. */
export function diagramaEnVivo(deporte: SportId): Diagrama {
  const xs = predicciones(deporte);
  return diagrama('live', deporte, xs);
}

export function fiabilidad(deporte: SportId): { backtest: Diagrama | null; live: Diagrama } {
  return { backtest: leerDiagramasBacktest()[deporte] ?? null, live: diagramaEnVivo(deporte) };
}
