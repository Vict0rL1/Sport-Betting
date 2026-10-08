// Incertidumbre, estabilidad, sensibilidad y desacuerdo: lo que se puede decir de una
// probabilidad moviendo sus entradas dentro de lo plausible.
//
// ===========================================================================
// EL ENLACE: CÓMO SE TRADUCE UN PUNTO DE FACTOR EN PROBABILIDAD
// ===========================================================================
// Los cinco modelos exponen sus factores en una escala aditiva (puntos Elo; en la NFL,
// puntos de margen). Cerca del partido que se mira, el logit de la probabilidad del
// resultado 0 se mueve `pendiente` por cada punto:
//
//     logit p'(Δ) = logit p + pendiente · Δ
//
// En tenis y NBA esto es EXACTO: sus probabilidades son curvas logísticas en Elo. En el
// fútbol (Dixon-Coles), el béisbol (carreras) y la NFL (distribución de márgenes) es una
// APROXIMACIÓN LOCAL, y cada resultado lo dice (`pendienteExacta`). En tres resultados
// se mueve el cociente local/visitante y el empate se mantiene: otra aproximación, dicha.
//
// ===========================================================================
// TRES PREGUNTAS DISTINTAS, TRES RESPUESTAS
// ===========================================================================
//   Incertidumbre   ¿cuánto puede estar mal el número por la poca evidencia detrás de
//                   los ratings? La banda de fiabilidad de la app (±1σ de ruido de
//                   rating, propagado en primer orden) y, aparte, el error histórico
//                   de calibración del tramo de probabilidad. NO es un intervalo de
//                   confianza del 95 %: con supuestos normales cubriría ~68 %.
//   Estabilidad     ¿cuánto depende el número de los supuestos? Cada factor que no es
//                   el rating se mueve dentro de su rango plausible: escenarios uno a
//                   uno y una simulación conjunta (semilla fija, reproducible).
//   Sensibilidad    ¿qué lo mueve? Valores de Shapley de los factores sobre la curva
//                   no lineal: suman exactamente la distancia entre la base neutral y
//                   la probabilidad final, sin depender del orden.

import type { EventoConfianza } from './types.ts';

const logit = (p: number) => Math.log(Math.max(p, 1e-9) / Math.max(1 - p, 1e-9));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));

/** Generador determinista: mismas entradas, mismas simulaciones. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Normal estándar por Box-Muller con el generador dado. */
function normal(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Una semilla estable por partido. */
export function semillaDe(clave: string): number {
  let h = 2166136261;
  for (let i = 0; i < clave.length; i++) h = Math.imul(h ^ clave.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * La probabilidad de cada resultado si los factores se mueven Δ puntos (a favor del 0).
 * Dos resultados: logística. Tres: se mueve local/visitante y el empate queda.
 */
export function mover(e: Pick<EventoConfianza, 'probs' | 'pendiente'>, delta: number): number[] {
  if (e.probs.length === 2) {
    const q = sigm(logit(e.probs[0]) + e.pendiente * delta);
    return [q, 1 - q];
  }
  const [h, d, a] = e.probs;
  const resto = h + a;
  const q = sigm(logit(h / resto) + e.pendiente * delta);
  return [resto * q, d, resto * (1 - q)];
}

// ---------------------------------------------------------------------------
// INCERTIDUMBRE
// ---------------------------------------------------------------------------

export interface Incertidumbre {
  /** ±pp sobre el resultado más probable: ruido de rating (la banda de fiabilidad). */
  ruidoRatingPp: number;
  /** Sesgo histórico del tramo de probabilidad (observado − predicho), en pp, si se midió. */
  sesgoCalibracionPp: number | null;
  /** Partidos del tramo en el backtest. */
  nTramo: number | null;
  /** Combinación de las dos: √(ruido² + sesgo²). */
  totalPp: number;
  rango: { bajo: number; alto: number };
  /** Qué representa el rango, con palabras. */
  significado: string;
}

/** Una banda de calibración del backtest: [desde, desde+0,1) del favorito. */
export interface BandaCalibracion {
  desde: number;
  n: number;
  acierto: number;
  media: number;
}

export function incertidumbre(e: EventoConfianza, bandas: BandaCalibracion[] | null): Incertidumbre {
  const top = Math.max(...e.probs);
  const ruido = e.fiabilidad.margenPp;
  // El tramo exacto [desde, desde+0,1): las bandas guardadas son acumuladas («≥ desde»)
  // en algunos ficheros; se usa la más alta que contenga a `top`.
  const banda = bandas
    ?.filter((b) => top >= b.desde && b.n >= 300)
    .sort((x, y) => y.desde - x.desde)[0];
  const sesgo = banda ? (banda.acierto - banda.media) * 100 : null;
  const total = Math.sqrt(ruido ** 2 + (sesgo ?? 0) ** 2);
  return {
    ruidoRatingPp: Math.round(ruido * 10) / 10,
    sesgoCalibracionPp: sesgo == null ? null : Math.round(sesgo * 10) / 10,
    nTramo: banda?.n ?? null,
    totalPp: Math.round(total * 10) / 10,
    rango: { bajo: Math.max(0, top - total / 100), alto: Math.min(1, top + total / 100) },
    significado:
      '±1σ del ruido estimado de los ratings (propagado en primer orden por la curva del modelo) ' +
      'combinado con el error histórico de calibración de este tramo de probabilidad. No es un ' +
      'intervalo de confianza del 95 %: con supuestos normales cubriría aproximadamente el 68 %.',
  };
}

// ---------------------------------------------------------------------------
// ESTABILIDAD
// ---------------------------------------------------------------------------

export type Nivel3 = 'ALTA' | 'MEDIA' | 'BAJA';

export interface Escenario {
  texto: string;
  /** Probabilidad del resultado más probable en ese escenario. */
  p: number;
}

export interface Estabilidad {
  nivel: Nivel3;
  base: number;
  escenarios: Escenario[];
  /** P10 y P90 de la simulación conjunta (solo factores que no son el rating). */
  p10: number;
  p90: number;
  anchoPp: number;
  simulaciones: number;
  /** Qué factores se movieron y entre qué valores. */
  supuestos: string[];
  criterio: string;
}

/** Umbrales del nivel, en pp de ancho P10–P90. Elegidos a mano, no ajustados a datos. */
export const ESTABILIDAD_UMBRALES = { alta: 4, media: 8 };
export const SIMULACIONES = 2000;

const percentil = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

export function estabilidad(e: EventoConfianza): Estabilidad {
  const top = e.probs.indexOf(Math.max(...e.probs));
  const base = e.probs[top];
  const otros = e.factores.filter((f) => f.clave !== 'rating' && f.clave !== 'elo' && f.puntos !== 0);
  const escenarios: Escenario[] = [{ texto: 'predicción base', p: base }];
  for (const f of otros) {
    for (const [m, nombre] of [[f.rango[0], 'bajo'], [f.rango[1], 'alto']] as const) {
      if (m === 1) continue;
      const delta = f.puntos * (m - 1);
      escenarios.push({ texto: `${f.etiqueta}: extremo ${nombre} (×${m})`, p: mover(e, delta)[top] });
    }
  }
  const r = rng(semillaDe(`${e.sport}|${e.matchKey}|estabilidad`));
  const sims: number[] = [];
  for (let i = 0; i < SIMULACIONES; i++) {
    let delta = 0;
    for (const f of otros) {
      const m = f.rango[0] + r() * (f.rango[1] - f.rango[0]);
      delta += f.puntos * (m - 1);
    }
    sims.push(mover(e, delta)[top]);
  }
  const p10 = otros.length ? percentil(sims, 0.1) : base;
  const p90 = otros.length ? percentil(sims, 0.9) : base;
  const ancho = (p90 - p10) * 100;
  return {
    nivel: ancho < ESTABILIDAD_UMBRALES.alta ? 'ALTA' : ancho < ESTABILIDAD_UMBRALES.media ? 'MEDIA' : 'BAJA',
    base,
    escenarios: escenarios.sort((a, b) => a.p - b.p),
    p10,
    p90,
    anchoPp: Math.round(ancho * 10) / 10,
    simulaciones: otros.length ? SIMULACIONES : 0,
    supuestos: otros.map((f) => `${f.etiqueta}: ${f.puntos > 0 ? '+' : ''}${f.puntos} pts, entre ×${f.rango[0]} y ×${f.rango[1]} (${f.porQue})`),
    criterio:
      `Ancho entre los percentiles 10 y 90 de ${SIMULACIONES} simulaciones moviendo a la vez cada factor ` +
      `(salvo el rating, que es la incertidumbre) dentro de su rango: menos de ${ESTABILIDAD_UMBRALES.alta} pp ALTA, ` +
      `menos de ${ESTABILIDAD_UMBRALES.media} pp MEDIA, si no BAJA. Umbrales elegidos a mano, no ajustados a datos.`,
  };
}

// ---------------------------------------------------------------------------
// SUPERVIVENCIA DEL EDGE: incertidumbre y supuestos a la vez
// ---------------------------------------------------------------------------

/**
 * En qué fracción de simulaciones (ruido de rating + factores en su rango) la selección
 * deja de tener la ventaja mínima a esa cuota.
 */
export function edgeDesaparece(e: EventoConfianza, seleccion: number, cuota: number, minEdge: number): number {
  const otros = e.factores.filter((f) => f.clave !== 'rating' && f.clave !== 'elo' && f.puntos !== 0);
  const sigma = e.sigmaHueco ?? 0;
  const r = rng(semillaDe(`${e.sport}|${e.matchKey}|edge|${seleccion}`));
  let pierde = 0;
  for (let i = 0; i < SIMULACIONES; i++) {
    let delta = sigma * normal(r);
    for (const f of otros) delta += f.puntos * (f.rango[0] + r() * (f.rango[1] - f.rango[0]) - 1);
    if (mover(e, delta)[seleccion] * cuota - 1 < minEdge) pierde++;
  }
  return pierde / SIMULACIONES;
}

// ---------------------------------------------------------------------------
// SENSIBILIDAD: valores de Shapley sobre la curva
// ---------------------------------------------------------------------------

export interface Contribucion {
  etiqueta: string;
  pp: number;
}

export interface Sensibilidad {
  /** La probabilidad del resultado 0 sin ningún factor (todo a cero). */
  base: number;
  contribuciones: Contribucion[];
  final: number;
  metodo: string;
  exacta: boolean;
}

/**
 * Shapley de los factores sobre p₀(Σ factores). Con n factores son 2ⁿ evaluaciones de
 * una curva barata; n ≤ 8 siempre aquí. Suma exactamente final − base.
 */
export function sensibilidad(e: EventoConfianza): Sensibilidad {
  const fs = e.factores.filter((f) => f.puntos !== 0);
  const total = fs.reduce((a, f) => a + f.puntos, 0);
  // p₀ con un subconjunto S de factores = p₀ actual movida por (Σ_S − Σ_todos).
  const pDe = (suma: number) => mover(e, suma - total)[0];
  const n = fs.length;
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
  const phi = new Array(n).fill(0);
  for (let mask = 0; mask < 1 << n; mask++) {
    let suma = 0;
    let k = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { suma += fs[i].puntos; k++; }
    const v = pDe(suma);
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      const w = (fact(k) * fact(n - k - 1)) / fact(n);
      phi[i] += w * (pDe(suma + fs[i].puntos) - v);
    }
  }
  return {
    base: pDe(0),
    contribuciones: fs.map((f, i) => ({ etiqueta: f.etiqueta, pp: Math.round(phi[i] * 1000) / 10 })),
    final: e.probs[0],
    exacta: e.pendienteExacta,
    metodo: e.pendienteExacta
      ? 'Valores de Shapley sobre la curva logística del modelo: suman exactamente final − base y no dependen del orden.'
      : 'Valores de Shapley sobre una APROXIMACIÓN logística local del modelo (que no es logístico en estos factores): ' +
        'suman exactamente final − base, pero el reparto entre factores es aproximado.',
  };
}

// ---------------------------------------------------------------------------
// DESACUERDO ENTRE COMPONENTES
// ---------------------------------------------------------------------------

export interface Desacuerdo {
  nivel: 'BAJO' | 'MEDIO' | 'ALTO' | 'SIN COMPONENTES';
  /** Máximo − mínimo de la probabilidad del resultado más probable, en pp. */
  rangoPp: number;
  componentes: { nombre: string; p: number }[];
  criterio: string;
}

export const DESACUERDO_UMBRALES = { bajo: 5, medio: 10 };

export function desacuerdo(e: EventoConfianza): Desacuerdo {
  const top = e.probs.indexOf(Math.max(...e.probs));
  if (e.componentes.length < 2) {
    return { nivel: 'SIN COMPONENTES', rangoPp: 0, componentes: e.componentes.map((c) => ({ nombre: c.nombre, p: c.probs[top] })), criterio: 'Este deporte no tiene componentes separables que comparar.' };
  }
  const ps = e.componentes.map((c) => c.probs[top]);
  const rango = (Math.max(...ps) - Math.min(...ps)) * 100;
  return {
    nivel: rango < DESACUERDO_UMBRALES.bajo ? 'BAJO' : rango < DESACUERDO_UMBRALES.medio ? 'MEDIO' : 'ALTO',
    rangoPp: Math.round(rango * 10) / 10,
    componentes: e.componentes.map((c) => ({ nombre: c.nombre, p: c.probs[top] })),
    criterio: `Diferencia entre el componente más alto y el más bajo para el resultado más probable: menos de ${DESACUERDO_UMBRALES.bajo} pp BAJO, menos de ${DESACUERDO_UMBRALES.medio} pp MEDIO, si no ALTO. Desacuerdo no es error: es una fuente de incertidumbre.`,
  };
}
