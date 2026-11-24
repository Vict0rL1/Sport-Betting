// «Lo que usó el modelo» (fase C, 5): las entradas que cada instantánea guardó, en el idioma elegido.
//
// Las instantáneas (prediction_snapshots) son filas inmutables y guardan cada entrada con su etiqueta
// en español («rating de Kansas City Chiefs»). Aquí no se lee esa frase: cada entrada se escribe por
// su CLAVE (prematch/adapters.ts) y los nombres del partido, que la instantánea guarda en `outcomes`.
// El código solo se adjunta si, escrito en español, dice EXACTAMENTE la etiqueta guardada; si no (una
// clave nueva, una etiqueta de otra época), la entrada se enseña tal cual se guardó.

import { explica, sinTexto, txt, type CodigoExplicacion, type Explicacion } from './index.ts';

/** Qué código escribe cada clave, por deporte, y de qué participante habla (el primero o el último). */
const ENTRADAS: Record<string, Record<string, { codigo: CodigoExplicacion; de?: 'primero' | 'ultimo' }>> = {
  tennis: {
    superficie: { codigo: 'entrada.superficie' },
    eloP1: { codigo: 'entrada.eloEfectivo', de: 'primero' },
    eloP2: { codigo: 'entrada.eloEfectivo', de: 'ultimo' },
    formaP1: { codigo: 'entrada.forma', de: 'primero' },
    formaP2: { codigo: 'entrada.forma', de: 'ultimo' },
    h2h: { codigo: 'entrada.caraACara' },
    inactP1: { codigo: 'entrada.inactividad', de: 'primero' },
    inactP2: { codigo: 'entrada.inactividad', de: 'ultimo' },
  },
  football: {
    eloLocal: { codigo: 'entrada.elo', de: 'primero' },
    eloVisit: { codigo: 'entrada.elo', de: 'ultimo' },
    bajasLocal: { codigo: 'entrada.bajas', de: 'primero' },
    bajasVisit: { codigo: 'entrada.bajas', de: 'ultimo' },
    onceLocal: { codigo: 'entrada.once', de: 'primero' },
    onceVisit: { codigo: 'entrada.once', de: 'ultimo' },
  },
  basketball: {
    eloLocal: { codigo: 'entrada.elo', de: 'primero' },
    eloVisit: { codigo: 'entrada.elo', de: 'ultimo' },
    descansoLocal: { codigo: 'entrada.descanso', de: 'primero' },
    descansoVisit: { codigo: 'entrada.descanso', de: 'ultimo' },
  },
  baseball: {
    eloLocal: { codigo: 'entrada.elo', de: 'primero' },
    eloVisit: { codigo: 'entrada.elo', de: 'ultimo' },
    abridorLocal: { codigo: 'entrada.abridor', de: 'primero' },
    abridorVisit: { codigo: 'entrada.abridor', de: 'ultimo' },
  },
  nfl: {
    eloLocal: { codigo: 'entrada.rating', de: 'primero' },
    eloVisit: { codigo: 'entrada.rating', de: 'ultimo' },
    qbLocal: { codigo: 'entrada.qb', de: 'primero' },
    qbVisit: { codigo: 'entrada.qb', de: 'ultimo' },
    techo: { codigo: 'entrada.techo' },
  },
  nhl: {
    eloLocal: { codigo: 'entrada.elo', de: 'primero' },
    eloVisit: { codigo: 'entrada.elo', de: 'ultimo' },
    lineaTotal: { codigo: 'entrada.lineaTotal' },
  },
  ufc: {
    eloA: { codigo: 'entrada.elo', de: 'primero' },
    eloB: { codigo: 'entrada.elo', de: 'ultimo' },
    edad: { codigo: 'entrada.edad' },
    alcance: { codigo: 'entrada.alcance' },
  },
};

export interface EntradaConCodigo {
  clave: string;
  /** La etiqueta tal como se guardó (en español). */
  etiqueta: string;
  valor: unknown;
  /** La misma etiqueta como código, o null si el código no la reproduce exactamente. */
  explicacion: Explicacion | null;
}

export function entradasConCodigo(sport: string, entradas: Record<string, { etiqueta: string; valor: unknown }>, outcomes: readonly string[]): EntradaConCodigo[] {
  const primero = outcomes[0];
  const ultimo = outcomes[outcomes.length - 1];
  return Object.entries(entradas).map(([clave, e]) => {
    const regla = ENTRADAS[sport]?.[clave];
    const quien = regla?.de === 'primero' ? primero : regla?.de === 'ultimo' ? ultimo : undefined;
    const x = regla && (regla.de == null || quien != null) ? explica(regla.codigo, quien != null ? { quien: txt(quien) } : {}) : null;
    return { clave, etiqueta: e.etiqueta, valor: e.valor, explicacion: x && x.texto === e.etiqueta ? sinTexto(x) : null };
  });
}
