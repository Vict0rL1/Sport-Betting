// El historial de una estimación, resumido (D1 de la revisión del PR 17): de dónde partió (la
// original), dónde está (la última), cuánto se movió cada resultado en puntos porcentuales, qué
// versiones del modelo intervinieron y cuál se puntúa (la evaluada, si ya hay). Nada se recalcula:
// son las filas tal como se guardaron; lo que no se puede comparar se deja en null.

export interface EntradaHistorial {
  id: number;
  captured_at: string;
  outcomes: string[];
  probs: number[];
  model_version: string | null;
  papel: 'original' | 'revision' | 'evaluada';
}

export interface FilaResumida extends EntradaHistorial {
  /** Δ en pp respecto a la fila anterior, por resultado; null en la primera o si no son comparables. */
  deltaPp: number[] | null;
  /** La versión del modelo cambió respecto a la fila anterior (y las dos se conocen). */
  cambioDeVersion: boolean;
}

export interface ResumenHistorial {
  original: EntradaHistorial;
  ultima: EntradaHistorial;
  /** Δ de la última respecto a la original, en pp; null si no son comparables. */
  deltaPp: number[] | null;
  filas: FilaResumida[];
  /** Las versiones en el orden en que aparecen (null = no consta). */
  versiones: (string | null)[];
  evaluada: EntradaHistorial | null;
  /** ¿El favorito de la última es otro que el de la original? */
  favoritoCambia: boolean;
}

const comparables = (a: EntradaHistorial, b: EntradaHistorial) => a.probs.length === b.probs.length && a.outcomes.length === b.outcomes.length && a.outcomes.every((o, i) => o === b.outcomes[i]);
const delta = (a: EntradaHistorial, b: EntradaHistorial) => (comparables(a, b) ? b.probs.map((p, i) => (p - a.probs[i]) * 100) : null);
const favorito = (ps: number[]) => ps.reduce((m, p, i) => (p > ps[m] ? i : m), 0);

export function resumirHistorial(xs: readonly EntradaHistorial[]): ResumenHistorial | null {
  if (xs.length === 0) return null;
  const filas: FilaResumida[] = xs.map((x, i) => {
    const prev = i > 0 ? xs[i - 1] : null;
    return {
      ...x,
      deltaPp: prev ? delta(prev, x) : null,
      cambioDeVersion: prev != null && prev.model_version != null && x.model_version != null && prev.model_version !== x.model_version,
    };
  });
  const original = xs[0];
  const ultima = xs[xs.length - 1];
  const versiones: (string | null)[] = [];
  for (const x of xs) if (!versiones.includes(x.model_version)) versiones.push(x.model_version);
  return {
    original,
    ultima,
    deltaPp: delta(original, ultima),
    filas,
    versiones,
    evaluada: xs.find((x) => x.papel === 'evaluada') ?? null,
    favoritoCambia: comparables(original, ultima) && favorito(original.probs) !== favorito(ultima.probs),
  };
}
