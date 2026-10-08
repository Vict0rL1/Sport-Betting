// ClubElo (clubelo.com) como baseline EXTERNO del walk-forward de fútbol.
//
// api.clubelo.com/<YYYY-MM-DD> devuelve un CSV con el Elo de todos los clubes de Europa (y
// algunos más) vigente ese día: Rank,Club,Country,Level,Elo,From,To. Cada fila vale entre
// From y To, así que una muestra semanal cubre el calendario entero sin pedir cada día.
//
// Para qué sirve y para qué no. Es un rating publicado por un tercero ANTES de cada partido,
// así que puede entrar en el walk-forward como baseline sin mirar al futuro: si nuestro modelo
// no bate a ClubElo fuera de muestra, eso hay que saberlo. No entra en ninguna predicción.
// Tennis Abstract, en cambio, solo publica el Elo ACTUAL (HTML, sin histórico), que no sirve
// como baseline de walk-forward: se documenta en docs/plans/phase-2.md.
//
// Los nombres de club no coinciden letra a letra con los nuestros («Man City» / «Manchester
// City FC»): se resuelven con el mismo índice que usa la ingesta de cuotas (teamNames.ts),
// que solo acepta un emparejamiento cuando es único. Un club sin pareja se guarda igual, con
// team_id nulo, y no cuenta.

import { getDb } from '../../db.ts';
import { buildTeamIndex, resolveTeam } from './teamNames.ts';
import type { LeagueId } from '../types.ts';

export const EXTERNAL_ELO_SCHEMA = `
  CREATE TABLE IF NOT EXISTS fb_external_elo (
    source     TEXT NOT NULL DEFAULT 'clubelo',
    club       TEXT NOT NULL,
    country    TEXT NOT NULL,
    level      INTEGER NOT NULL,
    elo        REAL NOT NULL,
    from_date  TEXT NOT NULL,   -- YYYYMMDD
    to_date    TEXT NOT NULL,   -- YYYYMMDD
    league     TEXT,
    team_id    TEXT,
    PRIMARY KEY (source, club, from_date)
  );
  CREATE INDEX IF NOT EXISTS idx_ext_elo_team ON fb_external_elo (league, team_id, from_date, to_date);
`;

export const CLUBELO_BASE = 'http://api.clubelo.com';

/** País ClubElo + nivel → nuestra liga. Solo las que tienen archivo de resultados aquí. */
export const LIGA_POR_PAIS: Record<string, Partial<Record<1 | 2, LeagueId>>> = {
  ENG: { 1: 'epl', 2: 'championship' },
  ESP: { 1: 'laliga', 2: 'laliga2' },
  GER: { 1: 'bundesliga', 2: 'bundesliga2' },
  ITA: { 1: 'seriea', 2: 'serieb' },
  FRA: { 1: 'ligue1', 2: 'ligue2' },
  NED: { 1: 'eredivisie' },
  POR: { 1: 'primeira' },
};

/**
 * ClubElo abrevia («Man City», «Paris SG», «Atletico»); el emparejador solo acepta prefijos
 * únicos, así que «man city» no encuentra «manchester city». Los alias más comunes, a mano;
 * un club que no esté aquí ni coincida por prefijo se guarda sin pareja y no cuenta.
 */
export const ALIAS_CLUBELO: Record<string, string> = {
  'Man City': 'Manchester City',
  'Man United': 'Manchester United',
  'Paris SG': 'Paris Saint-Germain',
  Atletico: 'Atlético Madrid',
  Inter: 'Internazionale',
  Milan: 'AC Milan',
  Bayern: 'Bayern München',
  Dortmund: 'Borussia Dortmund',
  Gladbach: 'Borussia Mönchengladbach',
  Leverkusen: 'Bayer Leverkusen',
  Sociedad: 'Real Sociedad',
  Betis: 'Real Betis',
  Athletic: 'Athletic Club',
  Sporting: 'Sporting CP',
  Wolves: 'Wolverhampton Wanderers',
  Newcastle: 'Newcastle United',
  'West Ham': 'West Ham United',
  Brighton: 'Brighton & Hove Albion',
  Forest: 'Nottingham Forest',
  Leeds: 'Leeds United',
  Spurs: 'Tottenham Hotspur',
};

export interface FilaClubElo {
  rank: number | null;
  club: string;
  country: string;
  level: number;
  elo: number;
  from: string; // YYYYMMDD
  to: string; // YYYYMMDD
}

const ymd = (s: string) => s.trim().replace(/-/g, '');

export function parseClubElo(csv: string): FilaClubElo[] {
  const lineas = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length === 0) return [];
  const cab = lineas[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (n: string) => cab.indexOf(n);
  const [iRank, iClub, iCountry, iLevel, iElo, iFrom, iTo] = ['rank', 'club', 'country', 'level', 'elo', 'from', 'to'].map(idx);
  if ([iClub, iCountry, iLevel, iElo, iFrom, iTo].some((i) => i < 0)) {
    throw new Error(`ClubElo: cabecera inesperada [${lineas[0].slice(0, 80)}]; se esperaba Rank,Club,Country,Level,Elo,From,To`);
  }
  const out: FilaClubElo[] = [];
  for (const l of lineas.slice(1)) {
    const c = l.split(',');
    const elo = Number(c[iElo]);
    const level = Number(c[iLevel]);
    if (!c[iClub] || !Number.isFinite(elo) || !Number.isFinite(level)) continue;
    const rank = iRank >= 0 ? Number(c[iRank]) : NaN;
    out.push({ rank: Number.isFinite(rank) ? rank : null, club: c[iClub].trim(), country: c[iCountry].trim(), level, elo, from: ymd(c[iFrom]), to: ymd(c[iTo]) });
  }
  return out;
}

/** Guarda filas resolviendo el club a nuestro equipo cuando se puede. Devuelve cuántas nuevas y cuántas emparejadas. */
export function guardarClubElo(filas: FilaClubElo[]): { nuevas: number; emparejadas: number } {
  const db = getDb();
  const indices = new Map<LeagueId, Map<string, string>>();
  const indice = (l: LeagueId) => indices.get(l) ?? indices.set(l, buildTeamIndex(l)).get(l)!;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO fb_external_elo (source, club, country, level, elo, from_date, to_date, league, team_id) VALUES ('clubelo', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let nuevas = 0;
  let emparejadas = 0;
  db.exec('BEGIN');
  try {
    for (const f of filas) {
      const liga = LIGA_POR_PAIS[f.country]?.[f.level as 1 | 2] ?? null;
      const teamId = liga ? (resolveTeam(indice(liga), ALIAS_CLUBELO[f.club] ?? f.club) ?? resolveTeam(indice(liga), f.club)) : null;
      const r = ins.run(f.club, f.country, f.level, f.elo, f.from, f.to, liga, teamId);
      if (Number(r.changes) > 0) {
        nuevas++;
        if (teamId) emparejadas++;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { nuevas, emparejadas };
}

type Fetch = typeof fetch;

export function fechasMuestreadas(desde: string, hasta: string, cadaDias: number): string[] {
  const out: string[] = [];
  const d = new Date(`${desde}T00:00:00Z`);
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  while (d.getTime() <= fin) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + Math.max(1, cadaDias));
  }
  return out;
}

export interface ResultadoClubElo {
  fechas: number;
  fallidas: string[];
  nuevas: number;
  emparejadas: number;
}

/** Descarga un día de cada `cadaDias` entre dos fechas (YYYY-MM-DD) y guarda. Una fecha caída no para las demás. */
export async function ingestClubElo(opts: { desde: string; hasta?: string; cadaDias?: number; fetch?: Fetch; log?: (m: string) => void }): Promise<ResultadoClubElo> {
  const f = opts.fetch ?? fetch;
  const hasta = opts.hasta ?? new Date().toISOString().slice(0, 10);
  const fechas = fechasMuestreadas(opts.desde, hasta, opts.cadaDias ?? 7);
  const r: ResultadoClubElo = { fechas: fechas.length, fallidas: [], nuevas: 0, emparejadas: 0 };
  for (const fecha of fechas) {
    try {
      const res = await f(`${CLUBELO_BASE}/${fecha}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const g = guardarClubElo(parseClubElo(await res.text()));
      r.nuevas += g.nuevas;
      r.emparejadas += g.emparejadas;
    } catch (e) {
      r.fallidas.push(`${fecha}: ${(e as Error).message}`);
    }
  }
  if (r.fallidas.length === fechas.length && fechas.length > 0) throw new Error(`ClubElo no respondió en ninguna de las ${fechas.length} fechas (${r.fallidas[0]})`);
  opts.log?.(`ClubElo: ${fechas.length} fechas, ${r.nuevas} filas nuevas (${r.emparejadas} emparejadas con equipos nuestros), ${r.fallidas.length} fallidas.`);
  return r;
}

/** ¿Hay Elo externo para esta liga? Para que el backtest no busque en vano partido a partido. */
export function hayEloExterno(league: LeagueId): boolean {
  return !!getDb().prepare('SELECT 1 FROM fb_external_elo WHERE league = ? AND team_id IS NOT NULL LIMIT 1').get(league);
}

/** El Elo de ClubElo vigente en una fecha para un equipo nuestro, o null. */
export function eloExternoEn(league: LeagueId, teamId: string, fecha: string): number | null {
  const r = getDb()
    .prepare('SELECT elo FROM fb_external_elo WHERE league = ? AND team_id = ? AND from_date <= ? AND to_date >= ? ORDER BY from_date DESC LIMIT 1')
    .get(league, teamId, fecha, fecha) as { elo: number } | undefined;
  return r?.elo ?? null;
}

/**
 * De dos Elo a [local, empate, visitante]: la logística clásica con la ventaja de campo y
 * un reparto del empate con la tasa que lleve la liga. Es el baseline «de manual» aplicado a
 * un rating ajeno: nada que afinar, que es justo lo que hace a un baseline honesto.
 */
export function probsClubElo(eloLocal: number, eloVisitante: number, ventajaCampo: number, tasaEmpate: number): number[] {
  const e = 1 / (1 + 10 ** (-(eloLocal + ventajaCampo - eloVisitante) / 400));
  const d = Math.min(0.5, Math.max(0.05, tasaEmpate));
  return [(1 - d) * e, d, (1 - d) * (1 - e)];
}
