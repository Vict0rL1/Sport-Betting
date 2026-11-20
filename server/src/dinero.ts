// DINERO EXACTO (B2, revisión del PR 17): pagos y beneficios de una apuesta, en céntimos enteros, con
// la cuota como fracción decimal exacta y UN solo redondeo, al céntimo más cercano y la mitad hacia
// arriba (todas las cantidades son positivas, así que «hacia arriba» y «lejos del cero» coinciden).
//
// Con coma flotante, 1,02 × 1,25 = 1,2749999… y redondeaba a 1,27, y 1,05 × 2,30 = 2,4149999… daba
// 2,41 en la vista previa y 2,42 en el servidor. Aquí 1,25 es 125/100 y 2,30 es 23/10: el producto
// es exacto (127,5 y 241,5 céntimos) y el redondeo es el de un ser humano (1,28 y 2,42).
//
// Sin dependencias, a propósito: la web (web/src/lib/dinero.ts) reexporta este mismo fichero, así
// que la vista previa del formulario y el servidor no pueden divergir. Las apuestas guardadas no se
// reescriben: se guardan apuesta, cuota y estado, y el pago se calcula al leer (bets.ts).

/** Una cuota decimal como fracción exacta n/d, tal como se escribió (2,3 → 23/10). */
export interface Racional {
  n: bigint;
  d: bigint;
}

/**
 * La cuota como fracción exacta, a partir de su representación decimal más corta (la que escribió
 * la persona: 1.25, no 1.2499999999999998). null si no es un número finito > 0 escrito sin exponente.
 */
export function cuotaRacional(x: number): Racional | null {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return null;
  const s = String(x);
  if (!/^\d+(\.\d+)?$/.test(s)) return null; // 1e21, 1e-7: nada que sea una cuota
  const [ent, frac = ''] = s.split('.');
  return { n: BigInt(ent + frac), d: 10n ** BigInt(frac.length) };
}

/** Un importe con dos decimales como mucho, en céntimos enteros; null si no lo es o no es > 0. */
export function aCentimos(x: number): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return null;
  const c = Math.round(x * 100);
  // 10,005 no es un importe: no se trunca ni se redondea en silencio.
  if (Math.abs(c - x * 100) > 1e-6) return null;
  return c;
}

/** n/d redondeado al entero más cercano, la mitad hacia arriba (n, d ≥ 0). */
function redondeaMitadArriba(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/** Pago de una apuesta ganada: s · cuota, en céntimos. */
export function pagoEnCentimos(stakeCent: number, cuota: Racional): number {
  return Number(redondeaMitadArriba(BigInt(stakeCent) * cuota.n, cuota.d));
}

/**
 * Un importe GUARDADO en céntimos, redondeado una vez (la mitad hacia arriba). A diferencia de
 * `aCentimos`, acepta más de dos decimales: una apuesta de antes de la validación (10,005) se lee
 * como estaba guardada, sin reescribirla, y su pago se calcula con el importe exacto.
 */
function guardadoRacional(x: number): Racional | null {
  return cuotaRacional(x);
}
const centimosDeRacional = (r: Racional): bigint => redondeaMitadArriba(r.n * 100n, r.d);

export type EstadoLiquidado = 'won' | 'lost' | 'void' | 'push' | 'half_won' | 'half_lost' | 'cashout';

/**
 * Pago bruto (lo que vuelve, con la apuesta) en céntimos, o null si no se puede calcular (pendiente,
 * cashout sin importe, datos inválidos):
 *
 *   won        s·d                     lost        0
 *   void/push  s                       half_won    s/2·d + s/2 = s·(d+1)/2
 *   half_lost  s/2                     cashout     lo que pagó la casa
 */
export function pagoBrutoCentimos(stake: number, odds: number, estado: string, cashout: number | null = null): number | null {
  const st = guardadoRacional(stake);
  if (!st) return null;
  const c = cuotaRacional(odds);
  const cuotaValida = c != null && c.n > c.d;
  switch (estado) {
    case 'won':
      // s·d en céntimos: (sn/sd)·(cn/cd)·100, un solo redondeo.
      return cuotaValida ? Number(redondeaMitadArriba(st.n * c.n * 100n, st.d * c.d)) : null;
    case 'lost':
      return 0;
    case 'void':
    case 'push':
      return Number(centimosDeRacional(st));
    case 'half_won':
      // s·(d+1)/2 = (sn/sd)·((cn+cd)/cd)/2·100.
      return cuotaValida ? Number(redondeaMitadArriba(st.n * (c.n + c.d) * 100n, 2n * st.d * c.d)) : null;
    case 'half_lost':
      return Number(redondeaMitadArriba(st.n * 100n, 2n * st.d));
    case 'cashout': {
      if (cashout == null) return null;
      if (cashout === 0) return 0;
      const r = guardadoRacional(cashout);
      return r ? Number(centimosDeRacional(r)) : null;
    }
    default:
      return null;
  }
}

/** La apuesta guardada en céntimos (un redondeo, la mitad hacia arriba). */
export function apuestaCentimos(stake: number): number | null {
  const st = guardadoRacional(stake);
  return st ? Number(centimosDeRacional(st)) : null;
}

/**
 * Lo arriesgado en céntimos: nada si se devolvió, todo en el resto y, en las medias, lo que se puede
 * perder: la apuesta menos lo que vuelve en la media perdida. Así una media perdida pierde el 100 % de
 * lo arriesgado y una media ganada gana d − 1, también con céntimos impares (revisión quant, L1).
 */
export function arriesgadoCentimos(stake: number, estado: string): number | null {
  const st = guardadoRacional(stake);
  if (!st) return null;
  if (estado === 'void' || estado === 'push') return 0;
  const s = Number(centimosDeRacional(st));
  if (estado === 'half_won' || estado === 'half_lost') return s - Number(redondeaMitadArriba(st.n * 100n, 2n * st.d));
  return s;
}

/** Pago y neto (pago − apuesta) en la moneda de la apuesta, o null si no se pueden calcular. */
export function resultadoExacto(stake: number, odds: number, estado: string, cashout: number | null = null): { pago: number; neto: number } | null {
  const s = apuestaCentimos(stake);
  const p = pagoBrutoCentimos(stake, odds, estado, cashout);
  if (s == null || p == null) return null;
  return { pago: p / 100, neto: (p - s) / 100 };
}

/** De céntimos enteros a unidades (para sumar en céntimos y dividir una sola vez al final). */
export const deCentimos = (c: number): number => c / 100;

/**
 * Casos que la vista previa y el servidor tienen que dar iguales (los comprueban
 * server/src/bets/dinero.test.ts y web/src/lib/dinero.test.ts).
 */
export const CASOS_DINERO: { stake: number; odds: number; estado: EstadoLiquidado; cashout?: number; pago: number; neto: number }[] = [
  { stake: 1.02, odds: 1.25, estado: 'won', pago: 1.28, neto: 0.26 },
  { stake: 1.05, odds: 2.3, estado: 'won', pago: 2.42, neto: 1.37 },
  { stake: 3, odds: 1.005, estado: 'won', pago: 3.02, neto: 0.02 },
  { stake: 100, odds: 2.06, estado: 'won', pago: 206, neto: 106 },
  { stake: 0.01, odds: 1.5, estado: 'won', pago: 0.02, neto: 0.01 },
  { stake: 10, odds: 1.333, estado: 'won', pago: 13.33, neto: 3.33 },
  { stake: 100, odds: 2.06, estado: 'lost', pago: 0, neto: -100 },
  { stake: 12.34, odds: 1.9, estado: 'void', pago: 12.34, neto: 0 },
  { stake: 12.34, odds: 1.9, estado: 'push', pago: 12.34, neto: 0 },
  { stake: 100, odds: 2.06, estado: 'half_won', pago: 153, neto: 53 },
  { stake: 10.01, odds: 1.95, estado: 'half_won', pago: 14.76, neto: 4.75 },
  { stake: 10.01, odds: 1.95, estado: 'half_lost', pago: 5.01, neto: -5 },
  { stake: 0.03, odds: 1.5, estado: 'half_won', pago: 0.04, neto: 0.01 },
  { stake: 50, odds: 3.1, estado: 'cashout', cashout: 61.7, pago: 61.7, neto: 11.7 },
  { stake: 50, odds: 3.1, estado: 'cashout', cashout: 0, pago: 0, neto: -50 },
];
