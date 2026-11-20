// Datos remotos con un estado que no miente (B3, revisión del PR 17). Antes, si /api/guardadas
// fallaba, el botón de la ficha decía «Guardar» (como si no estuviera guardada) y el filtro
// «Guardados» de Partidos perdía en silencio las estimaciones guardadas. Aquí cada carga dice en qué
// fase está, y un refresco que falla conserva lo último bueno y su hora.

export type Remoto<T> =
  | { fase: 'inicial' }
  | { fase: 'cargando' }
  /** 404: la función está apagada (features.json); no es un error ni una lista vacía. */
  | { fase: 'apagado' }
  /** La primera carga falló: no hay datos, ni vacíos ni inventados. */
  | { fase: 'error'; status: number }
  | { fase: 'listo'; datos: T; actualizadoEn: number }
  | { fase: 'actualizando'; datos: T; actualizadoEn: number }
  /** Un refresco falló: se siguen enseñando los datos de `actualizadoEn`, y se dice. */
  | { fase: 'error-refresco'; datos: T; actualizadoEn: number; status: number };

export const REMOTO_INICIAL = <T>(): Remoto<T> => ({ fase: 'inicial' });

export function alPedir<T>(e: Remoto<T>): Remoto<T> {
  if (e.fase === 'listo' || e.fase === 'actualizando' || e.fase === 'error-refresco') return { fase: 'actualizando', datos: e.datos, actualizadoEn: e.actualizadoEn };
  return { fase: 'cargando' };
}

export function alRecibir<T>(_e: Remoto<T>, datos: T, ahora: number): Remoto<T> {
  return { fase: 'listo', datos, actualizadoEn: ahora };
}

/** `status` 0 = sin respuesta (red). */
export function alFallar<T>(e: Remoto<T>, status: number): Remoto<T> {
  if (e.fase === 'listo' || e.fase === 'actualizando' || e.fase === 'error-refresco') return { fase: 'error-refresco', datos: e.datos, actualizadoEn: e.actualizadoEn, status };
  if (status === 404) return { fase: 'apagado' };
  return { fase: 'error', status };
}

/** Los datos buenos que haya (también durante un refresco o tras uno fallido), o null. */
export function datosDe<T>(e: Remoto<T>): T | null {
  return e.fase === 'listo' || e.fase === 'actualizando' || e.fase === 'error-refresco' ? e.datos : null;
}

/** ¿Hay un problema que enseñar? (la primera carga o un refresco fallaron). */
export const conProblema = (e: Remoto<unknown>): boolean => e.fase === 'error' || e.fase === 'error-refresco';

/**
 * ¿Está guardada esta instantánea? Su id si sí, null si los datos dicen que no, undefined si no se
 * sabe (cargando, apagado o error de la primera carga).
 */
export function estaGuardada(e: Remoto<{ id: number; sport: string; snapshot_id: number }[]>, sport: string, snapshotId: number): number | null | undefined {
  const d = datosDe(e);
  if (!d) return undefined;
  return d.find((g) => g.sport === sport && g.snapshot_id === snapshotId)?.id ?? null;
}

/** Un fallo de carga con su código: 0 = sin respuesta, −1 = respuesta con una forma inesperada. */
export class ErrorDeCarga extends Error {
  constructor(public status: number) {
    super(`carga fallida (${status})`);
  }
}

/**
 * GET de JSON que no se traga los fallos: un código distinto de 2xx o una respuesta con otra forma
 * (que `extraer` rechaza lanzando) es un ErrorDeCarga, nunca una lista vacía.
 */
export async function pedirJson<T>(url: string, extraer: (j: unknown) => T, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErrorDeCarga(0);
  }
  if (!r.ok) throw new ErrorDeCarga(r.status);
  let j: unknown;
  try {
    j = await r.json();
  } catch {
    throw new ErrorDeCarga(-1);
  }
  try {
    return extraer(j);
  } catch {
    throw new ErrorDeCarga(-1);
  }
}
