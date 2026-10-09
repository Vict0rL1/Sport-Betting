// Ayudas compartidas por los e2e (no es un fichero de tests).
import type { Page } from '@playwright/test';

/**
 * Los errores de la página: de consola y sin capturar. TODOS: antes se descartaba «Failed to load
 * resource», que es justo como sale un 500 de la API (E3 de la revisión del 8 de octubre).
 */
export function recogerErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(`${m.text()} ${m.location().url}`);
  });
  page.on('pageerror', (e) => errores.push(e.message));
  return errores;
}
