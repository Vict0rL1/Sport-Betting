// La densidad de la lista de Partidos (fase C de la revisión del PR 17): cómoda (escudos, hora de la
// estimación a la vista, más aire) o compacta (más partidos por pantalla). Es una preferencia de
// este navegador, como la zona y el tema: no va en la URL ni la quita «Quitar filtros».

export type Densidad = 'comoda' | 'compacta';
export const CLAVE_DENSIDAD = 'predictor.densidad';

export function leerDensidad(): Densidad {
  try {
    return localStorage.getItem(CLAVE_DENSIDAD) === 'compacta' ? 'compacta' : 'comoda';
  } catch {
    return 'comoda';
  }
}

export function guardarDensidad(d: Densidad): void {
  try {
    localStorage.setItem(CLAVE_DENSIDAD, d);
  } catch {
    // No poder recordarla no impide usarla ahora.
  }
}
