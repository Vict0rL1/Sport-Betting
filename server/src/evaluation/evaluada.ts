// LA PREDICCIÓN EVALUADA: una sola regla para todo lo que puntúa un partido (B1, revisión del PR 17).
//
// «¿Acertó?», los resultados recientes de Rendimiento, la evaluación en vivo (log loss, Brier,
// calibración, comparación con el mercado, deriva por versión), la exportación de predicciones y la
// etiqueta «evaluada» del historial de la ficha leen la predicción evaluada de aquí. Antes, las
// cuatro primeras puntuaban la publicación original y el historial llamaba «evaluada» a la final
// congelada: con una original 20/20/60 y una final 60/20/20, si ganaba el local, la app contaba un
// fallo y a la vez señalaba como evaluada la instantánea que acertaba.
//
// ===========================================================================
// POLÍTICA 'final-congelada-v1'
// ===========================================================================
//   1. Se evalúa la FINAL PRE-PARTIDO: la fila de prematch_final, congelada al empezar el partido a
//      partir de la última instantánea capturada ANTES del inicio (o del registro, si el servidor no
//      tomó ninguna). Se decide por la hora, nunca por el resultado: no es «la más favorable».
//   2. Sin final congelada (el ciclo no llegó a congelarla, o la fila incumplía sus restricciones),
//      se evalúa la PUBLICACIÓN ORIGINAL del registro y se marca 'legado': se ve y se cuenta aparte.
//   3. Una final que no se puede leer (probabilidades no finitas, fuera de [0, 1], que no suman 1, o
//      de otro número de resultados que el mercado) no se evalúa NI se cambia por la publicación: se
//      excluye y se cuenta. Cambiarla en silencio por otro número sería elegir qué se puntúa.
//   4. Una publicación escrita en o después del inicio no es pre-partido (prematch/tiempo.ts): quien
//      llama ya la filtra, y aquí nunca llega.
//
// Cuatro cosas distintas que no se mezclan:
//   publicación original   la primera fila del registro *_prediction_log. Lo que leen Destacados, la
//                          cabecera de las pestañas por deporte y el banco de papel (se apuesta al
//                          publicar, con la cuota de ese momento).
//   última registrada      la instantánea más reciente: lo que enseña el explorador antes del inicio.
//   final congelada        prematch_final: la EVALUADA.
//   legado                 evaluada con la publicación porque no hay final congelada.
//
// La deriva del modelo (trust/drift.ts) sigue midiendo la PUBLICACIÓN (`publicacionesResueltas()` de
// evaluation/live.ts, sin pasar por esta política) contra el backtest, como antes: su aviso recorta los importes
// del banco de papel y de las estrategias, que apuestan al publicar. Cambiar qué se puntúa no puede
// cambiar cuánto se apuesta (revisión quant de B1, hallazgo 1).
//
// ORIENTACIÓN. La final se lee en el orden de los resultados del REGISTRO. En el tenis la clave del
// partido no depende del orden de los jugadores (min|max de los ids), y el proveedor puede darlos al
// revés: una final [B, A] se reordena a [A, B]; si los nombres no casan con los del registro (sin
// contar espacios de más ni formas Unicode), no se sabe a quién es cada probabilidad y la final no se
// puntúa (hallazgo 2). En los demás deportes, la UFC incluida, la clave fija local/visitante o A/B, y
// un nombre escrito de otra manera no cambia el orden.

export const POLITICA_EVALUACION = 'final-congelada-v1' as const;

export type TipoEvaluacion = 'final' | 'legado';
export type MotivoSinEvaluar = 'final-invalida' | 'publicacion-invalida' | 'sin-publicacion' | 'publicacion-tardia';

/** La fila de prematch_final tal como sale de la base (probs y mercado en JSON). */
export interface FinalLeida {
  source: string;
  /** Nombres de los resultados de la final (JSON o array), para orientarla como el registro. */
  outcomes?: unknown;
  probs: unknown;
  market_probs: unknown;
  model_version: string | null;
  captured_at: string;
  snapshot_id: number | null;
}

/** La publicación original del registro, ya leída. */
export interface Publicacion {
  probs: number[];
  mercado: number[] | null;
  version: string | null;
  en: string;
}

export interface Evaluada {
  politica: typeof POLITICA_EVALUACION;
  tipo: TipoEvaluacion;
  /** De dónde salió el número: una instantánea pre-partido o el registro de predicciones. */
  fuente: 'instantanea' | 'registro';
  probs: number[];
  mercado: number[] | null;
  version: string | null;
  capturadaEn: string;
  /** La instantánea evaluada, si la final salió de una (el historial la marca con este id). */
  snapshotId: number | null;
}

export type Resolucion = { ok: true; evaluada: Evaluada } | { ok: false; motivo: MotivoSinEvaluar };

/** Cuántos resultados tiene el mercado ganador de un deporte (el fútbol, con empate, tres). */
export const resultadosDe = (sport: string): number => (sport === 'football' ? 3 : 2);

/** Tolerancia de la suma: el registro de fútbol guarda cinco decimales y las tres suman 0,99999. */
const TOLERANCIA_SUMA = 1e-3;

/**
 * Unas probabilidades legibles de `n` resultados, renormalizadas, o null. Acepta el array o su JSON
 * (como lo guardan prematch_final y prediction_snapshots).
 */
export function leerProbs(x: unknown, n: number): number[] | null {
  let v: unknown = x;
  if (typeof x === 'string') {
    try {
      v = JSON.parse(x);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(v) || v.length !== n) return null;
  if (!v.every((p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1)) return null;
  const s = (v as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(s - 1) > TOLERANCIA_SUMA) return null;
  return s === 1 ? [...(v as number[])] : (v as number[]).map((p) => p / s);
}

/** Los nombres del primer y el último resultado en el registro, y si su orden es libre (el tenis). */
export interface Orientacion {
  nombres: [string, string];
  ordenLibre: boolean;
}

/** Deportes cuya clave de partido no fija el orden de los participantes. */
export const ORDEN_LIBRE: ReadonlySet<string> = new Set(['tennis']);

/**
 * Cómo leer la final en el orden del registro: 'igual', 'invertida' (mismos nombres al revés) o
 * null si no se puede saber en un deporte de orden libre. Sin nombres que comparar, 'igual'.
 */
export function orientarFinal(outcomes: unknown, o: Orientacion | undefined): 'igual' | 'invertida' | null {
  if (!o) return 'igual';
  let v: unknown = outcomes;
  if (typeof outcomes === 'string') {
    try {
      v = JSON.parse(outcomes);
    } catch {
      v = null;
    }
  }
  if (!Array.isArray(v) || v.length < 2) return o.ordenLibre ? null : 'igual';
  const limpio = (n: unknown) => String(n).normalize('NFC').trim().replace(/\s+/g, ' ');
  const [a, b] = [limpio(v[0]), limpio(v[v.length - 1])];
  const [x, y] = o.nombres.map(limpio);
  if (a === x && b === y) return 'igual';
  if (a === y && b === x) return 'invertida';
  return o.ordenLibre ? null : 'igual';
}

/**
 * La predicción evaluada de un partido de `n` resultados, según la política de arriba. `publicacion`
 * es la fila pre-partido del registro (o null si no hay), `final` la de prematch_final (o null) y
 * `orientacion`, los nombres del registro para leer la final en su orden.
 */
export function resolverEvaluada(publicacion: Publicacion | null, final: FinalLeida | null, n: number, orientacion?: Orientacion): Resolucion {
  if (final) {
    const leidas = leerProbs(final.probs, n);
    const sentido = orientarFinal(final.outcomes, orientacion);
    if (!leidas || !sentido) return { ok: false, motivo: 'final-invalida' };
    const girar = (xs: number[]) => (sentido === 'invertida' ? [...xs].reverse() : xs);
    const probs = girar(leidas);
    const mercadoFinal = final.market_probs == null ? null : leerProbs(final.market_probs, n);
    return {
      ok: true,
      evaluada: {
        politica: POLITICA_EVALUACION,
        tipo: 'final',
        fuente: final.source === 'snapshot' ? 'instantanea' : 'registro',
        probs,
        mercado: mercadoFinal ? girar(mercadoFinal) : null,
        version: final.model_version ?? null,
        capturadaEn: final.captured_at,
        snapshotId: final.source === 'snapshot' ? final.snapshot_id : null,
      },
    };
  }
  if (!publicacion) return { ok: false, motivo: 'sin-publicacion' };
  const probs = leerProbs(publicacion.probs, n);
  if (!probs) return { ok: false, motivo: 'publicacion-invalida' };
  return {
    ok: true,
    evaluada: {
      politica: POLITICA_EVALUACION,
      tipo: 'legado',
      fuente: 'registro',
      probs,
      mercado: publicacion.mercado ? leerProbs(publicacion.mercado, n) : null,
      version: publicacion.version,
      capturadaEn: publicacion.en,
      snapshotId: null,
    },
  };
}

/**
 * El LEFT JOIN a prematch_final y sus columnas, para las consultas que leen un registro con alias
 * `alias`. Las columnas salen con prefijo `pf_`; `finalDeFila` las vuelve a juntar.
 */
export function joinFinal(sport: string, alias: string, clave: string): { join: string; columnas: string } {
  if (!/^[a-z]+$/.test(sport) || !/^[a-z]*\.?$/.test(alias) || !/^[a-z_]+$/.test(clave)) throw new Error('joinFinal: identificador no válido');
  return {
    join: `LEFT JOIN prematch_final pf ON pf.sport = '${sport}' AND pf.match_key = ${alias}${clave}`,
    columnas: 'pf.source AS pf_source, pf.outcomes AS pf_outcomes, pf.probs AS pf_probs, pf.market_probs AS pf_mercado, pf.model_version AS pf_version, pf.captured_at AS pf_en, pf.snapshot_id AS pf_snap',
  };
}

/** La final de una fila leída con `joinFinal`, o null si el partido no tiene. */
export function finalDeFila(r: Record<string, unknown>): FinalLeida | null {
  if (r.pf_source == null) return null;
  return {
    source: String(r.pf_source),
    outcomes: r.pf_outcomes ?? null,
    probs: r.pf_probs,
    market_probs: r.pf_mercado ?? null,
    model_version: (r.pf_version as string | null) ?? null,
    captured_at: String(r.pf_en),
    snapshot_id: r.pf_snap == null ? null : Number(r.pf_snap),
  };
}

/** Índice del favorito (el primero de los máximos, como en el resto de la app). */
export function indiceFavorito(probs: readonly number[]): number {
  let i = 0;
  for (let k = 1; k < probs.length; k++) if (probs[k] > probs[i]) i = k;
  return i;
}
