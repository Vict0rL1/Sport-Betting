// LAS EXPLICACIONES DE LAS TARJETAS Y LA FICHA, ESTRUCTURADAS (seguimiento del PR #18, fase C).
//
// Antes, cada deporte escribía su titular, sus viñetas y sus avisos de fiabilidad como frases en
// español, y la web las pintaba tal cual también con la interfaz en inglés. Ahora cada frase es un
// CÓDIGO estable con PARÁMETROS tipados (nombres, enteros, porcentajes…). La web la escribe con su
// catálogo (web/src/i18n, claves `explica.<código>`) y el idioma elegido; el servidor sigue
// escribiendo la misma frase en español (`texto`) con su catálogo (./catalogo.ts), para quien lee la API
// (el asistente, los informes, Telegram) y para los clientes de antes.
//
// Reglas:
//   · Se explica lo que el modelo YA calculó: aquí no se calcula nada y nada cambia una probabilidad.
//   · Un dato que falta no se explica con un valor inventado: se elige otro código o no se dice nada.
//   · Los nombres de equipos y jugadores van tal cual (parámetro `txt` o `lista`), en los dos idiomas.
//   · Un código nuevo necesita su frase en el catálogo del servidor y en es.ts y en.ts de la web
//     (lo vigila web/src/i18n/explicaciones.test.ts).

import { EXPLICACIONES, type CodigoExplicacion } from './catalogo.ts';
import { conSigno, num, pct } from '../numeros.ts';

export { EXPLICACIONES, type CodigoExplicacion };

/** Un parámetro con su tipo, para que cada idioma lo escriba con su formato. */
export type ParamExp =
  /** Un nombre (equipo, jugador, superficie ya traducida no: ver `codigo`): tal cual. */
  | { t: 'txt'; v: string }
  /** Un entero sin separador de miles: un Elo (1650), unas victorias. */
  | { t: 'int'; v: number }
  /** Un número con `d` decimales. */
  | { t: 'num'; v: number; d: number }
  /** Un número con signo (+2,8 / −3,6). */
  | { t: 'signo'; v: number; d: number }
  /** Una probabilidad (0–1) como porcentaje con `d` decimales. */
  | { t: 'pct'; v: number; d: number }
  /** Varios nombres, unidos con «y» (o «and»). */
  | { t: 'lista'; v: string[] }
  /** Un entero con separador de miles (7.276 / 7,276). */
  | { t: 'miles'; v: number }
  /**
   * Piezas que son otras explicaciones, unidas con «; » (`pyc`) o «, » (`coma`): las frases que se
   * arman con un número variable de piezas («Forma: A; B», las señales físicas de cada jugador). Cada
   * idioma escribe cada pieza con su catálogo. Una pieza va siempre en medio de la frase: sin mayúscula.
   */
  | { t: 'frases'; v: Explicacion[]; sep: 'pyc' | 'coma' };

export interface Explicacion {
  codigo: CodigoExplicacion;
  params: Record<string, ParamExp>;
}

/** Una explicación con su frase en español, como la escribe el servidor. */
export interface ExplicacionConTexto extends Explicacion {
  texto: string;
}

// Constructores cortos, para que cada deporte se lea igual que antes.
export const txt = (v: string): ParamExp => ({ t: 'txt', v });
export const int = (v: number): ParamExp => ({ t: 'int', v: Math.round(v) });
export const dec = (v: number, d = 1): ParamExp => ({ t: 'num', v, d });
export const signo = (v: number, d = 1): ParamExp => ({ t: 'signo', v, d });
export const porc = (v: number, d = 1): ParamExp => ({ t: 'pct', v, d });
export const lista = (v: string[]): ParamExp => ({ t: 'lista', v });
export const miles = (v: number): ParamExp => ({ t: 'miles', v: Math.round(v) });
/** Piezas que son otras explicaciones (ver `ParamExp`). */
export const frases = (xs: readonly ExplicacionConTexto[], sep: 'pyc' | 'coma'): ParamExp => ({ t: 'frases', v: xs.map(({ codigo, params }) => ({ codigo, params })), sep });
/** Los decimales con que un número se escribe (1,91 → 2; 44,5 → 1; 7 → 0), a lo sumo 4. */
const decimales = (v: number): number => Math.min(4, (String(v).split('.')[1] ?? '').length);
/** Un número con los decimales que trae: una cuota, una línea. */
export const exacto = (v: number): ParamExp => ({ t: 'num', v, d: decimales(v) });
/** Un número con signo y los decimales que trae: una línea de hándicap. */
export const exactoSigno = (v: number): ParamExp => ({ t: 'signo', v, d: decimales(v) });

/** El valor de un parámetro en español, con el formato de numeros.ts (el mismo que la web en español). */
export function valorEs(p: ParamExp): string {
  switch (p.t) {
    case 'txt':
      return p.v;
    case 'int':
      return num(p.v, 0);
    case 'num':
      return num(p.v, p.d);
    case 'signo':
      return conSigno(p.v, p.d);
    case 'pct':
      return pct(p.v, p.d);
    case 'lista':
      return p.v.length <= 1 ? (p.v[0] ?? '') : `${p.v.slice(0, -1).join(', ')} y ${p.v[p.v.length - 1]}`;
    case 'miles':
      return `${p.v < 0 ? '−' : ''}${String(Math.abs(p.v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
    case 'frases':
      return p.v.map((e) => rellenar(EXPLICACIONES[e.codigo], e.params)).join(p.sep === 'pyc' ? '; ' : ', ');
  }
}

/** El número de un parámetro, para elegir el plural; null si no es un número. */
const cuantos = (p: ParamExp | undefined): number | null => (p && (p.t === 'int' || p.t === 'num' || p.t === 'miles') ? p.v : p?.t === 'lista' ? p.v.length : null);

/**
 * Una plantilla con sus parámetros, con las MISMAS reglas que la web (web/src/i18n/index.tsx): `{x}`
 * se cambia por el valor y `{n|uno|varios}` elige por el valor de `n` (1 → «uno»).
 */
export function rellenar(plantilla: string, params: Record<string, ParamExp>, valor: (p: ParamExp) => string = valorEs): string {
  let s = plantilla.replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (todo, k: string, uno: string, varios: string) => {
    const n = cuantos(params[k]);
    return n == null ? todo : n === 1 ? uno : varios;
  });
  for (const [k, p] of Object.entries(params)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), () => valor(p));
  return s;
}

/** Una explicación: su código, sus parámetros y su frase en español. */
export function explica(codigo: CodigoExplicacion, params: Record<string, ParamExp> = {}): ExplicacionConTexto {
  return { codigo, params, texto: rellenar(EXPLICACIONES[codigo], params) };
}

/** Las frases en español de unas explicaciones (lo que la API devuelve en `bullets` y `reasons`). */
export const textos = (xs: readonly ExplicacionConTexto[]): string[] => xs.map((x) => x.texto);

/** Sin la frase: lo que va en la API junto a ella (el cliente la escribe en su idioma). */
export const sinTexto = ({ codigo, params }: ExplicacionConTexto): Explicacion => ({ codigo, params });

/** El resumen de una predicción: las frases de siempre y, al lado, sus códigos. */
export interface Resumen {
  headline: string;
  bullets: string[];
  /** Lo mismo, estructurado: la web lo escribe en su idioma. Falta en respuestas de antes. */
  explicaciones: { headline: Explicacion; bullets: Explicacion[] };
}

export function resumen(headline: ExplicacionConTexto, bullets: readonly ExplicacionConTexto[]): Resumen {
  return { headline: headline.texto, bullets: textos(bullets), explicaciones: { headline: sinTexto(headline), bullets: bullets.map(sinTexto) } };
}

/** Los avisos de fiabilidad: las frases de siempre (`reasons`) y sus códigos. */
export function motivos(xs: readonly ExplicacionConTexto[]): { reasons: string[]; explicaciones: Explicacion[] } {
  return { reasons: textos(xs), explicaciones: xs.map(sinTexto) };
}
