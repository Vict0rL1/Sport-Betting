// Lo que la capa de confianza necesita saber de un partido, igual para los cinco deportes.
//
// Cada deporte lo rellena desde SU predicción (trust/adapters.ts): ninguna cifra se
// inventa aquí. Lo que el deporte no sabe (lesiones de la NBA, el tiempo en la NFL…)
// llega como 'desconocido', no como un valor por defecto.

import type { SportId } from '../sports.ts';

/** Un factor del modelo, en las unidades del propio modelo, a favor del resultado 0. */
export interface Factor {
  clave: string;
  etiqueta: string;
  /** Puntos a favor del local / jugador 1 (Elo, o puntos de margen en la NFL). */
  puntos: number;
  /**
   * El rango PLAUSIBLE de este factor, como multiplicadores de su valor [bajo, alto].
   * [0, 1.5] = «puede no existir, o ser un 50 % mayor». Cada deporte justifica el suyo.
   */
  rango: [number, number];
  /** Por qué ese rango (se enseña). */
  porQue: string;
}

export type EstadoDato = 'ok' | 'aviso' | 'desconocido';

/** Un elemento de la calidad de datos, con los puntos que vale y los que se llevó. */
export interface ItemDato {
  estado: EstadoDato;
  texto: string;
  /** Puntos que vale. Los 'desconocido' no cuentan: la app no tiene esa fuente. */
  max: number;
  /** Puntos obtenidos (0 en aviso, max en ok, parcial si se indica). */
  puntos: number;
}

export interface Ood {
  grave: boolean;
  texto: string;
}

export interface EventoConfianza {
  sport: SportId;
  matchKey: string;
  eventId: string | null;
  commence: string;
  outcomes: string[];
  /** La probabilidad ENSEÑADA, por resultado. */
  probs: number[];
  factores: Factor[];
  /**
   * Cuánto mueve un punto de factor el logit del resultado 0 cerca de este partido.
   * Exacto en tenis y NBA (curvas logísticas en Elo); aproximado en el resto.
   */
  pendiente: number;
  pendienteExacta: boolean;
  /** Desviación típica del hueco de rating, en las unidades de los factores (de la fiabilidad). */
  sigmaHueco: number | null;
  /** Banda de fiabilidad de la app (±1σ de ruido de rating), en pp, y su nivel. */
  fiabilidad: { nivel: string; margenPp: number; motivos: string[] };
  /** Modelos o componentes que existen de verdad, con su probabilidad de cada resultado. */
  componentes: { nombre: string; probs: number[] }[];
  datos: ItemDato[];
  ood: Ood[];
  regimen: { etiqueta: string; nota: string | null };
  /** Cuotas de la fila de próximos (consenso) y cuándo se descargaron. */
  odds: number[] | null;
  oddsAt: string | null;
  books: number | null;
  /** El evento en el proveedor de cuotas, para leer sus casas en los snapshots. */
  providerEventId: string | null;
  /** Los nombres de las selecciones en el proveedor (orden de `outcomes`). */
  providerSelections: string[] | null;
  /** ¿Es un partido de demostración? Entonces nada de esto describe un mercado real. */
  demo: boolean;
}
