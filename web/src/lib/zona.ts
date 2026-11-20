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
