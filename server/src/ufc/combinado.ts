// El segundo intento de la UFC (docs/plans/ufc-combinado.md, registrado antes de calcular).
//
// Una logística SIN término independiente sobre diferencias entre los dos luchadores: simétrica,
// porque dar la vuelta a los dos cambia el signo de todos los rasgos y la probabilidad pasa a ser
// 1 − p. Se ajusta año a año solo con los años anteriores (walk-forward), así que toda predicción
// puntuada es fuera de muestra. Dos candidatos fijados de antemano, la elección solo con el
// entrenamiento, y la prueba de publicación una vez.

import { isFinalHoldout } from '../experiments/holdout.ts';
import { pairedBootstrap } from '../experiments/registry.ts';
import { REFERENCIAS, esEntrenamiento, esValidacion, recorrer, type FichaUfc, type PasoUfc, type PeleaUfc, type RasgosUfc } from './evaluacion.ts';
import { UFC } from './model.ts';

export const CANDIDATOS = {
  'elo+record': ['elo', 'record'],
  'elo+record+ficha': ['elo', 'record', 'edad', 'alcance', 'experiencia'],
} as const satisfies Record<string, readonly (keyof RasgosUfc)[]>;
export type Candidato = keyof typeof CANDIDATOS;

/** Penalización L2, fija (no se ajusta: un grado de libertad menos para elegir). */
export const LAMBDA = 1;

const sigm = (t: number) => 1 / (1 + Math.exp(-t));
const llBin = (p: number, y: 0 | 1) => -Math.log(Math.min(1 - 1e-12, Math.max(1e-12, y === 1 ? p : 1 - p)));
const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);

/** Resuelve A·x = b (A simétrica definida positiva, pocas dimensiones) por eliminación con pivote. */
function resolver(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((fila, i) => fila[n] / fila[i]);
}

/** Logística sin término independiente con penalización L2, por Newton. */
export function ajustarLogistica(X: number[][], y: (0 | 1)[], lambda = LAMBDA, iteraciones = 30): number[] {
  const d = X[0]?.length ?? 0;
  let w = new Array<number>(d).fill(0);
  for (let it = 0; it < iteraciones; it++) {
    const g = w.map((wi) => -lambda * wi);
    const H = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? lambda : 0)));
    for (let n = 0; n < X.length; n++) {
      const x = X[n];
      let t = 0;
      for (let i = 0; i < d; i++) t += w[i] * x[i];
      const p = sigm(t);
      const r = p * (1 - p);
      for (let i = 0; i < d; i++) {
        g[i] += (y[n] - p) * x[i];
        for (let j = 0; j < d; j++) H[i][j] += r * x[i] * x[j];
      }
    }
    const paso = resolver(H, g);
    w = w.map((wi, i) => wi + paso[i]);
    if (Math.max(...paso.map(Math.abs)) < 1e-10) break;
  }
  return w;
}

const fila = (x: PasoUfc, c: Candidato) => CANDIDATOS[c].map((k) => x.rasgos[k]);

/**
 * La probabilidad del candidato para cada pelea puntuable (null en las demás). Las del año Y salen
 * de una logística ajustada con TODAS las peleas decididas de años anteriores, calentamiento
 * incluido; el holdout no entra nunca, ni para ajustar ni para puntuar.
 */
export function walkForward(pasos: PasoUfc[], c: Candidato, lambda = LAMBDA): { p: (number | null)[]; pesos: Map<number, number[]> } {
  const p: (number | null)[] = pasos.map(() => null);
  const pesos = new Map<number, number[]>();
  const anios = [...new Set(pasos.filter((x) => x.puntuable).map((x) => x.anio))].sort((a, b) => a - b);
  for (const anio of anios) {
    const ent = pasos.filter((x) => x.anio < anio && !isFinalHoldout('ufc', x.anio));
    const w = ajustarLogistica(
      ent.map((x) => fila(x, c)),
      ent.map((x) => x.y),
      lambda,
    );
    pesos.set(anio, w);
    pasos.forEach((x, i) => {
      if (x.puntuable && x.anio === anio) p[i] = sigm(fila(x, c).reduce((s, v, k) => s + v * w[k], 0));
    });
  }
  return { p, pesos };
}

type Fuente = 'combinado' | 'elo' | (typeof REFERENCIAS)[number]['clave'];

function perdidasDe(pasos: PasoUfc[], pc: (number | null)[], anios: (a: number) => boolean, f: Fuente): number[] {
  const out: number[] = [];
  pasos.forEach((x, i) => {
    if (!x.puntuable || !anios(x.anio)) return;
    const q = f === 'combinado' ? pc[i]! : f === 'elo' ? x.p : f === 'moneda' ? 0.5 : x.ref[f];
    out.push(llBin(q, x.y));
  });
  return out;
}

export interface TramoPrueba {
  n: number;
  modelo: number;
  referencias: { nombre: string; ll: number; mean: number; lo: number; hi: number; p: number }[];
  /** Contra el Elo solo (el modelo vigente de la sombra). */
  contraElo: { ll: number; mean: number; lo: number; hi: number; p: number };
}

export interface ResultadoCombinado {
  /** Log loss en el entrenamiento (puntuables antes de la validación) de cada candidato: con esto se elige. */
  eleccion: { candidato: Candidato; llEntrenamiento: number }[];
  elegido: Candidato;
  /** Los pesos del último ajuste (el que predice la validación), para leerlos. */
  pesosValidacion: Record<string, number>;
  todo: TramoPrueba;
  validacion: TramoPrueba;
  /** La regla de docs/plans/ufc-combinado.md: gana a las cuatro en los dos tramos, intervalos bajo cero. */
  pasa: boolean;
  /** Y mejora al Elo solo en la validación, intervalo bajo cero: entonces sustituiría al vigente. */
  mejoraAlElo: boolean;
}

export function evaluarCombinado(peleas: PeleaUfc[], fichas: Map<string, FichaUfc>): ResultadoCombinado {
  const { pasos } = recorrer(peleas, UFC, fichas);
  const porCandidato = (Object.keys(CANDIDATOS) as Candidato[]).map((c) => {
    const wf = walkForward(pasos, c);
    return { candidato: c, wf, llEntrenamiento: media(perdidasDe(pasos, wf.p, esEntrenamiento, 'combinado')) };
  });
  // La elección, SOLO con el entrenamiento.
  const elegido = porCandidato.reduce((a, b) => (b.llEntrenamiento < a.llEntrenamiento ? b : a));
  const pc = elegido.wf.p;
  const tramo = (anios: (a: number) => boolean): TramoPrueba => {
    const modelo = perdidasDe(pasos, pc, anios, 'combinado');
    const elo = perdidasDe(pasos, pc, anios, 'elo');
    return {
      n: modelo.length,
      modelo: media(modelo),
      referencias: REFERENCIAS.map((r) => {
        const v = perdidasDe(pasos, pc, anios, r.clave);
        return { nombre: r.nombre, ll: media(v), ...pairedBootstrap(v, modelo) };
      }),
      contraElo: { ll: media(elo), ...pairedBootstrap(elo, modelo) },
    };
  };
  const todo = tramo(() => true);
  const validacion = tramo(esValidacion);
  const anioVal = [...elegido.wf.pesos.keys()].filter(esValidacion)[0];
  const w = anioVal != null ? elegido.wf.pesos.get(anioVal)! : [];
  return {
    eleccion: porCandidato.map((x) => ({ candidato: x.candidato, llEntrenamiento: x.llEntrenamiento })),
    elegido: elegido.candidato,
    pesosValidacion: Object.fromEntries(CANDIDATOS[elegido.candidato].map((k, i) => [k, w[i]])),
    todo,
    validacion,
    pasa: [todo, validacion].every((t) => t.referencias.every((r) => r.hi < 0)),
    mejoraAlElo: validacion.contraElo.hi < 0,
  };
}
