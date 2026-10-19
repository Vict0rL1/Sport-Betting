// «Atrás» vuelve a la altura a la que se dejó la pantalla (L7, lote L).
//
// El navegador lo intenta solo, pero al volver la lista aún no ha cargado sus datos: la página mide
// poco, la posición se recorta y se queda ahí (medido: dejada a 4.732 px, vuelta a 301). Aquí se
// reintenta en cada fotograma hasta que la pantalla tiene alto para llegar, y se deja de intentar
// en cuanto la persona toca, desplaza o teclea: no se le pelea el dedo.
//
// Y mientras dura, el navegador no recoloca la página (N10, lote N). Alcanzada la altura, las
// secciones de encima seguían llegando, y el anclaje del navegador, para no mover lo que se veía,
// bajaba la página lo que crecían: en Confianza, 1.500 px, y el enlace quedaba fuera de la
// pantalla. Sin anclaje, la página vuelve a medir lo que medía al irse y la altura cae donde debe.
// Sin anclaje hasta que la persona toca, desplaza o teclea, o 10 s: con la red de un móvil, lo de
// encima puede tardar más de los 3 s que hay para llegar a la altura, y la página no avisa de que
// espera algo (medido: parada 4 s esperando a la evaluación, sin crecer).

export interface EntornoDesplazamiento {
  /** Hasta dónde se puede bajar ahora mismo (alto del documento menos el de la ventana). */
  maximo: () => number;
  ir: (y: number) => void;
  fotograma: (f: () => void) => number;
  cancelarFotograma: (id: number) => void;
  temporizador: (f: () => void, ms: number) => number;
  cancelarTemporizador: (id: number) => void;
  /** Escucha lo que hace la persona (rueda, toque, tecla); devuelve cómo dejar de escuchar. */
  alInteractuar: (f: () => void) => () => void;
  /** Si el navegador recoloca la página cuando cambia lo de encima (`overflow-anchor`). */
  anclar: (si: boolean) => void;
}

export function entornoDeVentana(): EntornoDesplazamiento {
  return {
    maximo: () => document.documentElement.scrollHeight - window.innerHeight,
    ir: (y) => window.scrollTo(0, y),
    fotograma: (f) => window.requestAnimationFrame(f),
    cancelarFotograma: (id) => window.cancelAnimationFrame(id),
    temporizador: (f, ms) => window.setTimeout(f, ms),
    cancelarTemporizador: (id) => window.clearTimeout(id),
    alInteractuar: (f) => {
      const opciones = { passive: true } as const;
      window.addEventListener('wheel', f, opciones);
      window.addEventListener('touchstart', f, opciones);
      window.addEventListener('keydown', f);
      return () => {
        window.removeEventListener('wheel', f);
        window.removeEventListener('touchstart', f);
        window.removeEventListener('keydown', f);
      };
    },
    anclar: (si) => {
      document.documentElement.style.overflowAnchor = si ? '' : 'none';
    },
  };
}

/**
 * Lleva la página a `y` en cuanto tenga alto para ello (hasta `limiteMs`), y no la vuelve a mover.
 * Hasta que la persona toca, o `topeMs`, el navegador no la recoloca. Devuelve cómo parar.
 */
export function volverA(y: number, entorno: EntornoDesplazamiento, limiteMs = 3000, topeMs = 10_000): () => void {
  let fin = false;
  let marco: number | null = null;
  const parar = () => {
    if (fin) return;
    fin = true;
    if (marco != null) entorno.cancelarFotograma(marco);
    entorno.cancelarTemporizador(reloj);
    entorno.cancelarTemporizador(tope);
    dejarDeEscuchar();
    entorno.anclar(true);
  };
  const intentar = () => {
    marco = null;
    if (fin) return;
    const max = entorno.maximo();
    entorno.ir(Math.min(y, Math.max(0, max)));
    // Alcanzada, no se vuelve a mover: lo que llegue después ya no la recoloca (sin anclaje).
    if (max >= y - 1) return entorno.cancelarTemporizador(reloj);
    marco = entorno.fotograma(intentar);
  };
  entorno.anclar(false);
  const dejarDeEscuchar = entorno.alInteractuar(parar);
  const reloj = entorno.temporizador(parar, limiteMs);
  const tope = entorno.temporizador(parar, topeMs);
  marco = entorno.fotograma(intentar);
  return parar;
}

// Lo que mide cada día de una lista larga en cada entrada del historial (N1, lote N). Un día no se
// pinta hasta que se acerca a la pantalla (`.seccion-dia`, content-visibility), y mientras reserva
// 900 px. Al volver con «atrás», la lista se monta de nuevo: los días de fuera de la pantalla
// reservaban 900 px y no lo que medían al irse, y la altura guardada caía en otro partido (en
// Tenis con seis días, 2.800 px más abajo). Con lo que medían, la página vuelve a medir lo mismo.
const altosDeSecciones = new Map<string, number>();

export function recordarAltoDeSeccion(id: string, alto: number): void {
  if (alto > 0) altosDeSecciones.set(id, Math.round(alto));
}

export function altoDeSeccion(id: string): number | undefined {
  return altosDeSecciones.get(id);
}
