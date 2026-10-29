// Lo que se precarga cuando la app está ociosa (K5, lote K): los trozos de las pestañas. Así
// cambiar de deporte no espera a la red (con la de un móvil, el primer cambio enseñaba «Cargando…»
// 1,2 s) y, sin ella (la máquina de Fly parada, el metro), un deporte que no se había abierto
// todavía se abre: lo único que falta son sus datos, y eso lo dice cada pantalla.

export interface EntornoOcioso {
  /** «Ahorro de datos» del navegador: con él no se baja nada que no se haya pedido. */
  ahorro: boolean;
  /** Sin red, precargar solo dejaría fallos guardados. */
  enLinea: boolean;
  enReposo?: (f: () => void, o: { timeout: number }) => number;
  cancelarReposo?: (id: number) => void;
  temporizador: (f: () => void, ms: number) => number;
  cancelarTemporizador: (id: number) => void;
}

export function entornoDelNavegador(): EntornoOcioso {
  const conexion = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return {
    ahorro: !!conexion?.saveData,
    enLinea: navigator.onLine !== false,
    enReposo: typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback.bind(window) : undefined,
    cancelarReposo: typeof window.cancelIdleCallback === 'function' ? window.cancelIdleCallback.bind(window) : undefined,
    temporizador: (f, ms) => window.setTimeout(f, ms),
    cancelarTemporizador: (id) => window.clearTimeout(id),
  };
}

/**
 * Lanza `tarea` cuando el navegador esté ocioso, o a los `espera` ms como mucho (Safari no tiene
 * `requestIdleCallback`: allí, un temporizador). Devuelve cómo cancelarla.
 */
export function cuandoOciosa(tarea: () => void, entorno: EntornoOcioso, espera = 2000): () => void {
  if (entorno.ahorro || !entorno.enLinea) return () => undefined;
  if (entorno.enReposo) {
    const id = entorno.enReposo(tarea, { timeout: espera });
    return () => entorno.cancelarReposo?.(id);
  }
  const id = entorno.temporizador(tarea, espera);
  return () => entorno.cancelarTemporizador(id);
}

/** Pide cada trozo. Un fallo no rompe nada: al abrir la pestaña se vuelve a pedir. */
export function precargar(cargas: readonly (() => Promise<unknown>)[]): void {
  for (const c of cargas) void c().catch(() => undefined);
}
