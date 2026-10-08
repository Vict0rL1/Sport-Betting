// La política de apuestas, versionada (Fase 3.5).
//
// Los umbrales (ventaja mínima, fracción de Kelly, topes por evento/día/liga, reglas de
// abstención y recortes) eran constantes en el código. Ahora viven en `policy_versions`, una
// tabla append-only del libro mayor: la v1 se siembra con exactamente los valores de las
// constantes, así que migrar no cambia ninguna decisión; editar crea una versión nueva, y
// cada apuesta de papel y cada señal guardan bajo qué versión se evaluaron.
//
// Lo que NO es: no es un sitio para tocar el modelo. Las probabilidades no pasan por aquí.

import { createHash } from 'node:crypto';
import { getDb } from '../db.ts';
import { DEFAULT_CONFIG, type StakingConfig } from './policy.ts';
import { ABSTENCION, RECORTES } from '../trust/decision.ts';
import { featureEncendida } from '../features.ts';

export interface Politica {
  staking: StakingConfig;
  abstencion: typeof ABSTENCION;
  recortes: typeof RECORTES;
  /** Topes por grupo de correlación (equipo/jugador), fracción del banco. */
  grupos: { maxSameTeamExposure: number; maxSamePlayerExposure: number };
}

export interface VersionPolitica {
  id: number;
  created_at: string;
  parent_id: number | null;
  hash: string;
  nota: string | null;
  origen: string;
  config: Politica;
}

export type CambiosPolitica = {
  staking?: Partial<StakingConfig>;
  abstencion?: Partial<typeof ABSTENCION>;
  recortes?: Partial<typeof RECORTES>;
  grupos?: Partial<Politica['grupos']>;
};

/** La política «de fábrica»: las constantes del código, tal cual. */
export function politicaPorDefecto(): Politica {
  return {
    staking: { ...DEFAULT_CONFIG },
    abstencion: { ...ABSTENCION },
    recortes: { ...RECORTES },
    grupos: { maxSameTeamExposure: 0.03, maxSamePlayerExposure: 0.03 },
  };
}

const canonico = (x: unknown): string => JSON.stringify(x, Object.keys(x as object).sort());
const hashDe = (p: Politica) => createHash('sha256').update(JSON.stringify(p, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v))).digest('hex').slice(0, 16);
void canonico;

function fraccion(nombre: string, v: unknown, min = 0, max = 1): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`${nombre}: ${String(v)} no es un número entre ${min} y ${max}`);
}

/** Lanza si la política no tiene sentido. */
export function validarPolitica(p: Politica): void {
  if (![0.25, 0.2].includes(p.staking.kellyFraction)) throw new Error(`staking.kellyFraction: ${p.staking.kellyFraction} no es 0.25 ni 0.2 (las dos que están medidas)`);
  fraccion('staking.maxPerEvent', p.staking.maxPerEvent, 0.001, 0.25);
  fraccion('staking.dailyLossLimit', p.staking.dailyLossLimit, 0.005, 0.5);
  fraccion('staking.weeklyLossLimit', p.staking.weeklyLossLimit, 0.01, 0.8);
  fraccion('staking.minEdge', p.staking.minEdge, 0, 0.5);
  fraccion('staking.maxTotalExposure', p.staking.maxTotalExposure, 0.01, 1);
  fraccion('staking.maxExposurePerDay', p.staking.maxExposurePerDay, 0.01, 1);
  fraccion('staking.maxExposurePerLeague', p.staking.maxExposurePerLeague, 0.01, 1);
  if (p.staking.maxExposurePerDay > p.staking.maxTotalExposure) throw new Error('staking.maxExposurePerDay no puede superar maxTotalExposure');
  fraccion('abstencion.calidadDatosMin', p.abstencion.calidadDatosMin, 0, 100);
  fraccion('abstencion.desapareceMax', p.abstencion.desapareceMax, 0, 1);
  fraccion('abstencion.precioViejoHoras', p.abstencion.precioViejoHoras, 0, 168);
  for (const [k, v] of Object.entries(p.recortes)) fraccion(`recortes.${k}`, v, 0, 1);
  fraccion('grupos.maxSameTeamExposure', p.grupos.maxSameTeamExposure, 0.001, 0.5);
  fraccion('grupos.maxSamePlayerExposure', p.grupos.maxSamePlayerExposure, 0.001, 0.5);
}

let cache: VersionPolitica | null = null;

function fila(r: { id: number; created_at: string; parent_id: number | null; config: string; hash: string; nota: string | null; origen: string }): VersionPolitica {
  return { id: r.id, created_at: r.created_at, parent_id: r.parent_id, hash: r.hash, nota: r.nota, origen: r.origen, config: JSON.parse(r.config) as Politica };
}

/** Siembra la v1 si no hay ninguna (con las constantes, para que nada cambie al migrar). */
function asegurarSemilla(): void {
  const db = getDb();
  const hay = db.prepare('SELECT 1 FROM policy_versions LIMIT 1').get();
  if (hay) return;
  const p = politicaPorDefecto();
  db.prepare("INSERT INTO policy_versions (created_at, parent_id, config, hash, nota, origen) VALUES (?, NULL, ?, ?, 'valores de fábrica (las constantes del código)', 'seed')").run(new Date().toISOString(), JSON.stringify(p), hashDe(p));
}

/** La versión vigente: la última. Cacheada por proceso; una versión nueva la invalida. */
export function politicaVigente(): VersionPolitica {
  if (cache) return cache;
  asegurarSemilla();
  const r = getDb().prepare('SELECT * FROM policy_versions ORDER BY id DESC LIMIT 1').get() as Parameters<typeof fila>[0];
  cache = fila(r);
  return cache;
}

/** Lo que leen el banco, la capa de confianza y los topes: la vigente, o las constantes si el interruptor está apagado. */
export function politica(): Politica {
  if (!featureEncendida('politica.versionada')) return politicaPorDefecto();
  try {
    return politicaVigente().config;
  } catch {
    return politicaPorDefecto();
  }
}

export function idPoliticaVigente(): number | null {
  if (!featureEncendida('politica.versionada')) return null;
  try {
    return politicaVigente().id;
  } catch {
    return null;
  }
}

export function historial(limite = 50): VersionPolitica[] {
  asegurarSemilla();
  return (getDb().prepare('SELECT * FROM policy_versions ORDER BY id DESC LIMIT ?').all(Math.min(500, limite)) as Parameters<typeof fila>[0][]).map(fila);
}

/** Una versión nueva a partir de la vigente con los cambios; valida; nunca reescribe. */
export function nuevaVersion(cambios: CambiosPolitica, nota: string | null, origen: 'api' | 'cli' | 'seed' = 'api', ahora = new Date()): VersionPolitica {
  const base = politicaVigente();
  const p: Politica = {
    staking: { ...base.config.staking, ...cambios.staking },
    abstencion: { ...base.config.abstencion, ...cambios.abstencion },
    recortes: { ...base.config.recortes, ...cambios.recortes },
    grupos: { ...base.config.grupos, ...cambios.grupos },
  };
  for (const [grupo, valores] of Object.entries(cambios)) {
    if (!(grupo in p)) throw new Error(`grupo desconocido: ${grupo} (usa staking, abstencion, recortes o grupos)`);
    for (const k of Object.keys(valores ?? {})) if (!(k in (base.config as unknown as Record<string, Record<string, unknown>>)[grupo])) throw new Error(`${grupo}.${k}: clave desconocida`);
  }
  validarPolitica(p);
  const hash = hashDe(p);
  if (hash === base.hash) throw new Error('la política resultante es idéntica a la vigente: no se crea una versión nueva');
  const r = getDb().prepare('INSERT INTO policy_versions (created_at, parent_id, config, hash, nota, origen) VALUES (?, ?, ?, ?, ?, ?)').run(ahora.toISOString(), base.id, JSON.stringify(p), hash, nota, origen);
  cache = null;
  return { id: Number(r.lastInsertRowid), created_at: ahora.toISOString(), parent_id: base.id, hash, nota, origen, config: p };
}

/** Para los tests. */
export function olvidarPolitica(): void {
  cache = null;
}
