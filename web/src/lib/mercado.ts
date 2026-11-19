// La aritmética de probabilidades, cuotas y dinero, en UN sitio (rediseño de noviembre, D6/D8).
//
// Convenciones:
//   · Una probabilidad va de 0 a 1 por dentro. Se pasa a porcentaje solo para enseñarla.
//   · Una cuota es decimal (europea): lo que se cobra por unidad apostada, con la apuesta
//     incluida. Tiene que ser mayor que 1; 1 o menos no paga nada y casi siempre es una cuota
//     americana o un error de tecleo.
//   · Las fórmulas sencillas (cuota justa 1/p, pago s·d) suponen una apuesta simple sin
//     comisión, sin promociones y sin devolución parcial. Los mercados con push o medias
//     tienen su propio cálculo (resultadoApuesta) o no se calculan.
//   · Nada de NaN ni infinitos hacia la pantalla: lo que no se puede calcular es null.

export type Validacion<T> = { ok: true; valor: T } | { ok: false; motivo: string };

const finito = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Tolerancia de la suma de una distribución completa: la base guarda 6 decimales y una
 * distribución mostrada puede venir redondeada. Más allá de 0,001 no es redondeo, es otra
 * cosa (un resultado que falta, dos mercados mezclados).
 */
export const TOLERANCIA_SUMA = 1e-3;

/**
 * Una distribución de resultados EXCLUYENTES Y EXHAUSTIVOS (1X2, ganador a dos): al menos dos
 * resultados, cada uno entre 0 y 1, y suma 1 dentro de la tolerancia. No vale para selecciones
 * que se solapan (doble oportunidad), que suman más de 1 a propósito.
 */
export function validarDistribucion(ps: readonly unknown[]): Validacion<number[]> {
  if (ps.length < 2) return { ok: false, motivo: 'una distribución necesita al menos dos resultados' };
  for (const p of ps) {
    if (!finito(p)) return { ok: false, motivo: 'probabilidad no numérica' };
    if (p < 0 || p > 1) return { ok: false, motivo: 'probabilidad fuera de 0–1' };
  }
  const s = (ps as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(s - 1) > TOLERANCIA_SUMA) return { ok: false, motivo: `las probabilidades suman ${s.toFixed(3)}, no 1` };
  return { ok: true, valor: [...(ps as number[])] };
}

/**
 * Porcentajes para enseñar una distribución, con `decimales` y sumando exactamente 100 (método
 * del mayor resto). Así un 1X2 no enseña 57,9 + 20,1 + 21,9 = 99,9. Cada cifra difiere como
 * mucho en una unidad del último decimal de su redondeo simple.
 */
export function porcentajes(ps: readonly number[], decimales = 1): number[] {
  const escala = 10 ** decimales;
  const total = 100 * escala;
  const suma = ps.reduce((a, b) => a + b, 0);
  if (!(suma > 0)) return ps.map(() => 0);
  const crudos = ps.map((p) => (p / suma) * total);
  const base = crudos.map(Math.floor);
  let resto = total - base.reduce((a, b) => a + b, 0);
  const orden = crudos.map((c, i) => [c - Math.floor(c), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of orden) {
    if (resto <= 0) break;
    base[i] += 1;
    resto -= 1;
  }
  return base.map((u) => u / escala);
}

/** Cuota justa del modelo: 1/p, la cuota a la que la apuesta no gana ni pierde según el modelo. */
export function cuotaJusta(p: number): number | null {
  if (!finito(p) || p <= 0 || p > 1) return null;
  return 1 / p;
}

/** Probabilidad implícita BRUTA de una cuota (1/d): incluye el margen de la casa. */
export function implicitaDeCuota(d: number | null | undefined): number | null {
  if (!finito(d) || d <= 1) return null;
  return 1 / d;
}

/**
 * Probabilidades del mercado sin margen, por normalización proporcional:
 * (1/dᵢ) / Σ(1/dⱼ).
 *
 * Solo para un conjunto COMPLETO de resultados excluyentes, de la misma casa o consenso y del
 * mismo momento. Si falta una cuota o alguna no es válida, no hay resultado: normalizar lo que
 * queda inventaría una probabilidad. Las selecciones solapadas (doble oportunidad) no pasan
 * por aquí: se derivan de la distribución (dobleOportunidad).
 */
export function quitarMargen(cuotas: readonly (number | null | undefined)[]): number[] | null {
  if (cuotas.length < 2) return null;
  const imp = cuotas.map(implicitaDeCuota);
  if (imp.some((x) => x == null)) return null;
  const s = (imp as number[]).reduce((a, b) => a + b, 0);
  return (imp as number[]).map((x) => x / s);
}

export interface DobleOportunidad {
  casaOEmpate: number;
  fueraOEmpate: number;
  casaOFuera: number;
}

/**
 * Doble oportunidad a partir de una distribución 1X2 válida: 1X = p₁ + pₓ, X2 = pₓ + p₂,
 * 12 = p₁ + p₂. Las tres se solapan (suman 2) y así se quedan: no se normalizan, ni se les
 * quita el margen como si fueran tres resultados de un mismo mercado.
 */
export function dobleOportunidad(ps: readonly number[]): DobleOportunidad | null {
  if (ps.length !== 3 || !validarDistribucion(ps).ok) return null;
  const [h, d, a] = ps;
  return { casaOEmpate: h + d, fueraOEmpate: d + a, casaOFuera: h + a };
}

/** Diferencia modelo − mercado en PUNTOS porcentuales (55 % → 58 % es +3 pp, no +3 %). */
export function diferenciaPp(pModelo: number, pMercado: number): number {
  return (pModelo - pMercado) * 100;
}

/**
 * Valor esperado según el modelo, por unidad apostada, de una selección simple sin push:
 * p·d − 1. Es una estimación condicionada al modelo y a la cuota, no un beneficio probado.
 */
export function valorEsperado(p: number, d: number): number | null {
  if (!finito(p) || p < 0 || p > 1 || !finito(d) || d <= 1) return null;
  return p * d - 1;
}

/** Un número escrito con coma o punto decimal; null si no es exactamente un número. */
function leerNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** La cuota decimal más alta que se acepta: por encima casi siempre es un error de tecleo. */
export const CUOTA_MAXIMA = 1000;

export function validarCuota(v: unknown): Validacion<number> {
  const n = leerNumero(v);
  if (n == null) return { ok: false, motivo: 'La cuota tiene que ser un número (ej. 1,85).' };
  if (n <= 1) return { ok: false, motivo: 'La cuota decimal tiene que ser mayor que 1.' };
  if (n > CUOTA_MAXIMA) return { ok: false, motivo: 'Cuota demasiado alta: revisa el número.' };
  return { ok: true, valor: n };
}

/** Importe máximo de una apuesta, para cazar un cero de más. */
export const IMPORTE_MAXIMO = 1_000_000;

/**
 * Un importe en una moneda con céntimos: finito, mayor que 0 y con 2 decimales como mucho. No se
 * trunca nunca: 10,005 es un error, no 10,00.
 */
export function validarImporte(v: unknown): Validacion<number> {
  const n = leerNumero(v);
  if (n == null) return { ok: false, motivo: 'La cantidad tiene que ser un número.' };
  if (n <= 0) return { ok: false, motivo: 'La cantidad tiene que ser mayor que 0.' };
  if (n > IMPORTE_MAXIMO) return { ok: false, motivo: 'Cantidad demasiado alta: revisa el número.' };
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { ok: false, motivo: 'Como mucho 2 decimales.' };
  return { ok: true, valor: n };
}

export type EstadoApuesta = 'pending' | 'won' | 'lost' | 'void' | 'push' | 'half_won' | 'half_lost' | 'cashout';

/**
 * Pago bruto (lo que vuelve, con la apuesta) y neto (pago − apuesta) de una apuesta simple, en la
 * moneda de la apuesta, redondeados a céntimos. Se calcula en céntimos enteros para que
 * 100 × 2,06 sea 206,00 y no 206,00000000000003.
 *
 *   ganada       pago s·d,                 neto s·(d−1)
 *   perdida      pago 0,                   neto −s
 *   anulada/push pago s,                   neto 0
 *   media ganada pago s/2·d + s/2,         neto s/2·(d−1)
 *   media perdida pago s/2,                neto −s/2
 *
 * Pendiente: null (no se sabe, y 0 diría que se recuperó lo apostado). El cashout depende de lo
 * que pagó la casa y no sale de aquí.
 */
export function resultadoApuesta(stake: number, odds: number, estado: EstadoApuesta): { pago: number; neto: number } | null {
  if (!finito(stake) || stake <= 0 || !finito(odds) || odds <= 1) return null;
  const s = Math.round(stake * 100);
  let pago: number;
  switch (estado) {
    case 'won':
      pago = Math.round(s * odds);
      break;
    case 'lost':
      pago = 0;
      break;
    case 'void':
    case 'push':
      pago = s;
      break;
    case 'half_won':
      pago = Math.round((s / 2) * odds + s / 2);
      break;
    case 'half_lost':
      pago = Math.round(s / 2);
      break;
    default:
      return null;
  }
  return { pago: pago / 100, neto: (pago - s) / 100 };
}
