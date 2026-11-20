// La zona horaria con la que se leen las horas y se cortan los días (rediseño de noviembre, D3/TZ-1).
// La del navegador, salvo que la persona fije otra en Ajustes. Se guarda en este navegador: es cómo
// quiere VER las horas en este aparato, no un dato de la cuenta.
import { zonaDelNavegador } from './explorador';

export const CLAVE_ZONA = 'predictor.zona';

/** ¿Es una zona IANA que este navegador entiende? */
export function zonaValida(z: string | null | undefined): z is string {
  if (!z) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

export function leerZona(): string {
  try {
    const z = localStorage.getItem(CLAVE_ZONA);
    if (zonaValida(z)) return z;
  } catch {
    // Sin almacenamiento: la del navegador.
  }
  return zonaDelNavegador();
}

/** null vuelve a la del navegador. */
export function guardarZona(z: string | null): void {
  try {
    if (z && zonaValida(z)) localStorage.setItem(CLAVE_ZONA, z);
    else localStorage.removeItem(CLAVE_ZONA);
  } catch {
    // No poder recordarla no impide usarla ahora.
  }
}

/**
 * Un instante formateado en la zona elegida (G1 de la revisión del PR 17: la zona vale en toda la
 * app, no solo en Partidos). Una fecha que no se entiende sale «—» (no «Invalid Date» ni una
 * excepción); una zona que el navegador no entiende cae a la del navegador.
 */
export function formatearInstante(iso: string | Date, locale: string, opciones: Intl.DateTimeFormatOptions, zona: string = leerZona()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '—';
  const z = zonaValida(zona) ? zona : zonaDelNavegador();
  try {
    return new Intl.DateTimeFormat(locale, { ...opciones, timeZone: opciones.timeZone ?? z }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale, opciones).format(d);
  }
}
