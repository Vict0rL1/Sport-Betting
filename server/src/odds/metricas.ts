// Qué hizo de verdad una ejecución de cuotas (auditoría del 17 de octubre, punto 5).
//
// ingestion_runs guardaba «ok» y el número de PRÓXIMOS de la lista. Con eso, 16 horas de
// ejecuciones «ok» sin ningún snapshot nuevo no se podían explicar: ¿las cuotas no cambiaron (se
// guarda solo lo que cambia: odds/snapshots.ts), la API devolvió una lista vacía, no se llegó a
// pedir (demostración, el freno de presupuesto), o guardar falló (el error iba a stderr y nada más)?
//
// Aquí, por ejecución: peticiones hechas y fallidas, eventos devueltos, cuotas vistas, cuántas
// cambiaron, cuántos snapshots y observaciones se guardaron, la marca más nueva de la fuente
// (last_update de las casas) y el error al guardar, si lo hubo. Quedan en ingestion_runs.metrics
// (JSON), en rows_added (snapshots guardados) y en una línea legible en `detail`. Un fallo al
// guardar convierte la ejecución en error: las cuotas se descargaron, pero el histórico no las tiene.
//
// Se recogen con AsyncLocalStorage: requestOdds anota en la ejecución en curso sin que los siete
// refrescos tengan que pasar nada. Fuera de una ejecución (el doctor, un test) no anota nada.

import { AsyncLocalStorage } from 'node:async_hooks';
import { conRegistro } from '../ingest/runs.ts';

export interface MetricasCuotas {
  /** Respuestas buenas de la API. */
  peticiones: number;
  /** Peticiones que fallaron o que el freno de presupuesto no dejó hacer. */
  fallidas: number;
  ultimoFallo: string | null;
  eventos: number;
  malformados: number;
  /** Cuotas (casa × mercado × selección) que trajeron las respuestas. */
  cotizaciones: number;
  /** De ellas, las que eran nuevas o distintas de la última guardada. */
  cambiadas: number;
  snapshots: number;
  retiradas: number;
  observaciones: number;
  /** El last_update más nuevo de las casas en las respuestas: cuán frescas eran las cuotas. */
  fuenteMasNueva: string | null;
  errorGuardando: string | null;
  /** Lo que devolvió el refresco: próximos en la lista y de dónde (live, fixture…). */
  proximos?: number;
  fuente?: string;
}

const vacias = (): MetricasCuotas => ({
  peticiones: 0, fallidas: 0, ultimoFallo: null, eventos: 0, malformados: 0, cotizaciones: 0,
  cambiadas: 0, snapshots: 0, retiradas: 0, observaciones: 0, fuenteMasNueva: null, errorGuardando: null,
});

const actual = new AsyncLocalStorage<MetricasCuotas>();

/** Suma a la ejecución en curso (si la hay). */
export function anotarCuotas(d: Partial<Omit<MetricasCuotas, 'fuenteMasNueva' | 'errorGuardando' | 'ultimoFallo'>> & { fuenteMasNueva?: string | null; errorGuardando?: string; ultimoFallo?: string }): void {
  const m = actual.getStore();
  if (!m) return;
  for (const k of ['peticiones', 'fallidas', 'eventos', 'malformados', 'cotizaciones', 'cambiadas', 'snapshots', 'retiradas', 'observaciones'] as const) {
    if (d[k]) m[k] += d[k] as number;
  }
  if (d.fuenteMasNueva && (!m.fuenteMasNueva || Date.parse(d.fuenteMasNueva) > Date.parse(m.fuenteMasNueva))) m.fuenteMasNueva = d.fuenteMasNueva;
  if (d.errorGuardando) m.errorGuardando = d.errorGuardando;
  if (d.ultimoFallo) m.ultimoFallo = d.ultimoFallo;
}

/** La línea de `detail`: qué se pidió, qué llegó, qué cambió y qué se guardó. */
export function detalleCuotas(m: MetricasCuotas): string {
  const cab = `${m.fuente ?? '—'}: ${m.proximos ?? '—'} próximos`;
  if (m.peticiones === 0 && m.fallidas === 0) return `${cab} · ninguna petición a la API`;
  const partes = [
    `${m.peticiones} petición(es), ${m.eventos} evento(s), ${m.cotizaciones} cuota(s) vistas, ${m.cambiadas} cambiadas → ${m.snapshots} guardadas`,
    m.fallidas ? `${m.fallidas} fallida(s)${m.ultimoFallo ? ` (${m.ultimoFallo})` : ''}` : '',
    m.peticiones > 0 && m.eventos === 0 ? 'la API no devolvió ningún evento' : '',
    m.eventos > 0 && m.cambiadas === 0 && !m.errorGuardando ? 'sin cambios desde la última' : '',
    m.fuenteMasNueva ? `la más nueva de las casas, ${m.fuenteMasNueva}` : '',
    m.errorGuardando ? `NO SE GUARDARON: ${m.errorGuardando}` : '',
  ].filter(Boolean);
  return `${cab} · ${partes.join(' · ')}`;
}

/**
 * Un refresco de cuotas con su registro: conRegistro + las métricas. `fn` devuelve lo de siempre
 * (count y source, si los tiene); el registro guarda lo que de verdad pasó.
 */
export async function registrarCuotas<T extends { count?: number; source?: string } | number>(source: string, fn: () => Promise<T>): Promise<T> {
  const m = vacias();
  let r!: T;
  await conRegistro(source, async () => {
    r = await actual.run(m, fn);
    if (typeof r === 'number') m.proximos = r;
    else {
      m.proximos = r.count;
      m.fuente = r.source;
    }
    const resultado = { rowsAdded: m.snapshots, rowsUpdated: m.observaciones, detail: detalleCuotas(m), metricas: m };
    if (m.errorGuardando) throw Object.assign(new Error(`cuotas descargadas que no se guardaron en el histórico: ${m.errorGuardando}`), { metricas: m });
    return resultado;
  });
  return r;
}
