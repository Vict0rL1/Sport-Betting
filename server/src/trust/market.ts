// Calidad y dispersión del mercado de UN partido, desde los snapshots por casa.
//
// No hay datos de liquidez real (volumen, límites). Esto es un PROXY y se llama así:
// cuántas casas cotizan, cuánto discrepan entre ellas, cuándo se movió el precio por
// última vez, con qué frecuencia y cuánto falta para el partido. Un mercado de dos casas
// que no se ha movido en diez horas informa menos que uno de doce casas actualizado hace
// cinco minutos, y el precio de mercado se interpreta con esa cautela.

import { getDb } from '../db.ts';
import { quotesAt } from '../odds/snapshots.ts';

export interface LineaSeleccion {
  seleccion: string;
  mejor: number;
  mejorCasa: string;
  mediana: number;
  peor: number;
  casas: number;
  /** Diferencia de probabilidad implícita entre la peor y la mejor cuota, en pp. */
  dispersionPp: number;
}

export type NivelMercado = 'ALTA' | 'MEDIA' | 'BAJA' | 'SIN DATOS';

export interface CalidadMercado {
  etiqueta: 'proxy de calidad de mercado (no es liquidez real)';
  calidad: NivelMercado;
  dispersion: 'BAJA' | 'MEDIA' | 'ALTA' | null;
  casas: number;
  lineas: LineaSeleccion[];
  /** Minutos desde el último movimiento de cualquier casa. */
  ultimaActualizacionMin: number | null;
  /** Descargas del evento en las últimas 24 h. */
  observaciones24h: number;
  horasAlInicio: number | null;
  motivos: string[];
}

/** Umbrales del proxy. Elegidos a mano y dichos, no ajustados a datos. */
export const MERCADO_UMBRALES = {
  casasAlta: 8,
  casasMedia: 4,
  dispersionBaja: 2,
  dispersionMedia: 5,
  frescoAltaMin: 60,
  frescoMediaMin: 6 * 60,
};

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function calidadMercado(
  providerEventId: string | null,
  selecciones: string[] | null,
  commence: string,
  now = new Date(),
): CalidadMercado {
  const vacio: CalidadMercado = {
    etiqueta: 'proxy de calidad de mercado (no es liquidez real)',
    calidad: 'SIN DATOS',
    dispersion: null,
    casas: 0,
    lineas: [],
    ultimaActualizacionMin: null,
    observaciones24h: 0,
    horasAlInicio: Math.round(((Date.parse(commence) - now.getTime()) / 3_600_000) * 10) / 10,
    motivos: ['sin cotizaciones por casa guardadas para este partido (sin cuotas reales o aún no descargadas)'],
  };
  if (!providerEventId || !selecciones?.length) return vacio;
  const at = now.toISOString();
  const lineas: LineaSeleccion[] = [];
  let ultima = 0;
  for (const sel of selecciones) {
    const qs = quotesAt(providerEventId, 'h2h', sel, at);
    if (!qs.length) continue;
    const odds = qs.map((q) => q.odds);
    const best = qs.reduce((a, b) => (b.odds > a.odds ? b : a));
    const peor = Math.min(...odds);
    for (const q of qs) ultima = Math.max(ultima, Date.parse(q.observedAt));
    lineas.push({
      seleccion: sel,
      mejor: best.odds,
      mejorCasa: best.bookmaker,
      mediana: mediana(odds),
      peor,
      casas: qs.length,
      dispersionPp: Math.round((1 / peor - 1 / best.odds) * 1000) / 10,
    });
  }
  if (!lineas.length) return vacio;
  const obs = (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM odds_event_observations WHERE event_id = ? AND observed_at > ? AND observed_at <= ?')
      .get(providerEventId, new Date(now.getTime() - 86_400_000).toISOString(), at) as { n: number }
  ).n;
  // La última descarga del evento cuenta como «actualización» aunque ningún precio cambiara:
  // prueba que el precio seguía vigente.
  const ultObs = (
    getDb().prepare('SELECT MAX(observed_at) AS t FROM odds_event_observations WHERE event_id = ? AND observed_at <= ?').get(providerEventId, at) as {
      t: string | null;
    }
  ).t;
  if (ultObs) ultima = Math.max(ultima, Date.parse(ultObs));
  const casas = Math.min(...lineas.map((l) => l.casas));
  const disp = Math.max(...lineas.map((l) => l.dispersionPp));
  const frescoMin = Math.round((now.getTime() - ultima) / 60_000);
  const U = MERCADO_UMBRALES;
  const dispersion = disp <= U.dispersionBaja ? 'BAJA' : disp <= U.dispersionMedia ? 'MEDIA' : 'ALTA';
  const motivos: string[] = [];
  if (casas < U.casasMedia) motivos.push(`solo ${casas} casa(s) cotizan`);
  if (dispersion === 'ALTA') motivos.push(`las casas discrepan ${disp} pp: la probabilidad «del mercado» es menos fiable`);
  if (frescoMin > U.frescoMediaMin) motivos.push(`el precio no se ha observado en ${Math.round(frescoMin / 60)} h`);
  const calidad: NivelMercado =
    casas >= U.casasAlta && dispersion === 'BAJA' && frescoMin <= U.frescoAltaMin
      ? 'ALTA'
      : casas >= U.casasMedia && dispersion !== 'ALTA' && frescoMin <= U.frescoMediaMin
        ? 'MEDIA'
        : 'BAJA';
  return { ...vacio, calidad, dispersion, casas, lineas, ultimaActualizacionMin: frescoMin, observaciones24h: obs, motivos };
}
