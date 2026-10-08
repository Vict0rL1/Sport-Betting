// Clima para la NFL y la MLB desde Open-Meteo (gratis, sin clave): previsión a T-24h, T-6h y
// T-1h, y la observación real después del partido. Coordenadas en config/stadiums.json.
//
// LO QUE NO HACE, A PROPÓSITO. No toca ninguna probabilidad publicada. El modelo de la NFL
// acepta viento (model.ts), pero pasarle la previsión cambiaría lo que enseña la app fuera del
// registro de experimentos, y esa es una regla del proyecto. Aquí solo se OBSERVA y se guarda:
// cada partido acumula lo que se sabía a cada hora, y la Fase 4 podrá medir, con cientos de
// partidos, si el viento previsto mejora algo. En la ficha se enseña como información, con
// DESCONOCIDO cuando no hay dato, nunca inventado.

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../config.ts';
import { getDb } from '../db.ts';

export type Techo = 'outdoors' | 'retractable' | 'dome';
export interface Estadio {
  name: string;
  city: string;
  lat: number;
  lon: number;
  roof: Techo;
}
export type DeporteClima = 'nfl' | 'baseball';

interface FicheroEstadios {
  nfl: Record<string, Estadio>;
  mlb: Record<string, Estadio>;
}

let cache: FicheroEstadios | null = null;
export function estadios(): FicheroEstadios {
  if (!cache) cache = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'stadiums.json'), 'utf8')) as FicheroEstadios;
  return cache;
}

/** El estadio del equipo local, si está en la configuración. */
export function estadioDe(sport: DeporteClima, league: string, homeId: string | null): Estadio | null {
  if (!homeId) return null;
  const f = estadios();
  if (sport === 'nfl' && league === 'nfl') return f.nfl[homeId] ?? null;
  if (sport === 'baseball' && league === 'mlb') return f.mlb[homeId] ?? null;
  return null;
}

export const HORIZONTES = [
  { nombre: 'T-24h', horas: 24 },
  { nombre: 'T-6h', horas: 6 },
  { nombre: 'T-1h', horas: 1 },
] as const;
export type Horizonte = (typeof HORIZONTES)[number]['nombre'] | 'final';
/** La observación «final» se pide cuando el partido lleva al menos esto acabado. */
export const FINAL_TRAS_HORAS = 4;

/**
 * Qué horizontes toca pedir ahora: cada uno una vez, en cuanto se cruza su marca (y mientras
 * el partido no haya empezado); «final» cuando ya pasó. Pura, para poder probarla.
 */
export function horizontesPendientes(commence: string, ahora: Date, hechos: Set<string>): Horizonte[] {
  const inicio = Date.parse(commence);
  if (!Number.isFinite(inicio)) return [];
  const out: Horizonte[] = [];
  const faltan = (inicio - ahora.getTime()) / 3_600_000;
  if (faltan > 0) {
    for (const h of HORIZONTES) if (faltan <= h.horas && !hechos.has(h.nombre)) out.push(h.nombre);
  } else if (-faltan >= FINAL_TRAS_HORAS && !hechos.has('final')) {
    out.push('final');
  }
  return out;
}

export interface Lectura {
  tempC: number | null;
  vientoMph: number | null;
  lluviaMm: number | null;
  probLluvia: number | null;
  codigo: number | null;
}

type Fetch = typeof fetch;

function diaUtc(iso: string): string {
  return iso.slice(0, 10);
}

/** Lee de la respuesta horaria de Open-Meteo la hora que corresponde al partido. */
export function leerHora(data: unknown, targetIso: string): Lectura | null {
  const d = data as { hourly?: Record<string, unknown[]> } | null;
  const horas = d?.hourly?.time as string[] | undefined;
  if (!Array.isArray(horas) || horas.length === 0) return null;
  const objetivo = targetIso.slice(0, 13); // YYYY-MM-DDTHH
  const i = horas.findIndex((t) => String(t).slice(0, 13) === objetivo);
  if (i < 0) return null;
  const num = (k: string): number | null => {
    const v = (d!.hourly as Record<string, unknown[]>)[k]?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return { tempC: num('temperature_2m'), vientoMph: num('wind_speed_10m'), lluviaMm: num('precipitation'), probLluvia: num('precipitation_probability'), codigo: num('weather_code') };
}

const VARIABLES = 'temperature_2m,wind_speed_10m,precipitation,precipitation_probability,weather_code';
const VARIABLES_ARCHIVO = 'temperature_2m,wind_speed_10m,precipitation,weather_code';

export function urlPrevision(e: Estadio, targetIso: string): string {
  const dia = diaUtc(targetIso);
  return `https://api.open-meteo.com/v1/forecast?latitude=${e.lat}&longitude=${e.lon}&hourly=${VARIABLES}&wind_speed_unit=mph&timezone=UTC&start_date=${dia}&end_date=${dia}`;
}
export function urlObservado(e: Estadio, targetIso: string): string {
  const dia = diaUtc(targetIso);
  return `https://archive-api.open-meteo.com/v1/archive?latitude=${e.lat}&longitude=${e.lon}&hourly=${VARIABLES_ARCHIVO}&wind_speed_unit=mph&timezone=UTC&start_date=${dia}&end_date=${dia}`;
}

/** Null si la fuente falla o no trae esa hora: nunca se inventa una lectura. */
export async function consultar(e: Estadio, targetIso: string, kind: 'prevision' | 'observado', f: Fetch = fetch): Promise<Lectura | null> {
  try {
    const res = await f(kind === 'prevision' ? urlPrevision(e, targetIso) : urlObservado(e, targetIso));
    if (!res.ok) return null;
    return leerHora(await res.json(), targetIso);
  } catch {
    return null;
  }
}

/** Códigos WMO → texto corto en español. */
export function descripcionCodigo(c: number | null): string {
  if (c == null) return 'sin dato';
  if (c === 0) return 'despejado';
  if (c <= 2) return 'poco nuboso';
  if (c === 3) return 'cubierto';
  if (c <= 48) return 'niebla';
  if (c <= 57) return 'llovizna';
  if (c <= 67) return 'lluvia';
  if (c <= 77) return 'nieve';
  if (c <= 82) return 'chubascos';
  if (c <= 86) return 'chubascos de nieve';
  return 'tormenta';
}

interface FilaUpcoming {
  id: string;
  league: string;
  commence_time: string;
  home_id: string | null;
}

export interface ResultadoCiclo {
  consultados: number;
  guardados: number;
  fallidos: number;
  sinEstadio: number;
}

/**
 * Un ciclo: para cada partido próximo (o recién acabado) de la NFL y la MLB con estadio
 * conocido, pedir los horizontes que toquen y guardarlos. Techos cerrados también se
 * registran: un `dome` con viento fuera es un dato (el viento no entra) y además la
 * temperatura exterior sí dice algo del público y del césped en los retráctiles.
 */
export async function cicloClima(opts: { ahora?: Date; fetch?: Fetch; log?: (m: string) => void } = {}): Promise<ResultadoCiclo> {
  const ahora = opts.ahora ?? new Date();
  const f = opts.fetch ?? fetch;
  const db = getDb();
  const desde = new Date(ahora.getTime() - 12 * 3_600_000).toISOString();
  const hasta = new Date(ahora.getTime() + 25 * 3_600_000).toISOString();
  const filas: { sport: DeporteClima; fila: FilaUpcoming }[] = [];
  const nfl = db.prepare("SELECT id, league, commence_time, home_id FROM naf_upcoming WHERE league = 'nfl' AND source <> 'fixture' AND commence_time BETWEEN ? AND ?").all(desde, hasta) as unknown as FilaUpcoming[];
  const mlb = db.prepare("SELECT id, league, commence_time, home_id FROM bsb_upcoming WHERE league = 'mlb' AND source <> 'fixture' AND commence_time BETWEEN ? AND ?").all(desde, hasta) as unknown as FilaUpcoming[];
  for (const x of nfl) filas.push({ sport: 'nfl', fila: x });
  for (const x of mlb) filas.push({ sport: 'baseball', fila: x });
  const hechosDe = db.prepare('SELECT horizon FROM weather_observations WHERE sport = ? AND match_key = ?');
  const ins = db.prepare(
    `INSERT OR IGNORE INTO weather_observations (sport, match_key, stadium_id, kind, horizon, target_time, fetched_at, temp_c, wind_mph, precip_mm, precip_prob, weather_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const r: ResultadoCiclo = { consultados: 0, guardados: 0, fallidos: 0, sinEstadio: 0 };
  for (const { sport, fila } of filas) {
    const e = estadioDe(sport, fila.league, fila.home_id);
    if (!e) {
      r.sinEstadio++;
      continue;
    }
    const hechos = new Set((hechosDe.all(sport, fila.id) as unknown as { horizon: string }[]).map((x) => x.horizon));
    for (const h of horizontesPendientes(fila.commence_time, ahora, hechos)) {
      const kind = h === 'final' ? 'observado' : 'prevision';
      r.consultados++;
      const l = await consultar(e, fila.commence_time, kind, f);
      if (!l) {
        r.fallidos++;
        continue;
      }
      ins.run(sport, fila.id, fila.home_id, kind, h, fila.commence_time, ahora.toISOString(), l.tempC, l.vientoMph, l.lluviaMm, l.probLluvia, l.codigo);
      r.guardados++;
    }
  }
  opts.log?.(`Clima: ${r.consultados} consulta(s), ${r.guardados} guardada(s), ${r.fallidos} fallida(s), ${r.sinEstadio} partido(s) sin estadio conocido.`);
  return r;
}

export interface ClimaFicha {
  estado: 'previsión' | 'observado' | 'DESCONOCIDO';
  horizonte: Horizonte | null;
  estadio: { nombre: string; ciudad: string; techo: Techo } | null;
  tempC: number | null;
  vientoMph: number | null;
  lluviaMm: number | null;
  probLluvia: number | null;
  descripcion: string | null;
  fechaDato: string | null;
  motivo: string | null;
}

/** Lo que enseña la ficha: la lectura más reciente, o DESCONOCIDO con el porqué. */
export function climaDe(sport: DeporteClima, league: string, matchKey: string, homeId: string | null): ClimaFicha {
  const e = estadioDe(sport, league, homeId);
  const base = { estadio: e ? { nombre: e.name, ciudad: e.city, techo: e.roof } : null };
  if (!e) return { estado: 'DESCONOCIDO', horizonte: null, ...base, tempC: null, vientoMph: null, lluviaMm: null, probLluvia: null, descripcion: null, fechaDato: null, motivo: 'estadio no configurado' };
  const fila = getDb()
    .prepare('SELECT kind, horizon, temp_c, wind_mph, precip_mm, precip_prob, weather_code, fetched_at FROM weather_observations WHERE sport = ? AND match_key = ? ORDER BY id DESC LIMIT 1')
    .get(sport, matchKey) as { kind: 'prevision' | 'observado'; horizon: Horizonte; temp_c: number | null; wind_mph: number | null; precip_mm: number | null; precip_prob: number | null; weather_code: number | null; fetched_at: string } | undefined;
  if (!fila) return { estado: 'DESCONOCIDO', horizonte: null, ...base, tempC: null, vientoMph: null, lluviaMm: null, probLluvia: null, descripcion: null, fechaDato: null, motivo: 'todavía sin previsión (se pide desde 24 h antes)' };
  return {
    estado: fila.kind === 'observado' ? 'observado' : 'previsión',
    horizonte: fila.horizon,
    ...base,
    tempC: fila.temp_c,
    vientoMph: fila.wind_mph,
    lluviaMm: fila.precip_mm,
    probLluvia: fila.precip_prob,
    descripcion: descripcionCodigo(fila.weather_code),
    fechaDato: fila.fetched_at,
    motivo: null,
  };
}
