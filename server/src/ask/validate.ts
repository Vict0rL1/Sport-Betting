// La lista permitida del asistente: qué herramientas existen y qué argumentos aceptan.
//
// Es la única puerta entre lo que un modelo de lenguaje (o una expresión regular) decide y
// lo que se ejecuta. El modelo NUNCA produce SQL ni código: produce un nombre de
// herramienta y unos argumentos, y aquí se comprueba que el nombre está en la lista cerrada
// y que cada argumento tiene el tipo, el tamaño y los valores que esa herramienta admite.
// Lo que no encaja se convierte en `ninguna` («no te he entendido»), no en un error que
// filtre nada.
//
// Las consultas de tools.ts van parametrizadas (`?`), así que un argumento con SQL dentro
// es solo una cadena que no coincide con ningún jugador. Esta validación es la segunda
// capa: acota tamaños y valores para que ni una cadena de 10 MB ni un número negativo
// lleguen a la base.

import type { Intencion } from './router.ts';

export const HERRAMIENTAS_PERMITIDAS = ['jugador', 'caraACara', 'prediccion', 'clasificacion', 'estadoDatos', 'precision', 'ninguna'] as const;
export type Herramienta = (typeof HERRAMIENTAS_PERMITIDAS)[number];

export const MAX_TEXTO = 80;
export const SUPERFICIES = ['dura', 'tierra', 'hierba'] as const;
export const TOURS = ['atp', 'wta'] as const;
export const CLASIFICACION_MAX = 50;

const NINGUNA: Intencion = { herramienta: 'ninguna', argumentos: [] };

/** Una cadena corta, sin caracteres de control; null si no sirve. */
function texto(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  if (t.length === 0 || t.length > MAX_TEXTO) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

function superficie(x: unknown): string {
  const t = typeof x === 'string' ? x.trim().toLowerCase() : '';
  const mapa: Record<string, string> = { dura: 'dura', hard: 'dura', tierra: 'tierra', arcilla: 'tierra', clay: 'tierra', hierba: 'hierba', grass: 'hierba' };
  return mapa[t] ?? 'dura';
}

function tour(x: unknown): string {
  return x === 'wta' || (typeof x === 'string' && x.trim().toLowerCase() === 'wta') ? 'wta' : 'atp';
}

function entero(x: unknown, min: number, max: number, def: number): number {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Normaliza cualquier cosa a una intención válida. Nunca lanza.
 *
 * Acepta tanto la forma interna (`argumentos` como lista) como la del modelo (`input` como
 * objeto con nombres), porque las dos acaban aquí.
 */
export function validarIntencion(x: unknown): Intencion {
  if (!x || typeof x !== 'object') return NINGUNA;
  const o = x as { herramienta?: unknown; name?: unknown; argumentos?: unknown; input?: unknown };
  const nombre = typeof o.herramienta === 'string' ? o.herramienta : typeof o.name === 'string' ? o.name : '';
  if (!(HERRAMIENTAS_PERMITIDAS as readonly string[]).includes(nombre)) return NINGUNA;
  const h = nombre as Herramienta;
  const lista = Array.isArray(o.argumentos) ? o.argumentos : null;
  const obj = o.input && typeof o.input === 'object' && !Array.isArray(o.input) ? (o.input as Record<string, unknown>) : null;
  const arg = (i: number, clave: string): unknown => (lista ? lista[i] : obj ? obj[clave] : undefined);

  switch (h) {
    case 'jugador': {
      const n = texto(arg(0, 'nombre'));
      return n ? { herramienta: h, argumentos: [n] } : NINGUNA;
    }
    case 'caraACara': {
      const a = texto(arg(0, 'a'));
      const b = texto(arg(1, 'b'));
      return a && b ? { herramienta: h, argumentos: [a, b] } : NINGUNA;
    }
    case 'prediccion': {
      const a = texto(arg(0, 'a'));
      const b = texto(arg(1, 'b'));
      return a && b ? { herramienta: h, argumentos: [a, b, superficie(arg(2, 'superficie'))] } : NINGUNA;
    }
    case 'clasificacion':
      return { herramienta: h, argumentos: [String(entero(arg(0, 'n'), 1, CLASIFICACION_MAX, 10)), tour(arg(1, 'tour'))] };
    case 'estadoDatos':
    case 'precision':
      return { herramienta: h, argumentos: [] };
    default:
      return NINGUNA;
  }
}
