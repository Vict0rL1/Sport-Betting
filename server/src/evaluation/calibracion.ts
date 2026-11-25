// Fase E del seguimiento del PR #18: la calibración POR PARTIDO y el rendimiento POR PERIODO.
//
// Las definiciones las fijó quant-reviewer antes de escribir una línea (docs/plans/seguimiento-pr18-
// 2026-11.md, «Fase E»). Lo esencial:
//   · Se puntúa lo mismo que en todo lo demás: la predicción evaluada según `final-congelada-v1`
//     (evaluation/evaluada.ts), nunca la cifra cruda del modelo (`pModelo`) ni una más favorable.
//   · Cada partido cuenta UNA vez por panel. El diagrama de fiabilidad de siempre
//     (evaluation/reliability.ts) cuenta cada SALIDA como una observación (tres por partido en el
//     fútbol, dos espejadas en los binarios) y por eso no se puede leer como calibración; se queda tal
//     cual porque de él cuelgan el PSI, la deriva y los multiplicadores de importe.
//   · Registrada («final») y legado van siempre aparte. Lo reconstruido NO entra: es una reproducción
//     de temporadas que pueden ser de reserva (holdout), no lo que se enseñó.
//   · Lo que no tiene muestra se dice; nada se dibuja con menos de 30, no hay veredictos por cubeta y
//     el de conjunto nunca dice «calibrado», solo «sin evidencia de descalibración».
//   · No se ajusta nada ni se lee ningún holdout: aquí solo se cuenta.

import { prediccionesConMotivos, type ExcluidaEnVivo, type PrediccionEnVivo } from './live.ts';
import { avisoMuestra } from './sample.ts';
import { POLITICA_EVALUACION, type TipoEvaluacion } from './evaluada.ts';
import { zonaPolitica } from '../staking/contabilidad.ts';
import { inicioDelDia, local, lunesDe, semanaIso, sumarDias } from '../informes/tiempo.ts';
import type { MotivoSinEvaluar } from './evaluada.ts';
import type { SportId } from '../sports.ts';

export const DEFINICION_CALIBRACION = 'calibracion-partido-v1';
export const DEFINICION_RENDIMIENTO = 'rendimiento-periodo-v1';

export const UMBRALES_CALIBRACION = { cubetaMin: 30, cubetaSuficiente: 100, conjuntoMin: 100, conjuntoSuficiente: 500, z: 1.96 } as const;
export const UMBRALES_RENDIMIENTO = { puntoMin: 30, insuficiente: 100, orientativa: 500, z: 1.96 } as const;

/**
 * z* con la corrección de Bonferroni: Φ⁻¹(1 − 0,05 / (2m)), con m = 2 pruebas (calibración en grande y
 * Spiegelhalter) por panel. Binario, un panel: m = 2. Fútbol, tres paneles: m = 6.
 */
export const Z_CRITICO = { binario: 2.2414, tresResultados: 2.6383 } as const;

export type Cohorte = TipoEvaluacion;
export type Periodo = 'mes' | 'semana';
/** La versión de un grupo: la evaluada, o `sin-version` si la fila no la tiene (no se le inventa). */
export const SIN_VERSION = 'sin-version';

export interface Filtros {
  cohorte?: Cohorte;
  /** Una versión concreta (o `sin-version`); sin filtro, todas, cada una en su grupo. */
  version?: string;
  /** Días locales (AAAA-MM-DD) en la zona de la política, ambos incluidos. */
  desde?: string;
  hasta?: string;
  liga?: string;
}

const EPS = 1e-15;

/** Una predicción evaluada, lista para contar: lo mismo para el gráfico, la tabla, la exportación y el desglose. */
export interface FilaEvaluada {
  matchKey: string;
  /** El inicio del partido (ISO), tal como está en el registro. */
  cuando: string;
  /** El día local del inicio en la zona de la política. */
  dia: string;
  cohorte: Cohorte;
  version: string;
  liga: string | null;
  probs: number[];
  /** Índice del resultado que ocurrió. */
  y: number;
  mercado: number[] | null;
  brier: number;
  logLoss: number;
  brierMercado: number | null;
}

/** Brier como en metrics.ts: Σ_k (p_k − y_k)² / 2 (0 perfecto, 1 lo peor; uniforme (K−1)/2K). */
export function brierDe(p: readonly number[], y: number): number {
  return p.reduce((a, pk, k) => a + (pk - (k === y ? 1 : 0)) ** 2, 0) / 2;
}

export const logLossDe = (p: readonly number[], y: number): number => -Math.log(Math.max(p[y], EPS));

/** La cubeta de una probabilidad: 10 fijas, [0,1), [0,1,0,2)… y la última cerrada [0,9, 1]. */
export const indiceCubeta = (p: number): number => Math.min(9, Math.max(0, Math.floor(10 * p + 1e-9)));

/** Intervalo de Wilson al 95 % para k éxitos en n, recortado a [0, 1]. */
export function wilson(k: number, n: number, z: number = UMBRALES_CALIBRACION.z): { lo: number; hi: number } | null {
  if (n <= 0) return null;
  const f = k / n;
  const den = 1 + (z * z) / n;
  const centro = (f + (z * z) / (2 * n)) / den;
  const medio = (z * Math.sqrt((f * (1 - f)) / n + (z * z) / (4 * n * n))) / den;
  return { lo: Math.max(0, centro - medio), hi: Math.min(1, centro + medio) };
}

/**
 * El día local de un instante, con UN formateador por zona (revisión quant de E: `local()` crea uno por
 * llamada, y con 20.000 filas eso eran segundos en cada carga de la página).
 */
function diaEnZona(zona: string): (d: Date) => string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (d) => {
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
}

/**
 * La cohorte de una exclusión por su motivo (evaluation/evaluada.ts): una final ilegible solo existe
 * cuando hay final (registrada); los demás motivos, cuando no la hay y se mira la publicación (legado).
 * A una versión no se pueden asignar: lo que no se lee no dice qué versión lo hizo.
 */
export const cohorteDeMotivo = (m: MotivoSinEvaluar): Cohorte => (m === 'final-invalida' ? 'final' : 'legado');

function filasDe(xs: readonly PrediccionEnVivo[], zona: string): FilaEvaluada[] {
  const out: FilaEvaluada[] = [];
  const diaDe = diaEnZona(zona);
  for (const x of xs) {
    if (!x.evaluacion || !x.cuando || !x.matchKey) continue;
    const d = new Date(x.cuando);
    if (Number.isNaN(d.getTime())) continue;
    const mercado = x.mercado ?? null;
    out.push({
      matchKey: x.matchKey,
      cuando: x.cuando,
      dia: diaDe(d),
      cohorte: x.evaluacion,
      version: x.version ?? SIN_VERSION,
      liga: x.liga ?? null,
      probs: x.p,
      y: x.y,
      mercado,
      brier: brierDe(x.p, x.y),
      logLoss: logLossDe(x.p, x.y),
      brierMercado: mercado ? brierDe(mercado, x.y) : null,
    });
  }
  return out;
}

const dentro = (dia: string | null, f: Filtros) => dia != null && (!f.desde || dia >= f.desde) && (!f.hasta || dia <= f.hasta);

/** Las filas evaluadas de un deporte con los filtros aplicados (sin el de cohorte, que decide cada vista). */
export function filasEvaluadas(
  sport: SportId,
  filtros: Filtros,
  zona: string,
  fuente: (s: SportId) => { xs: PrediccionEnVivo[]; excluidas: ExcluidaEnVivo[] } = prediccionesConMotivos,
): { filas: FilaEvaluada[]; excluidas: (ExcluidaEnVivo & { dia: string | null })[] } {
  const { xs, excluidas } = fuente(sport);
  const diaDe = diaEnZona(zona);
  const filas = filasDe(xs, zona).filter((r) => dentro(r.dia, filtros) && (!filtros.liga || r.liga === filtros.liga) && (filtros.version == null || r.version === filtros.version));
  const exc = excluidas
    .map((e) => {
      const d = e.cuando ? new Date(e.cuando) : null;
      return { ...e, dia: d && !Number.isNaN(d.getTime()) ? diaDe(d) : null };
    })
    .filter((e) => dentro(e.dia, filtros) && (!filtros.liga || e.liga === filtros.liga));
  return { filas, excluidas: exc };
}

const porMotivo = (xs: readonly { motivo: string }[]): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const x of xs) o[x.motivo] = (o[x.motivo] ?? 0) + 1;
  return o;
};

// ---------------------------------------------------------------------------------------------------
// E1 · calibración por partido
// ---------------------------------------------------------------------------------------------------

export type NivelCubeta = 'sin-muestra' | 'orientativa' | 'suficiente';
export type Veredicto = 'insuficiente' | 'descalibrado' | 'sin-evidencia';

export interface Cubeta {
  desde: number;
  hasta: number;
  n: number;
  /** La media de lo predicho en la cubeta (la posición en x); null sin partidos. */
  predichaMedia: number | null;
  /** Lo observado y su intervalo: null con menos de 30 (no se dibuja; n sí se enseña). */
  observada: number | null;
  ic95: { lo: number; hi: number } | null;
  nivel: NivelCubeta;
}

export interface Conjunto {
  n: number;
  predichaMedia: number | null;
  observada: number | null;
  ic95: { lo: number; hi: number } | null;
  /** Calibración en grande: (Σy − Σp) / √Σp(1−p). Detecta el sesgo (p. ej. hacia el local). */
  citlZ: number | null;
  /** Spiegelhalter: detecta el exceso o defecto de confianza. null si su denominador es 0 (todo p = 0,5). */
  spiegelhalterZ: number | null;
  veredicto: Veredicto;
  nivel: 'insuficiente' | 'orientativa' | 'suficiente';
}

export interface Panel {
  clase: 'local' | 'empate' | 'visitante';
  n: number;
  cubetas: Cubeta[];
  conjunto: Conjunto;
}

/** Un panel: cada observación es un partido, x = la probabilidad de la clase, y = 1 si ocurrió. */
export function panel(clase: Panel['clase'], obs: readonly { x: number; y: 0 | 1 }[], zCritico: number): Panel {
  const U = UMBRALES_CALIBRACION;
  const cubetas: Cubeta[] = Array.from({ length: 10 }, (_, i) => ({ desde: i / 10, hasta: (i + 1) / 10, n: 0, predichaMedia: null, observada: null, ic95: null, nivel: 'sin-muestra' as NivelCubeta }));
  const sumas = Array.from({ length: 10 }, () => ({ p: 0, y: 0 }));
  for (const o of obs) {
    const i = indiceCubeta(o.x);
    cubetas[i].n++;
    sumas[i].p += o.x;
    sumas[i].y += o.y;
  }
  cubetas.forEach((c, i) => {
    if (c.n === 0) return;
    c.predichaMedia = sumas[i].p / c.n;
    if (c.n < U.cubetaMin) return;
    c.observada = sumas[i].y / c.n;
    c.ic95 = wilson(sumas[i].y, c.n);
    c.nivel = c.n >= U.cubetaSuficiente ? 'suficiente' : 'orientativa';
  });

  const n = obs.length;
  const sp = obs.reduce((a, o) => a + o.x, 0);
  const sy = obs.reduce((a, o) => a + o.y, 0);
  // Revisión quant de E: el conjunto, con el mismo mínimo que una cubeta para dar lo observado (30) y con
  // el del veredicto para dar las pruebas (100). Con 3 partidos no se dice «pasó el 100 %».
  const conCifra = n >= U.cubetaMin;
  const conPruebas = n >= U.conjuntoMin;
  const varianza = obs.reduce((a, o) => a + o.x * (1 - o.x), 0);
  const citlZ = conPruebas && varianza > 0 ? (sy - sp) / Math.sqrt(varianza) : null;
  const num = obs.reduce((a, o) => a + (o.y - o.x) * (1 - 2 * o.x), 0);
  const den = obs.reduce((a, o) => a + (1 - 2 * o.x) ** 2 * o.x * (1 - o.x), 0);
  const spiegelhalterZ = conPruebas && den > 1e-12 ? num / Math.sqrt(den) : null;
  const veredicto: Veredicto =
    n < U.conjuntoMin
      ? 'insuficiente'
      : (citlZ != null && Math.abs(citlZ) > zCritico) || (spiegelhalterZ != null && Math.abs(spiegelhalterZ) > zCritico)
        ? 'descalibrado'
        : 'sin-evidencia';
  return {
    clase,
    n,
    cubetas,
    conjunto: {
      n,
      predichaMedia: n ? sp / n : null,
      observada: conCifra ? sy / n : null,
      ic95: conCifra ? wilson(sy, n) : null,
      citlZ,
      spiegelhalterZ,
      veredicto,
      nivel: avisoMuestra(n, 'predicciones').nivel,
    },
  };
}

export interface Calibracion {
  definicion: typeof DEFINICION_CALIBRACION;
  politica: typeof POLITICA_EVALUACION;
  deporte: SportId;
  /** 2 (binario) o 3 (1X2). */
  resultados: number;
  zona: string | null;
  filtros: Filtros & { cohorte: Cohorte };
  umbrales: typeof UMBRALES_CALIBRACION & { zCritico: number };
  partidos: number;
  excluidas: Record<string, number>;
  versiones: { version: string; n: number }[];
  paneles: Panel[];
  /** `zona-invalida`: APP_TIMEZONE no es una zona válida y se pidieron fechas (que dependen de ella). */
  motivo: 'zona-invalida' | null;
}

export function calibracion(sport: SportId, filtros: Filtros = {}, fuente?: Parameters<typeof filasEvaluadas>[3]): Calibracion {
  const K = sport === 'football' ? 3 : 2;
  const zCritico = K === 3 ? Z_CRITICO.tresResultados : Z_CRITICO.binario;
  const cohorte: Cohorte = filtros.cohorte ?? 'final';
  const { zona } = zonaPolitica();
  const base = {
    definicion: DEFINICION_CALIBRACION,
    politica: POLITICA_EVALUACION,
    deporte: sport,
    resultados: K,
    zona,
    filtros: { ...filtros, cohorte },
    umbrales: { ...UMBRALES_CALIBRACION, zCritico },
  } as const;
  // Sin zona válida, las fechas no se pueden situar: sin fechas, la calibración no depende de la zona.
  if (!zona && (filtros.desde || filtros.hasta)) return { ...base, partidos: 0, excluidas: {}, versiones: [], paneles: [], motivo: 'zona-invalida' };
  const { filas, excluidas } = filasEvaluadas(sport, filtros, zona ?? 'UTC', fuente);
  const deCohorte = filas.filter((r) => r.cohorte === cohorte);
  const versiones = new Map<string, number>();
  for (const r of deCohorte) versiones.set(r.version, (versiones.get(r.version) ?? 0) + 1);
  const clases: Panel['clase'][] = K === 3 ? ['local', 'empate', 'visitante'] : ['local'];
  const paneles = clases.map((clase, k) => panel(clase, deCohorte.map((r) => ({ x: r.probs[k], y: (r.y === k ? 1 : 0) as 0 | 1 })), zCritico));
  return {
    ...base,
    partidos: deCohorte.length,
    excluidas: porMotivo(excluidas.filter((e) => cohorteDeMotivo(e.motivo) === cohorte)),
    versiones: [...versiones].map(([version, n]) => ({ version, n })).sort((a, b) => b.n - a.n),
    paneles,
    motivo: null,
  };
}

// ---------------------------------------------------------------------------------------------------
// E2 · rendimiento por periodo
// ---------------------------------------------------------------------------------------------------

/** La clave del periodo de un día local: «2026-10» (mes) o «2026-W43» (semana ISO). */
export const clavePeriodo = (dia: string, p: Periodo): string => (p === 'mes' ? dia.slice(0, 7) : semanaIso(dia));

/** El primer día local de un periodo y el primero del siguiente. */
function limites(dia: string, p: Periodo): { primero: string; siguiente: string } {
  if (p === 'semana') {
    const lunes = lunesDe(dia);
    return { primero: lunes, siguiente: sumarDias(lunes, 7) };
  }
  const [a, m] = dia.slice(0, 7).split('-').map(Number);
  const sig = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { primero: `${dia.slice(0, 7)}-01`, siguiente: `${sig}-01` };
}

/** Media e intervalo al 95 % (media ± 1,96·sd/√n) de unos valores; null sin datos. */
function media(xs: readonly number[]): { media: number; ic95: { lo: number; hi: number } | null } | null {
  const n = xs.length;
  if (!n) return null;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { media: m, ic95: null };
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  const h = (UMBRALES_RENDIMIENTO.z * sd) / Math.sqrt(n);
  return { media: m, ic95: { lo: m - h, hi: m + h } };
}

export type NivelPunto = 'sin-muestra' | 'insuficiente' | 'orientativa' | 'suficiente';
const nivelPunto = (n: number): NivelPunto => {
  const U = UMBRALES_RENDIMIENTO;
  return n < U.puntoMin ? 'sin-muestra' : n < U.insuficiente ? 'insuficiente' : n < U.orientativa ? 'orientativa' : 'suficiente';
};

export interface BloqueMercado {
  n: number;
  brierModelo: number | null;
  brierMercado: number | null;
  /** Brier del modelo − Brier del mercado en los MISMOS partidos (negativo: el modelo mejor). */
  delta: number | null;
  ic95: { lo: number; hi: number } | null;
}

function bloqueMercado(filas: readonly FilaEvaluada[], minimo: number): BloqueMercado | null {
  const con = filas.filter((r) => r.brierMercado != null);
  if (!con.length) return null;
  if (con.length < minimo) return { n: con.length, brierModelo: null, brierMercado: null, delta: null, ic95: null };
  const d = media(con.map((r) => r.brier - (r.brierMercado as number)));
  return {
    n: con.length,
    brierModelo: con.reduce((a, r) => a + r.brier, 0) / con.length,
    brierMercado: con.reduce((a, r) => a + (r.brierMercado as number), 0) / con.length,
    delta: d?.media ?? null,
    ic95: d?.ic95 ?? null,
  };
}

export interface Punto {
  periodo: string;
  /** Los instantes en que empieza este periodo y el siguiente, en la zona de la política. */
  desde: string;
  hasta: string;
  /** El periodo en curso: todavía no ha terminado. */
  parcial: boolean;
  /** Los filtros desde/hasta cortan el periodo: `desde`/`hasta` son los del filtro, no los del periodo. */
  recortado: boolean;
  n: number;
  brier: number | null;
  ic95: { lo: number; hi: number } | null;
  logLoss: number | null;
  mercado: BloqueMercado | null;
  ligas: Record<string, number>;
  nivel: NivelPunto;
  motivo: 'sin-evaluadas' | null;
}

export interface Resumen {
  cohorte: Cohorte;
  version: string;
  n: number;
  brier: number | null;
  ic95: { lo: number; hi: number } | null;
  logLoss: number | null;
  mercado: BloqueMercado | null;
  nivel: 'insuficiente' | 'orientativa' | 'suficiente';
}

export interface Rendimiento {
  definicion: typeof DEFINICION_RENDIMIENTO;
  politica: typeof POLITICA_EVALUACION;
  deporte: SportId;
  metrica: 'brier';
  direccion: 'menor-es-mejor';
  normalizacion: 'suma/2';
  referencia: { uniforme: number };
  zona: string | null;
  zonaOrigen: 'APP_TIMEZONE' | 'servidor';
  base: 'inicio-partido';
  periodo: Periodo;
  filtros: Filtros;
  umbrales: typeof UMBRALES_RENDIMIENTO;
  series: { cohorte: Cohorte; version: string; puntos: Punto[] }[];
  resumen: Resumen[];
  /** Los partidos que no se evalúan, por periodo y motivo (no son de ninguna versión ni cohorte). */
  excluidas: Record<string, Record<string, number>>;
  motivo: 'zona-invalida' | null;
}

export function rendimiento(
  sport: SportId,
  filtros: Filtros = {},
  periodo: Periodo = 'mes',
  ahora: Date = new Date(),
  fuente?: Parameters<typeof filasEvaluadas>[3],
): Rendimiento {
  const K = sport === 'football' ? 3 : 2;
  const { zona, origen } = zonaPolitica();
  const base = {
    definicion: DEFINICION_RENDIMIENTO,
    politica: POLITICA_EVALUACION,
    deporte: sport,
    metrica: 'brier',
    direccion: 'menor-es-mejor',
    normalizacion: 'suma/2',
    referencia: { uniforme: (K - 1) / (2 * K) },
    zona,
    zonaOrigen: origen,
    base: 'inicio-partido',
    periodo,
    filtros,
    umbrales: UMBRALES_RENDIMIENTO,
  } as const;
  // Sin una zona válida no hay días ni semanas que asignar, y no se finge otra.
  if (!zona) return { ...base, series: [], resumen: [], excluidas: {}, motivo: 'zona-invalida' };

  const { filas, excluidas } = filasEvaluadas(sport, filtros, zona, fuente);
  const usadas = filtros.cohorte ? filas.filter((r) => r.cohorte === filtros.cohorte) : filas;
  const hoy = clavePeriodo(local(ahora, zona).fecha, periodo);

  const grupos = new Map<string, FilaEvaluada[]>();
  for (const r of usadas) {
    const k = `${r.cohorte}\u0000${r.version}`;
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(r);
  }

  const series: Rendimiento['series'] = [];
  const resumen: Resumen[] = [];
  for (const [k, rs] of grupos) {
    const [cohorte, version] = k.split('\u0000') as [Cohorte, string];
    const porPeriodo = new Map<string, FilaEvaluada[]>();
    for (const r of rs) {
      const p = clavePeriodo(r.dia, periodo);
      (porPeriodo.get(p) ?? porPeriodo.set(p, []).get(p)!).push(r);
    }
    // Todos los periodos del primero al último, también los vacíos (que no se unen con una línea).
    const dias = rs.map((r) => r.dia).sort();
    const puntos: Punto[] = [];
    let { primero, siguiente } = limites(dias[0], periodo);
    const ultimo = clavePeriodo(dias[dias.length - 1], periodo);
    for (;;) {
      const clave = clavePeriodo(primero, periodo);
      const del = porPeriodo.get(clave) ?? [];
      const n = del.length;
      const visible = n >= UMBRALES_RENDIMIENTO.puntoMin;
      const b = visible ? media(del.map((r) => r.brier)) : null;
      const ligas: Record<string, number> = {};
      for (const r of del) if (r.liga) ligas[r.liga] = (ligas[r.liga] ?? 0) + 1;
      // Revisión quant de E: si el filtro corta el periodo, el punto lo dice y lleva los límites del filtro.
      const desdeDia = filtros.desde && filtros.desde > primero ? filtros.desde : primero;
      const hastaDia = filtros.hasta && sumarDias(filtros.hasta, 1) < siguiente ? sumarDias(filtros.hasta, 1) : siguiente;
      puntos.push({
        periodo: clave,
        desde: inicioDelDia(desdeDia, zona),
        hasta: inicioDelDia(hastaDia, zona),
        parcial: clave === hoy,
        recortado: desdeDia !== primero || hastaDia !== siguiente,
        n,
        brier: b?.media ?? null,
        ic95: b?.ic95 ?? null,
        logLoss: visible ? del.reduce((a, r) => a + r.logLoss, 0) / n : null,
        mercado: bloqueMercado(del, UMBRALES_RENDIMIENTO.puntoMin),
        ligas,
        nivel: nivelPunto(n),
        motivo: n === 0 ? 'sin-evaluadas' : null,
      });
      if (clave === ultimo) break;
      ({ primero, siguiente } = limites(siguiente, periodo));
    }
    series.push({ cohorte, version, puntos });
    // El titular de la serie: la media sobre todos sus partidos (= la media de los puntos pesada por n).
    const visible = rs.length >= UMBRALES_RENDIMIENTO.insuficiente;
    const b = visible ? media(rs.map((r) => r.brier)) : null;
    resumen.push({
      cohorte,
      version,
      n: rs.length,
      brier: b?.media ?? null,
      ic95: b?.ic95 ?? null,
      logLoss: visible ? rs.reduce((a, r) => a + r.logLoss, 0) / rs.length : null,
      mercado: bloqueMercado(rs, UMBRALES_RENDIMIENTO.insuficiente),
      nivel: avisoMuestra(rs.length, 'predicciones').nivel,
    });
  }
  const orden = (a: { cohorte: string; version: string }, b: { cohorte: string; version: string }) => a.cohorte.localeCompare(b.cohorte) || a.version.localeCompare(b.version);
  series.sort(orden);
  resumen.sort(orden);

  const exc: Record<string, Record<string, number>> = {};
  for (const e of excluidas) {
    if (!e.dia || (filtros.cohorte && cohorteDeMotivo(e.motivo) !== filtros.cohorte)) continue;
    const p = clavePeriodo(e.dia, periodo);
    (exc[p] ??= {})[e.motivo] = (exc[p][e.motivo] ?? 0) + 1;
  }
  return { ...base, series, resumen, excluidas: exc, motivo: null };
}

/**
 * El desglose de UN punto: las filas de una cohorte y una versión en un periodo, las mismas que su
 * media (revisión quant de E: sin las dos, mezclaba filas de varios puntos). `falta-serie` si no llegan.
 */
export function partidosDelPeriodo(sport: SportId, filtros: Filtros, periodo: Periodo, clave: string, fuente?: Parameters<typeof filasEvaluadas>[3]): { zona: string | null; filas: (FilaEvaluada & { periodo: string })[]; motivo: 'zona-invalida' | 'falta-serie' | null } {
  const { zona } = zonaPolitica();
  if (!filtros.cohorte || filtros.version == null) return { zona, filas: [], motivo: 'falta-serie' };
  if (!zona) return { zona, filas: [], motivo: 'zona-invalida' };
  const { filas } = filasEvaluadas(sport, filtros, zona, fuente);
  return {
    zona,
    filas: filas
      .filter((r) => r.cohorte === filtros.cohorte)
      .map((r) => ({ ...r, periodo: clavePeriodo(r.dia, periodo) }))
      .filter((r) => r.periodo === clave),
    motivo: null,
  };
}
