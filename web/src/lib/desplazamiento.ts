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
//
// Y si se sabe qué enlace se tocó al irse, lo que se sostiene es ese enlace (N15, lote N): se deja
// donde estaba en la pantalla aunque lo de encima aún no haya llegado, y lo que llegue después se
// compensa antes de pintarse. Con solo la altura, mientras llegaba lo de encima se veía otra
// sección, y al llegar la página saltaba 1.000 px hasta el enlace. Mientras se sostiene, si la
// página se mueve sin que la mueva esto (la barra de desplazamiento, la propia página), se deja.

/** El enlace que se tocó al irse (N15): cuál era y dónde estaba en la pantalla. */
export interface EnlaceTocado {
  /** Su `href`, tal cual está escrito. */
  href: string;
  /** Cuál de los enlaces con ese `href` era, y cuántos había: si al volver no hay los mismos, no se sabe cuál es. */
  indice: number;
  total: number;
  /** A cuántos px de lo alto de la pantalla estaba. */
  top: number;
  /** Dónde estaba la página. */
  y: number;
}

export interface EntornoDesplazamiento {
  /** Hasta dónde se puede bajar ahora mismo (alto del documento menos el de la ventana). */
  maximo: () => number;
  ir: (y: number) => void;
  /** Dónde está la página ahora. */
  actual: () => number;
  /** A cuántos px de lo alto de la pantalla está ese enlace; null si no está, o no se sabe cuál es. */
  posicionDe: (enlace: EnlaceTocado) => number | null;
  fotograma: (f: () => void) => number;
  cancelarFotograma: (id: number) => void;
  temporizador: (f: () => void, ms: number) => number;
  cancelarTemporizador: (id: number) => void;
  /** Escucha lo que hace la persona (rueda, toque, clic, tecla); devuelve cómo dejar de escuchar. */
  alInteractuar: (f: () => void) => () => void;
  /** Si el navegador recoloca la página cuando cambia lo de encima (`overflow-anchor`). */
  anclar: (si: boolean) => void;
}

/** Los enlaces de la página con ese `href`, en el orden en que están. */
const conHref = (href: string) => Array.from(document.links).filter((a) => a.getAttribute('href') === href);

export function entornoDeVentana(): EntornoDesplazamiento {
  return {
    maximo: () => document.documentElement.scrollHeight - window.innerHeight,
    ir: (y) => window.scrollTo(0, y),
    actual: () => window.scrollY,
    posicionDe: (e) => {
      const iguales = conHref(e.href);
      if (iguales.length !== e.total) return null;
      const r = iguales[e.indice].getBoundingClientRect();
      // Uno que no se pinta (en un panel plegado) mide 0 y está «arriba del todo»: no sirve.
      return r.width || r.height ? r.top : null;
    },
    fotograma: (f) => window.requestAnimationFrame(f),
    cancelarFotograma: (id) => window.cancelAnimationFrame(id),
    temporizador: (f, ms) => window.setTimeout(f, ms),
    cancelarTemporizador: (id) => window.clearTimeout(id),
    alInteractuar: (f) => {
      const opciones = { passive: true } as const;
      window.addEventListener('wheel', f, opciones);
      window.addEventListener('touchstart', f, opciones);
      window.addEventListener('pointerdown', f, opciones);
      window.addEventListener('keydown', f);
      return () => {
        window.removeEventListener('wheel', f);
        window.removeEventListener('touchstart', f);
        window.removeEventListener('pointerdown', f);
        window.removeEventListener('keydown', f);
      };
    },
    anclar: (si) => {
      document.documentElement.style.overflowAnchor = si ? '' : 'none';
    },
  };
}

/**
 * El enlace que se acaba de tocar, para volver a dejarlo donde estaba (N15). Uno que no se mueve con
 * la página (la barra de pestañas, la cabecera pegada) no dice dónde se estaba: null.
 */
export function enlaceTocado(objetivo: EventTarget | null): EnlaceTocado | null {
  const a = objetivo instanceof Element ? objetivo.closest('a[href]') : null;
  const href = a?.getAttribute('href');
  if (!a || !href) return null;
  for (let el: Element | null = a; el; el = el.parentElement) {
    const { position } = getComputedStyle(el);
    if (position === 'fixed' || position === 'sticky') return null;
  }
  const iguales = conHref(href);
  const indice = iguales.indexOf(a as HTMLAnchorElement);
  if (indice < 0) return null;
  return { href, indice, total: iguales.length, top: a.getBoundingClientRect().top, y: window.scrollY };
}

export interface OpcionesVuelta {
  /** El enlace que se tocó al irse: si está, se deja donde estaba en la pantalla (N15). */
  ancla?: EnlaceTocado;
  /** Cuánto se intenta llegar. */
  limiteMs?: number;
  /** Cuánto se sostiene, si la persona no toca antes. */
  topeMs?: number;
}

/**
 * Lleva la página a `y` en cuanto tenga alto para ello (hasta `limiteMs`), y no la vuelve a mover.
 * Con `ancla`, en cuanto el enlace está, lo deja donde estaba en la pantalla y lo sostiene ahí.
 * Hasta que la persona toca, o `topeMs`, el navegador no la recoloca. Devuelve cómo parar.
 */
export function volverA(y: number, entorno: EntornoDesplazamiento, { ancla, limiteMs = 3000, topeMs = 10_000 }: OpcionesVuelta = {}): () => void {
  let fin = false;
  let marco: number | null = null;
  /** Ya llegó (a la altura, o el enlace a su sitio): desde ahí se sostiene. */
  let llegada = false;
  /** Dónde la dejó el último fotograma. */
  let dejada = 0;
  const parar = () => {
    if (fin) return;
    fin = true;
    if (marco != null) entorno.cancelarFotograma(marco);
    entorno.cancelarTemporizador(reloj);
    entorno.cancelarTemporizador(tope);
    dejarDeEscuchar();
    entorno.anclar(true);
  };
  const llegar = () => {
    if (!llegada) entorno.cancelarTemporizador(reloj);
    llegada = true;
  };
  const intentar = () => {
    marco = null;
    if (fin) return;
    // Sostenida, si la página está en otro sitio la ha movido otro (la barra de desplazamiento, la
    // propia página): no se le pelea.
    if (llegada && Math.abs(entorno.actual() - dejada) >= 1) return parar();
    const top = ancla ? entorno.posicionDe(ancla) : null;
    if (top != null) {
      // El enlace, donde estaba en la pantalla: lo de encima que llegue se compensa aquí, antes de pintarse.
      const desvio = top - ancla!.top;
      if (Math.abs(desvio) >= 2) entorno.ir(Math.max(0, entorno.actual() + desvio));
      llegar();
    } else if (!llegada) {
      const max = entorno.maximo();
      entorno.ir(Math.min(y, Math.max(0, max)));
      if (max >= y - 1) {
        llegar();
        // Alcanzada, no se vuelve a mover: lo que llegue después ya no la recoloca (sin anclaje).
        // Con enlace, se sigue mirando por si aparece.
        if (!ancla) return;
      }
    }
    dejada = entorno.actual();
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
