// Ensembles: combinar componentes que el modelo YA tiene, con validación temporal.
//
// ===========================================================================
// TRES FORMAS DE COMBINAR
// ===========================================================================
//   media ponderada    q = Σ wᵢ·pᵢ, pesos en el simplex (suman 1, ≥ 0).
//   stacking           q ∝ Π pᵢ^βᵢ (pool log-lineal): con dos resultados es una
//                      regresión logística sobre los logits de los componentes.
//   mezcla calibrada   la media ponderada, recalibrada después (Platt / potencia).
//
// ===========================================================================
// CÓMO SE ENTRENA SIN HACER TRAMPA
// ===========================================================================
// Walk-forward por los mismos periodos que evaluation/walkforward.ts: los pesos de cada
// periodo se ajustan con los periodos ANTERIORES y se puntúan en ese periodo. La cifra
// de validación es la suma de esos tramos fuera de muestra. El holdout final no está en
// el flujo (el backtest no lo puntúa). Los pesos que se registran para usar en vivo se
// ajustan con todo el flujo abierto, y el método se elige por su resultado fuera de
// muestra — nunca por el del holdout.
//
// Un ensemble NO sustituye al campeón: corre como sombra (shadow/shadows.ts) y se
// compara con partidos futuros. Cambiarlo es una decisión registrada como experimento.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import { versionsFor } from '../versions.ts';
import { periodoDe, ajustarPlatt, ajustarPotencia, MIN_PASADO, type Juego } from '../evaluation/walkforward.ts';
import type { SportId } from '../sports.ts';
import type { EventoConfianza } from '../trust/types.ts';
import { pairedBootstrap, recordExperiment } from '../experiments/registry.ts';

export type Metodo = 'media ponderada' | 'stacking' | 'mezcla calibrada';
export const METODOS: Metodo[] = ['media ponderada', 'stacking', 'mezcla calibrada'];

interface Obs {
  ps: number[][]; // [componente][resultado]
  y: number;
}

const ll = (q: number[], y: number) => -Math.log(Math.max(q[y], 1e-12));
const norm = (v: number[]) => {
  const s = v.reduce((a, b) => a + b, 0);
  return v.map((x) => x / s);
};

/** Pesos de la media ponderada, por gradiente exponenciado (se quedan en el simplex). */
export function ajustarMedia(xs: Obs[]): number[] {
  const m = xs[0].ps.length;
  let w = new Array(m).fill(1 / m);
  for (let it = 0; it < 200; it++) {
    const g = new Array(m).fill(0);
    for (const x of xs) {
      const q = x.ps[0].map((_, k) => x.ps.reduce((a, p, i) => a + w[i] * p[k], 0));
      for (let i = 0; i < m; i++) g[i] -= x.ps[i][x.y] / Math.max(q[x.y], 1e-12);
    }
    w = norm(w.map((wi, i) => wi * Math.exp((-0.5 * g[i]) / xs.length)));
  }
  return w;
}
export const aplicarMedia = (ps: number[][], w: number[]) => ps[0].map((_, k) => ps.reduce((a, p, i) => a + w[i] * p[k], 0));

/** β del pool log-lineal por descenso de gradiente. */
export function ajustarStacking(xs: Obs[]): number[] {
  const m = xs[0].ps.length;
  let b = new Array(m).fill(1 / m);
  for (let it = 0; it < 400; it++) {
    const g = new Array(m).fill(0);
    for (const x of xs) {
      const q = aplicarStacking(x.ps, b);
      for (let i = 0; i < m; i++) {
        for (let k = 0; k < q.length; k++) g[i] += (q[k] - (k === x.y ? 1 : 0)) * Math.log(Math.max(x.ps[i][k], 1e-12));
      }
    }
    b = b.map((bi, i) => bi - (0.5 * g[i]) / xs.length);
  }
  return b;
}
export const aplicarStacking = (ps: number[][], b: number[]) =>
  norm(ps[0].map((_, k) => Math.exp(ps.reduce((a, p, i) => a + b[i] * Math.log(Math.max(p[k], 1e-12)), 0))));

interface Modelo {
  metodo: Metodo;
  parametros: number[];
  calibracion: number[] | null;
}

function ajustar(metodo: Metodo, xs: Obs[]): Modelo {
  if (metodo === 'stacking') return { metodo, parametros: ajustarStacking(xs), calibracion: null };
  const w = ajustarMedia(xs);
  if (metodo === 'media ponderada') return { metodo, parametros: w, calibracion: null };
  const mezclas = xs.map((x) => ({ p: aplicarMedia(x.ps, w), y: x.y }));
  if (mezclas[0].p.length === 2) {
    const { a, b } = ajustarPlatt(mezclas.map((m) => ({ p: m.p[0], y: m.y === 0 ? 1 : 0 })));
    return { metodo, parametros: w, calibracion: [a, b] };
  }
  return { metodo, parametros: w, calibracion: [ajustarPotencia(mezclas)] };
}

export function aplicar(m: Pick<Modelo, 'metodo' | 'parametros' | 'calibracion'>, ps: number[][]): number[] {
  if (m.metodo === 'stacking') return aplicarStacking(ps, m.parametros);
  const q = aplicarMedia(ps, m.parametros);
  if (!m.calibracion) return q;
  if (q.length === 2) {
    const [a, b] = m.calibracion;
    const z = a + b * Math.log(Math.max(q[0], 1e-9) / Math.max(1 - q[0], 1e-9));
    const r = 1 / (1 + Math.exp(-z));
    return [r, 1 - r];
  }
  return norm(q.map((v) => Math.max(v, 1e-9) ** m.calibracion![0]));
}

export interface EnsembleRegistrado {
  sport: SportId;
  generado: string;
  model_version: string;
  data_version: string;
  /** Componentes, en el orden de los pesos (ids estables: ver shadow/shadows.ts). */
  componentes: string[];
  ventana: string;
  metodos: Record<Metodo, { parametros: number[]; calibracion: number[] | null; validacion: { n: number; logLoss: number; logLossCampeon: number; ic: [number, number]; p: number } }>;
  /** El de mejor log loss FUERA DE MUESTRA. Corre como sombra; no sustituye a nadie. */
  mejor: Metodo;
  nota: string;
}

/**
 * Entrena los tres métodos con walk-forward. `juegos` trae `componentes` (id → probs) y
 * `modelo` (el campeón) en cada partido puntuado; el resto se ignora.
 */
export function entrenarEnsemble(sport: SportId, juegos: (Juego & { componentes?: Record<string, number[]> })[]): EnsembleRegistrado | null {
  const con = juegos.filter((j) => j.modelo && j.componentes && Object.keys(j.componentes).length >= 2);
  if (con.length < 2 * MIN_PASADO) return null;
  const ids = Object.keys(con[0].componentes as Record<string, number[]>).sort();
  const obs = con.map((j) => ({ periodo: periodoDe(sport, j), x: { ps: ids.map((i) => (j.componentes as Record<string, number[]>)[i]), y: j.y } as Obs, campeon: j.modelo as number[] }));
  const periodos = [...new Set(obs.map((o) => o.periodo))];
  const metodos = {} as EnsembleRegistrado['metodos'];
  for (const metodo of METODOS) {
    let n = 0, s = 0, sc = 0;
    const lc: number[] = [];
    const le: number[] = [];
    let pasado: Obs[] = [];
    for (const per of periodos) {
      const xs = obs.filter((o) => o.periodo === per);
      if (pasado.length >= MIN_PASADO) {
        // Para no tardar minutos, el ajuste usa como mucho los 20.000 partidos más recientes.
        const m = ajustar(metodo, pasado.slice(-20_000));
        for (const o of xs) {
          const a = ll(aplicar(m, o.x.ps), o.x.y);
          const c = ll(o.campeon, o.x.y);
          s += a;
          sc += c;
          le.push(a);
          lc.push(c);
          n++;
        }
      }
      pasado = pasado.concat(xs.map((o) => o.x));
    }
    const final = ajustar(metodo, obs.map((o) => o.x).slice(-20_000));
    // Intervalo emparejado (ensemble − campeón, partido a partido) de los tramos fuera de muestra.
    const bs = n ? pairedBootstrap(lc, le, 1000) : { lo: NaN, hi: NaN, p: NaN };
    metodos[metodo] = {
      parametros: final.parametros,
      calibracion: final.calibracion,
      validacion: { n, logLoss: n ? s / n : NaN, logLossCampeon: n ? sc / n : NaN, ic: [bs.lo, bs.hi], p: bs.p },
    };
  }
  const mejor = METODOS.reduce((a, b) => (metodos[b].validacion.logLoss < metodos[a].validacion.logLoss ? b : a));
  const v = versionsFor(sport);
  return {
    sport,
    generado: new Date().toISOString(),
    model_version: v.model_version,
    data_version: v.data_version,
    componentes: ids,
    ventana: `walk-forward por periodos (${periodos.length}); cada periodo con los anteriores; los pesos finales, con todo el flujo abierto (sin holdout)`,
    metodos,
    mejor,
    nota: 'Corre como sombra. No sustituye al campeón: cambiarlo exige un experimento registrado.',
  };
}

export const ENSEMBLES_PATH = path.join(ROOT, 'experiments', 'ensembles.json');

export function leerEnsembles(): Partial<Record<SportId, EnsembleRegistrado>> {
  try {
    return JSON.parse(fs.readFileSync(ENSEMBLES_PATH, 'utf8')) as Partial<Record<SportId, EnsembleRegistrado>>;
  } catch {
    return {};
  }
}

export function guardarEnsemble(r: EnsembleRegistrado): void {
  const todo = { ...leerEnsembles(), [r.sport]: r };
  fs.mkdirSync(path.dirname(ENSEMBLES_PATH), { recursive: true });
  fs.writeFileSync(ENSEMBLES_PATH, JSON.stringify(todo, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v), 2) + '\n');
}

let cache: { t: number; v: ReturnType<typeof leerEnsembles> } | null = null;

/** La predicción del ensemble registrado para un partido en vivo, si tiene sus componentes. */
export function combinarConEnsemble(e: EventoConfianza): { nombre: string; probs: number[] } | null {
  if (!cache || Date.now() - cache.t > 60_000) cache = { t: Date.now(), v: leerEnsembles() };
  const reg = cache.v[e.sport];
  if (!reg) return null;
  const porId = new Map(e.componentes.map((c) => [idEstable(c.nombre), c.probs]));
  const ps = reg.componentes.map((id) => porId.get(id));
  if (ps.some((p) => !p)) return null;
  const m = reg.metodos[reg.mejor];
  return { nombre: `Ensemble (${reg.mejor})`, probs: aplicar({ metodo: reg.mejor, parametros: m.parametros, calibracion: m.calibracion }, ps as number[][]) };
}

/** Mismo id que shadow/shadows.ts (copiado aquí para no crear un ciclo de imports). */
export const idEstable = (nombre: string) =>
  nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Apunta la medición en el registro de experimentos, gane o pierda. El candidato NUNCA se
 * acepta aquí (accepted: false): un ensemble que mejora en validación pasa a sombra, y
 * cambiar de campeón es otra decisión, con muestra en vivo.
 */
export function registrarEnsemble(r: EnsembleRegistrado, n: number): void {
  const v = r.metodos[r.mejor].validacion;
  const delta = v.logLoss - v.logLossCampeon;
  const mejora = v.ic[1] < 0;
  const empeora = v.ic[0] > 0;
  recordExperiment({
    hypothesis: `${r.sport}: un ensemble (${r.mejor}) de ${r.componentes.join(' + ')} mejora el log loss del campeón`,
    dataset: { sport: r.sport, split: 'validation', n },
    features: r.componentes,
    hyperparams: { metodo: r.mejor },
    metric: 'logloss',
    baseline: 'campeón (modelo publicado, mismo flujo)',
    result: { delta, ciLo: v.ic[0], ciHi: v.ic[1], p: v.p, n: v.n },
    verdict: empeora ? 'rejected' : 'inconclusive',
    modelVersion: r.model_version,
    featureChange: `sustituir la probabilidad por la combinación ${r.mejor} de los componentes`,
    trainPeriod: 'ventana creciente: todos los periodos anteriores al evaluado',
    validationPeriod: 'cada periodo del walk-forward, fuera de muestra (sin holdout)',
    metricsBefore: { logLoss: v.logLossCampeon },
    metricsAfter: { logLoss: v.logLoss },
    accepted: false,
    reason: empeora
      ? 'empeora al campeón fuera de muestra'
      : mejora
        ? 'mejora en validación walk-forward; NO se promociona: corre como sombra hasta tener muestra en vivo'
        : 'el intervalo incluye el cero: corre como sombra, sin cambiar nada',
  });
}
