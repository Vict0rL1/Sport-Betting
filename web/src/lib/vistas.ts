// Vistas guardadas de Partidos (E2 de la revisión del PR 17): una combinación de filtros con nombre.
// Se guardan en este navegador, como la densidad o la zona: son una forma de mirar, no datos de la
// cuenta. Se guarda la consulta tal cual, así que «hoy» y «mañana» siguen siendo relativos y una
// fecha elegida a mano se queda fija. El panel abierto no forma parte de la vista.

export interface Vista {
  id: string;
  nombre: string;
  /** La consulta de /partidos, sin el panel. */
  consulta: string;
  creada: string;
}

export const CLAVE_VISTAS = 'predictor.vistas';
export const MAX_VISTAS_PUBLICO = 20;

/** Un error de vista con su código: la pantalla lo traduce (vistas.error.*). */
export class ErrorDeVista extends Error {
  constructor(public codigo: 'nombre-vacio' | 'nombre-repetido' | 'demasiadas') {
    super(codigo);
  }
}
const MAX_VISTAS = 20;
const NO_SE_GUARDA = ['panel', 'panelClave'];

export function leerVistas(): Vista[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_VISTAS) ?? '[]') as unknown;
    return Array.isArray(v) ? (v.filter((x) => x && typeof x.id === 'string' && typeof x.nombre === 'string' && typeof x.consulta === 'string') as Vista[]) : [];
  } catch {
    return [];
  }
}

function escribir(vs: Vista[]): void {
  try {
    localStorage.setItem(CLAVE_VISTAS, JSON.stringify(vs));
  } catch {
    // Sin almacenamiento: la vista vale mientras dure la página.
  }
}

const limpiar = (n: string) => n.trim().replace(/\s+/g, ' ').slice(0, 60);
const igual = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

export function guardarVista(nombre: string, q: URLSearchParams, ahora = new Date()): Vista {
  const n = limpiar(nombre);
  if (!n) throw new ErrorDeVista('nombre-vacio');
  const vs = leerVistas();
  if (vs.some((v) => igual(v.nombre, n))) throw new ErrorDeVista('nombre-repetido');
  if (vs.length >= MAX_VISTAS) throw new ErrorDeVista('demasiadas');
  const c = new URLSearchParams(q);
  for (const k of NO_SE_GUARDA) c.delete(k);
  const v: Vista = { id: `${ahora.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, nombre: n, consulta: c.toString(), creada: ahora.toISOString() };
  escribir([...vs, v]);
  return v;
}

export function renombrarVista(id: string, nombre: string): void {
  const n = limpiar(nombre);
  if (!n) throw new ErrorDeVista('nombre-vacio');
  const vs = leerVistas();
  if (vs.some((v) => v.id !== id && igual(v.nombre, n))) throw new ErrorDeVista('nombre-repetido');
  escribir(vs.map((v) => (v.id === id ? { ...v, nombre: n } : v)));
}

export function quitarVista(id: string): void {
  escribir(leerVistas().filter((v) => v.id !== id));
}

export const consultaDeVista = (v: Vista): URLSearchParams => new URLSearchParams(v.consulta);
