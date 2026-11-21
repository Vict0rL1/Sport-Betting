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
 * Un DÍA de calendario (no un instante) como fecha local a medianoche, para formatearlo sin que la
 * zona lo mueva (G1). Acepta «2026-11-20», «20261120» y la medianoche UTC con que el servidor manda
 * los días («2026-11-20T00:00:00.000Z»): formateada como instante, al oeste de UTC salía el 19.
 * null si no es un día válido o lleva otra hora (eso es un instante: `formatearInstante`).
 */
export function diaDeCalendario(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T00:00:00(?:\.0+)?Z)?$/.exec(s.trim());
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(a, me - 1, d);
  return f.getFullYear() === a && f.getMonth() === me - 1 && f.getDate() === d ? f : null;
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
