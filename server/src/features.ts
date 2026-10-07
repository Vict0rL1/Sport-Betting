// Los interruptores de funciones (config/features.json).
//
// Una función nueva se entrega detrás de un flag: así se puede apagar sin desplegar código,
// y la pantalla sabe qué enseñar. Las «opcionales» dependen además de una variable de
// entorno (una clave, un secreto): con el flag encendido y la variable vacía, la función
// está DISPONIBLE pero no ACTIVA, y las dos cosas se distinguen aquí para que la pantalla
// pueda decir «falta TOTP_SECRET» en vez de esconder la opción sin explicación.

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './config.ts';

export interface Feature {
  on: boolean;
  descripcion: string;
  /** Variable de entorno de la que depende, si es opcional. */
  opcional?: string;
}

interface Fichero {
  features: Record<string, Feature>;
}

let cache: Record<string, Feature> | null = null;

export function leerFeatures(): Record<string, Feature> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'features.json'), 'utf8')) as Fichero;
    cache = raw.features ?? {};
  } catch {
    // Sin fichero, todo encendido: un despliegue viejo no pierde funciones por no tener
    // el JSON nuevo. Lo que falte sale como «desconocida» en /api/features.
    cache = {};
  }
  return cache;
}

/** Para los tests: olvidar el fichero leído y, opcionalmente, fijar otro contenido. */
export function reiniciarFeatures(forzar?: Record<string, Feature>): void {
  cache = forzar ?? null;
}

/** ¿Está la función encendida? Una función que no está en el fichero cuenta como encendida. */
export function featureEncendida(nombre: string): boolean {
  const f = leerFeatures()[nombre];
  return f ? f.on : true;
}

/** Encendida Y con su variable de entorno presente (si la necesita). */
export function featureActiva(nombre: string, entorno: NodeJS.ProcessEnv = process.env): boolean {
  if (!featureEncendida(nombre)) return false;
  const f = leerFeatures()[nombre];
  if (f?.opcional) return !!entorno[f.opcional]?.trim();
  return true;
}

/** Lo que ve la pantalla: estado de cada flag, sin valores de ninguna variable. */
export function estadoFeatures(entorno: NodeJS.ProcessEnv = process.env): Record<string, { on: boolean; activa: boolean; descripcion: string; falta: string | null }> {
  const out: Record<string, { on: boolean; activa: boolean; descripcion: string; falta: string | null }> = {};
  for (const [k, f] of Object.entries(leerFeatures())) {
    const activa = featureActiva(k, entorno);
    out[k] = { on: f.on, activa, descripcion: f.descripcion, falta: f.on && !activa && f.opcional ? f.opcional : null };
  }
  return out;
}
