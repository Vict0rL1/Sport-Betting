// Generador determinista (mulberry32). Una simulación con la misma semilla da el mismo
// resultado: así el test lo puede comprobar y dos lecturas del mismo día dicen lo mismo.
export function rng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Elige un índice según las probabilidades (que suman 1). */
export function elegir(ps: number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < ps.length; i++) {
    acc += ps[i];
    if (u < acc) return i;
  }
  return ps.length - 1;
}

export const SEMILLA_POR_DEFECTO = 20260101;
