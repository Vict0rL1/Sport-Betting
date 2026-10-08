// Caché de respuestas con invalidación por datos (Fase 7.2).
//
// ===========================================================================
// LO QUE SE GUARDA Y CUÁNDO DEJA DE VALER
// ===========================================================================
// Medido antes de esta fase: cada petición a una lista de próximos recalculaba todas las
// predicciones (0,14–0,86 s por petición con la base completa, p95 de hasta 8,6 s con seis a la
// vez). Las predicciones solo cambian cuando cambian sus datos, así que la respuesta se guarda en
// memoria junto a una FIRMA de esos datos y se sirve mientras la firma no cambie:
//
//   PRAGMA data_version     cambia cuando OTRO proceso escribe la base: update-data,
//                           update-results, las ingestas en procesos hijo (ratings, resultados).
//   las filas de próximos   un hash de la tabla entera (son decenas o cientos de filas): cambia
//                           con cada refresco de cuotas, abridor, QB o partido nuevo.
//   lo que se pida además   alineaciones y noticias en fútbol.
//
// Y como mucho dos minutos (`TTL_MS`), por lo que depende de la hora: «empezado», un precio que se
// hace viejo. La primera petición de cada versión calcula como siempre —y registra lo que tenga
// que registrar—; las siguientes sirven exactamente lo mismo. No cambia ninguna probabilidad.

import { createHash } from 'node:crypto';
import { getDb } from '../db.ts';
import { featureEncendida } from '../features.ts';
import { incrementar, fijar } from '../observability/metrics.ts';

export const TTL_MS = 120_000;
/** Entradas como mucho: una por endpoint y combinación de filtros. */
export const MAX_ENTRADAS = 200;

interface Entrada {
  firma: string;
  at: number;
  valor: unknown;
}

const CACHE = new Map<string, Entrada>();
const contadores = { aciertos: 0, fallos: 0, invalidadas: 0 };

/**
 * La firma de los datos de una lista de próximos. Barata a propósito: una consulta a una tabla
 * pequeña y un PRAGMA. Si algo falla, una firma única (no cachea).
 */
export function firmaDe(tablaProximos: string, extras: string[] = []): string {
  try {
    const db = getDb();
    const version = (db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    const filas = db.prepare(`SELECT * FROM ${tablaProximos} ORDER BY id`).all();
    const h = createHash('sha1').update(String(version)).update(JSON.stringify(filas));
    for (const sql of extras) h.update(JSON.stringify(db.prepare(sql).all()));
    return h.digest('base64url');
  } catch {
    return `sin-firma-${Date.now()}-${Math.random()}`;
  }
}

/** La respuesta guardada si la firma coincide y no ha caducado; si no, se calcula y se guarda. */
export function cacheado<T>(clave: string, firma: string, calcular: () => T, ahora = Date.now(), ttl = TTL_MS): T {
  if (!featureEncendida('rendimiento.cacheProximos')) return calcular();
  const e = CACHE.get(clave);
  const grupo = clave.split(':')[0];
  if (e && e.firma === firma && ahora - e.at < ttl) {
    contadores.aciertos++;
    incrementar('cache_respuestas_total', { grupo, resultado: 'acierto' }, 'listas de próximos servidas desde la caché (acierto) o calculadas (fallo)');
    return e.valor as T;
  }
  if (e) contadores.invalidadas++;
  contadores.fallos++;
  incrementar('cache_respuestas_total', { grupo, resultado: 'fallo' }, 'listas de próximos servidas desde la caché (acierto) o calculadas (fallo)');
  const valor = calcular();
  if (CACHE.size >= MAX_ENTRADAS && !CACHE.has(clave)) {
    // La más vieja fuera: el mapa conserva el orden de inserción.
    const primera = CACHE.keys().next().value;
    if (primera !== undefined) CACHE.delete(primera);
  }
  CACHE.delete(clave);
  CACHE.set(clave, { firma, at: ahora, valor });
  fijar('cache_respuestas_entradas', CACHE.size, {}, 'entradas en la caché de respuestas');
  return valor;
}

export function olvidarCache(prefijo = ''): number {
  let n = 0;
  // Borrar mientras se recorre un Map es seguro: las claves ya visitadas no vuelven.
  for (const k of CACHE.keys()) if (k.startsWith(prefijo)) n += Number(CACHE.delete(k));
  return n;
}

export function estadoCache(): { entradas: number; aciertos: number; fallos: number; invalidadas: number } {
  return { entradas: CACHE.size, ...contadores };
}

// ---------------------------------------------------------------------------
// CALENTAR: el ciclo pre-partido (cada 15 minutos) deja calculadas las listas por defecto, así
// que la primera persona que abre una pestaña no paga el cálculo.
// ---------------------------------------------------------------------------
const CALENTADORES = new Map<string, () => unknown>();

export function registrarCalentador(nombre: string, fn: () => unknown): void {
  CALENTADORES.set(nombre, fn);
}

export function calentar(log: (m: string) => void = () => {}): number {
  if (!featureEncendida('rendimiento.cacheProximos')) return 0;
  let n = 0;
  for (const [nombre, fn] of CALENTADORES) {
    try {
      fn();
      n++;
    } catch (e) {
      log(`Caché: no se pudo calentar ${nombre}: ${(e as Error).message}`);
    }
  }
  return n;
}
