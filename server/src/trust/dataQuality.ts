// La calidad de datos de UNA predicción: una lista, no una nota opaca.
//
// Cada elemento dice qué se comprobó, cómo salió y cuántos puntos vale. La puntuación es
// puntos obtenidos / puntos posibles × 100, y los elementos DESCONOCIDOS (la app no tiene
// esa fuente: lesiones de la NBA, el tiempo en la NFL, el bullpen…) se listan pero no
// cuentan: penalizarlos bajaría todos los partidos por igual y no distinguiría ninguno.
// Se dicen igual, para que nadie crea que se miraron.
//
// Los pesos los fija cada deporte en trust/adapters.ts y están elegidos a mano según lo
// que el propio proyecto ha medido que mueve la fiabilidad (sobre todo, cuántos partidos
// hay detrás de cada rating). No están ajustados a datos.

import type { ItemDato } from './types.ts';

export const ok = (texto: string, max: number): ItemDato => ({ estado: 'ok', texto, max, puntos: max });
export const aviso = (texto: string, max: number, puntos = 0): ItemDato => ({ estado: 'aviso', texto, max, puntos });
export const desconocido = (texto: string): ItemDato => ({ estado: 'desconocido', texto, max: 0, puntos: 0 });

/** Un dato graduado: completo por encima de `lleno`, la mitad entre `medio` y `lleno`. */
export function graduado(valor: number, medio: number, lleno: number, max: number, texto: (v: number) => string): ItemDato {
  if (valor >= lleno) return ok(texto(valor), max);
  if (valor >= medio) return aviso(texto(valor), max, max / 2);
  return aviso(texto(valor), max);
}

/** Frescura de las cuotas (común a los cinco). */
export function cuotasRecientes(oddsAt: string | null, demo: boolean, now = new Date()): ItemDato {
  if (demo) return aviso('Cuotas de demostración: no hay precio real', 15);
  if (!oddsAt) return aviso('Sin cuotas para este partido', 15);
  const h = (now.getTime() - Date.parse(oddsAt)) / 3_600_000;
  return h <= 6
    ? ok(`Cuotas recientes (hace ${h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`})`, 15)
    : aviso(`Cuotas viejas: hace ${h.toFixed(0)} h`, 15);
}

/** El archivo de resultados al día (común a los cinco). */
export function archivoAlDia(fechaDatos: string | null, now = new Date()): ItemDato {
  if (!fechaDatos) return aviso('No se sabe hasta cuándo llega el archivo de resultados', 10);
  const d = (now.getTime() - Date.parse(fechaDatos)) / 86_400_000;
  return d <= 10
    ? ok(`Resultados al día (último del archivo: ${fechaDatos.slice(0, 10)})`, 10)
    : aviso(`El archivo de resultados acaba el ${fechaDatos.slice(0, 10)} (hace ${Math.round(d)} días)`, 10);
}

export interface CalidadDatos {
  puntuacion: number;
  items: ItemDato[];
  explicacion: string;
}

export function puntuar(items: ItemDato[]): CalidadDatos {
  const posibles = items.reduce((a, i) => a + i.max, 0);
  const obtenidos = items.reduce((a, i) => a + i.puntos, 0);
  const desconocidos = items.filter((i) => i.estado === 'desconocido').length;
  return {
    puntuacion: posibles ? Math.round((obtenidos / posibles) * 100) : 0,
    items,
    explicacion:
      `${obtenidos.toFixed(0)} de ${posibles} puntos posibles.` +
      (desconocidos ? ` ${desconocidos} dato(s) marcados DESCONOCIDO no cuentan: la app no tiene esa fuente.` : ''),
  };
}
