// El tema (Fase 5.21): «auto» sigue al sistema; «oscuro» o «claro» lo fijan. Se aplica como
// atributo en <html> para que las variables CSS de index.css cambien; se recuerda en el
// navegador para no parpadear al cargar, y en Ajustes para llevarlo a otros dispositivos.

export type Tema = 'auto' | 'oscuro' | 'claro';
const CLAVE = 'predictor.tema';

export function temaGuardado(): Tema {
  try {
    const v = localStorage.getItem(CLAVE);
    if (v === 'oscuro' || v === 'claro' || v === 'auto') return v;
  } catch {
    // Sin almacenamiento: auto.
  }
  return 'auto';
}

export function aplicarTema(t: Tema): void {
  const html = document.documentElement;
  if (t === 'auto') html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', t);
  try {
    localStorage.setItem(CLAVE, t);
  } catch {
    // Vale para esta visita.
  }
  // El color de la barra del navegador acompaña a la superficie.
  const meta = document.querySelector('meta[name="theme-color"]');
  const claro = t === 'claro' || (t === 'auto' && window.matchMedia?.('(prefers-color-scheme: light)').matches);
  if (meta) meta.setAttribute('content', claro ? '#f4f5f7' : '#0b0d11');
}

/** El tema que está pintado ahora mismo, resuelto (sin «auto»). */
export function temaEfectivo(): 'oscuro' | 'claro' {
  const fijado = document.documentElement.getAttribute('data-theme');
  if (fijado === 'claro' || fijado === 'oscuro') return fijado;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro';
}
