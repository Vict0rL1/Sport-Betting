// Carga del bullpen (MLB Stats API, sin clave): qué relevistas lanzó cada equipo en los últimos
// días y cuántos lanzamientos llevan. Un bullpen que tiró 120 lanzamientos ayer no es el mismo
// bullpen que uno descansado, y hoy la ficha no lo sabía.
//
// SOLO MEJORA LA FICHA Y LA CALIDAD DE DATOS. No entra en ninguna probabilidad: cualquier uso
// en el modelo pasa por el registro de experimentos (Fase 4), como manda la regla del proyecto.
//
// Dos llamadas: el calendario de los últimos N días (una petición) y el boxscore de cada
// partido (una por partido; ~15 al día). En el boxscore, `teams.<lado>.pitchers` lista los
// lanzadores en orden de aparición: el primero es el abridor y el resto, el bullpen.
// statsapi.mlb.com no es alcanzable desde el entorno donde se escribió esto: los tests simulan
// sus respuestas con la forma real del JSON, y el cliente falla con el campo que faltó.

import { getDb } from '../../db.ts';
import { baseballConfig } from '../../config.ts';

export const BULLPEN_SCHEMA = `
  CREATE TABLE IF NOT EXISTS bsb_bullpen (
    league          TEXT NOT NULL,
    team_id         TEXT NOT NULL,
    as_of_date      TEXT NOT NULL,     -- YYYYMMDD: el día para el que vale la carga
    pitcher_id      TEXT NOT NULL,
    pitcher_name    TEXT NOT NULL,
    appearances_3d  INTEGER NOT NULL,
    pitches_1d      INTEGER NOT NULL,
    pitches_3d      INTEGER NOT NULL,
    fetched_at      TEXT NOT NULL,
    PRIMARY KEY (league, team_id, as_of_date, pitcher_id)
  );
  CREATE INDEX IF NOT EXISTS idx_bullpen_team ON bsb_bullpen (league, team_id, as_of_date);
`;

/** Códigos de MLB → Retrosheet, donde difieren (la misma tabla que mlbStatsApi.ts). */
const MLB_TO_RETROSHEET: Record<string, string> = {
  AZ: 'ARI', CWS: 'CHA', CHC: 'CHN', KC: 'KCA', LAD: 'LAN', LAA: 'ANA',
  NYY: 'NYA', NYM: 'NYN', SD: 'SDN', SF: 'SFN', STL: 'SLN', TB: 'TBA',
  WSH: 'WAS', ATH: 'ATH',
};
export function codigoRetrosheet(abbr: string): string {
  const a = (abbr ?? '').toUpperCase();
  return MLB_TO_RETROSHEET[a] ?? a;
}

type Fetch = typeof fetch;

export interface AparicionRelevista {
  teamId: string;
  pitcherId: string;
  nombre: string;
  fecha: string; // YYYYMMDD
  lanzamientos: number;
}

/** Del boxscore de un partido, las apariciones de relevistas (todos menos el primero de cada lado). */
export function relevistasDeBoxscore(box: unknown, fecha: string): AparicionRelevista[] {
  const b = box as { teams?: Record<'home' | 'away', { team?: { abbreviation?: string }; pitchers?: number[]; players?: Record<string, { person?: { id?: number; fullName?: string }; stats?: { pitching?: { numberOfPitches?: number; pitchesThrown?: number } } }> }> } | null;
  const out: AparicionRelevista[] = [];
  for (const lado of ['home', 'away'] as const) {
    const t = b?.teams?.[lado];
    const abbr = t?.team?.abbreviation;
    const pitchers = t?.pitchers;
    if (!abbr || !Array.isArray(pitchers)) throw new Error(`boxscore sin teams.${lado}.team.abbreviation o teams.${lado}.pitchers`);
    for (const id of pitchers.slice(1)) {
      const p = t.players?.[`ID${id}`];
      const st = p?.stats?.pitching;
      const lanzamientos = Number(st?.numberOfPitches ?? st?.pitchesThrown ?? 0);
      out.push({ teamId: codigoRetrosheet(abbr), pitcherId: String(id), nombre: p?.person?.fullName ?? `#${id}`, fecha, lanzamientos: Number.isFinite(lanzamientos) ? lanzamientos : 0 });
    }
  }
  return out;
}

export interface CargaRelevista {
  teamId: string;
  pitcherId: string;
  nombre: string;
  apariciones3d: number;
  lanzamientos1d: number;
  lanzamientos3d: number;
}

/** Agrega apariciones por equipo y relevista. `hoy` en YYYYMMDD; «1d» = ayer. */
export function agregarCarga(apariciones: AparicionRelevista[], hoy: string): CargaRelevista[] {
  const ayer = diaMenos(hoy, 1);
  const m = new Map<string, CargaRelevista>();
  for (const a of apariciones) {
    const k = `${a.teamId}|${a.pitcherId}`;
    const c = m.get(k) ?? { teamId: a.teamId, pitcherId: a.pitcherId, nombre: a.nombre, apariciones3d: 0, lanzamientos1d: 0, lanzamientos3d: 0 };
    c.apariciones3d++;
    c.lanzamientos3d += a.lanzamientos;
    if (a.fecha === ayer) c.lanzamientos1d += a.lanzamientos;
    m.set(k, c);
  }
  return [...m.values()].sort((x, y) => x.teamId.localeCompare(y.teamId) || y.lanzamientos3d - x.lanzamientos3d);
}

function diaMenos(yyyymmdd: string, dias: number): string {
  const d = new Date(Date.UTC(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8))));
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
const iso = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

export interface ResultadoBullpen {
  partidos: number;
  equipos: number;
  relevistas: number;
  asOf: string;
}

/** Baja los boxscores de los últimos `dias` días y guarda la carga por equipo para hoy. */
export async function ingestBullpen(opts: { ahora?: Date; fetch?: Fetch; dias?: number; league?: string } = {}): Promise<ResultadoBullpen> {
  const ahora = opts.ahora ?? new Date();
  const f = opts.fetch ?? fetch;
  const dias = opts.dias ?? 3;
  const league = opts.league ?? 'mlb';
  const hoy = ahora.toISOString().slice(0, 10).replace(/-/g, '');
  const base = baseballConfig.history.mlbStatsApi;
  const urlCal = `${base}/schedule?sportId=1&startDate=${iso(diaMenos(hoy, dias))}&endDate=${iso(diaMenos(hoy, 1))}&gameType=R`;
  const res = await f(urlCal);
  if (!res.ok) throw new Error(`MLB Stats API: HTTP ${res.status} (${urlCal})`);
  const cal = (await res.json()) as { dates?: { games?: { gamePk?: number; officialDate?: string; status?: { abstractGameState?: string } }[] }[] };
  if (!Array.isArray(cal?.dates)) throw new Error('La respuesta del calendario no trae "dates"');
  const apariciones: AparicionRelevista[] = [];
  let partidos = 0;
  for (const d of cal.dates) {
    for (const g of d.games ?? []) {
      if (g.status?.abstractGameState !== 'Final' || !g.gamePk) continue;
      const fecha = String(g.officialDate ?? '').replace(/-/g, '');
      const rb = await f(`${base}/game/${g.gamePk}/boxscore`);
      if (!rb.ok) continue;
      apariciones.push(...relevistasDeBoxscore(await rb.json(), fecha));
      partidos++;
    }
  }
  const carga = agregarCarga(apariciones, hoy);
  const db = getDb();
  const ins = db.prepare(
    `INSERT OR REPLACE INTO bsb_bullpen (league, team_id, as_of_date, pitcher_id, pitcher_name, appearances_3d, pitches_1d, pitches_3d, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const c of carga) ins.run(league, c.teamId, hoy, c.pitcherId, c.nombre, c.apariciones3d, c.lanzamientos1d, c.lanzamientos3d, ahora.toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { partidos, equipos: new Set(carga.map((c) => c.teamId)).size, relevistas: carga.length, asOf: hoy };
}

/** Umbrales de «cansado»: tres apariciones en tres días, o 45 lanzamientos, o 25 ayer. */
export const CANSADO = { apariciones3d: 3, lanzamientos3d: 45, lanzamientos1d: 25 };

export interface BullpenFicha {
  estado: 'conocido' | 'DESCONOCIDO';
  asOf: string | null;
  relevistasUsados3d: number;
  lanzamientos3d: number;
  lanzamientos1d: number;
  cansados: { nombre: string; apariciones3d: number; lanzamientos1d: number; lanzamientos3d: number }[];
  motivo: string | null;
}

/** La carga del bullpen de un equipo, la más reciente que tenga como mucho `maxDias` días. */
export function cargaBullpen(league: string, teamId: string, ahora = new Date(), maxDias = 2): BullpenFicha {
  const hoy = ahora.toISOString().slice(0, 10).replace(/-/g, '');
  const filas = getDb()
    .prepare('SELECT as_of_date, pitcher_name, appearances_3d, pitches_1d, pitches_3d FROM bsb_bullpen WHERE league = ? AND team_id = ? AND as_of_date >= ? AND as_of_date = (SELECT MAX(as_of_date) FROM bsb_bullpen WHERE league = ? AND team_id = ?) ORDER BY pitches_3d DESC')
    .all(league, teamId, diaMenos(hoy, maxDias), league, teamId) as unknown as { as_of_date: string; pitcher_name: string; appearances_3d: number; pitches_1d: number; pitches_3d: number }[];
  if (filas.length === 0) return { estado: 'DESCONOCIDO', asOf: null, relevistasUsados3d: 0, lanzamientos3d: 0, lanzamientos1d: 0, cansados: [], motivo: 'sin boxscores recientes (npm run bullpen o el ciclo del servidor)' };
  const cansados = filas
    .filter((r) => r.appearances_3d >= CANSADO.apariciones3d || r.pitches_3d >= CANSADO.lanzamientos3d || r.pitches_1d >= CANSADO.lanzamientos1d)
    .map((r) => ({ nombre: r.pitcher_name, apariciones3d: r.appearances_3d, lanzamientos1d: r.pitches_1d, lanzamientos3d: r.pitches_3d }));
  return {
    estado: 'conocido',
    asOf: filas[0].as_of_date,
    relevistasUsados3d: filas.length,
    lanzamientos3d: filas.reduce((a, r) => a + r.pitches_3d, 0),
    lanzamientos1d: filas.reduce((a, r) => a + r.pitches_1d, 0),
    cansados,
    motivo: null,
  };
}
