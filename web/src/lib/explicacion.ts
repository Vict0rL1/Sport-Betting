// Las explicaciones estructuradas del servidor (server/src/explicaciones/, seguimiento del PR #18,
// fase C), escritas en el idioma de la interfaz.
//
// El servidor manda, junto a cada frase en español de siempre (`bullets`, `reasons`, `text`), un código
// estable con parámetros tipados. Aquí se escribe con el catálogo (`explica.<código>`) y los formatos
// del idioma. Si el código no está en el catálogo (un servidor más nuevo) o no llega (uno más viejo),
// se enseña la frase del servidor: nunca una clave cruda.

import { existeClave, type Clave, type Idioma } from '../i18n';
import { cifra, num, pct } from './formato';

export type ParamExp =
  | { t: 'txt'; v: string }
  | { t: 'int'; v: number }
  | { t: 'num'; v: number; d: number }
  | { t: 'signo'; v: number; d: number }
  | { t: 'pct'; v: number; d: number }
  | { t: 'lista'; v: string[] }
  | { t: 'miles'; v: number }
  /** Piezas que son otras explicaciones, unidas con «; » o «, » (server/src/explicaciones/index.ts). */
  | { t: 'frases'; v: Explicacion[]; sep: 'pyc' | 'coma' };

export interface Explicacion {
  codigo: string;
  params: Record<string, ParamExp>;
}

type Traducir = (clave: Clave, vars?: Record<string, string | number>) => string;

/** El valor de un parámetro en el idioma. Los nombres van tal cual. */
export function valorEn(p: ParamExp, idioma: Idioma, pieza: (e: Explicacion) => string = () => {
  throw new Error('pieza sin escribir');
}): string | number {
  switch (p.t) {
    case 'txt':
      return p.v;
    case 'int':
      return cifra(Math.round(p.v), idioma);
    case 'num':
      return num(p.v, p.d, idioma);
    case 'signo': {
      const s = num(p.v, p.d, idioma);
      return p.v > 0 && Number(p.v.toFixed(p.d)) !== 0 ? `+${s}` : s;
    }
    case 'pct':
      return pct(p.v, p.d, idioma);
    case 'lista': {
      if (p.v.length <= 1) return p.v[0] ?? '';
      return new Intl.ListFormat(idioma === 'en' ? 'en-GB' : 'es', { type: 'conjunction' }).format(p.v);
    }
    case 'miles': {
      const a = String(Math.abs(Math.round(p.v))).replace(/\B(?=(\d{3})+(?!\d))/g, idioma === 'en' ? ',' : '.');
      return `${p.v < 0 ? '−' : ''}${a}`;
    }
    case 'frases':
      return p.v.map(pieza).join(p.sep === 'pyc' ? '; ' : ', ');
  }
}

/** Marca de una pieza que no se puede escribir: la frase entera vuelve a la del servidor. */
const SIN_PIEZA = '\u0000';

/** Los valores para `t()`: los números que deciden un plural van como número, el resto ya escrito. */
function vars(e: Explicacion, idioma: Idioma, t: Traducir): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const pieza = (x: Explicacion) => {
    const s = escribir(t, idioma, x, SIN_PIEZA);
    if (s === SIN_PIEZA) throw new Error(`pieza desconocida: ${x?.codigo}`);
    return s;
  };
  for (const [k, p] of Object.entries(e.params ?? {})) out[k] = valorEn(p, idioma, pieza);
  return out;
}

/** La frase de una explicación en el idioma, o `respaldo` (la del servidor) si no se puede escribir. */
export function escribir(t: Traducir, idioma: Idioma, e: Explicacion | null | undefined, respaldo: string): string {
  if (!e || typeof e.codigo !== 'string') return respaldo;
  const clave = `explica.${e.codigo}`;
  if (!existeClave(clave)) return respaldo;
  try {
    // Los plurales («{n|vez|veces}») los resuelve t() con el entero tal cual (cifra no agrupa: «1»).
    return t(clave as Clave, vars(e, idioma, t));
  } catch {
    return respaldo;
  }
}

/** Una lista de explicaciones junto a sus frases: por posición, con la frase si falta el código. */
export function escribirTodas(t: Traducir, idioma: Idioma, es: readonly Explicacion[] | null | undefined, respaldo: readonly string[]): string[] {
  if (!es || es.length !== respaldo.length) return [...respaldo];
  return respaldo.map((r, i) => escribir(t, idioma, es[i], r));
}

/**
 * Un párrafo hecho de varias explicaciones (la «lectura» de la ficha). El servidor lo manda junto, así
 * que si una sola pieza no se puede escribir se enseña el párrafo del servidor entero.
 */
export function escribirJunto(t: Traducir, idioma: Idioma, es: readonly Explicacion[] | null | undefined, respaldo: string): string {
  if (!es || es.length === 0 || !es.every((e) => e && existeClave(`explica.${e.codigo}`))) return respaldo;
  return es.map((e) => escribir(t, idioma, e, '')).join(' ');
}
