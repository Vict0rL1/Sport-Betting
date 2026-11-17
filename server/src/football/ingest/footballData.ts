// Current-season results and HISTORICAL 1X2 ODDS from football-data.co.uk.
//
// This is the primary source: it covers every major league, is updated within
// days of each round, and carries closing bookmaker odds for every match — which
// is what lets `npm run backtest:fb` ask whether the model beats the market
// instead of only beating a baseline.
//
// TWO LAYOUTS, because the site has two:
//   • "main"  — one CSV per season per division (mmz4281/2425/E0.csv), with
//               Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,FTR + odds columns.
//   • "extra" — one multi-season CSV per country (new/BRA.csv) covering leagues
//               outside Europe, with Country,League,Season,Home,Away,HG,AG,Res.
//
// Columns are located BY HEADER NAME. The layout has drifted over the years
// (bookmakers come and go) and the two variants disagree on nearly every name, so
// a missing required column fails with the headers actually found rather than
// silently ingesting nonsense.
//
// VERIFICATION NOTE: this host is unreachable from the environment the code was
// written in, so parsing is tested against fixtures in the site's real layout.

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { getDb } from '../../db.ts';
import { RAW_DIR, footballConfig } from '../../config.ts';
import { slugify } from './footballcsv.ts';
import { buildTeamIndex, normalizeTeamName } from './teamNames.ts';
import type { LeagueConfig } from '../types.ts';

export const MANUAL_DIR = path.join(RAW_DIR, 'football', 'football-data');

const norm = (s: string) => s.toLowerCase().replace(/[\s._-]/g, '');

/** dd/mm/yy or dd/mm/yyyy → YYYYMMDD. */
export function parseUkDate(raw: string): string | null {
  const m = (raw ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? (Number(m[3]) > 50 ? `19${m[3]}` : `20${m[3]}`) : m[3];
  return `${year}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}`;
}

export interface ParsedFdMatch {
  date: string;
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  /** De qué columna salieron las cuotas de arriba (Fase 2C): «media de casas», «Pinnacle», «Bet365»… */
  oddsSource: string | null;
  /** Pinnacle temprano (PSH/PSD/PSA) y de cierre (PSCH/PSCD/PSCA), cuando el fichero los trae. */
  psHome: number | null;
  psDraw: number | null;
  psAway: number | null;
  pscHome: number | null;
  pscDraw: number | null;
  pscAway: number | null;
  /**
   * Córners y tarjetas del partido. Solo existen en el diseño «main» (una liga
   * europea por temporada); el «extra» de fuera de Europa no los trae, y ahí quedan
   * null en vez de en cero — que es otra cosa: cero córners es un dato, no un hueco.
   */
  homeCorners: number | null;
  awayCorners: number | null;
  homeYellows: number | null;
  awayYellows: number | null;
  homeReds: number | null;
  awayReds: number | null;
}

function pick(headers: string[], aliases: string[]): string | null {
  for (const a of aliases) {
    const h = headers.find((x) => norm(x) === a);
    if (h) return h;
  }
  return null;
}

const num = (v: string | undefined): number | null => {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const validOdds = (n: number | null) => (n != null && n > 1 && n < 1000 ? n : null);

/** Qué significa cada cabecera de cuotas, para etiquetar la comparación con el mercado. */
export const FUENTE_POR_CABECERA: Record<string, string> = {
  avgh: 'media de casas', avgch: 'media de casas (cierre)',
  psh: 'Pinnacle', pch: 'Pinnacle (cierre)',
  b365h: 'Bet365', b365ch: 'Bet365 (cierre)',
};

/**
 * Parse one football-data.co.uk CSV. `leagueFilter` applies only to the "extra"
 * multi-league files, where one file holds several competitions.
 */
export function parseFootballData(
  csv: string,
  source: string,
  leagueFilter?: string,
): ParsedFdMatch[] {
  const rows = parse(csv, {
    columns: true,
    skipEmptyLines: true,
    relaxColumnCount: true,
    relaxQuotes: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
  if (rows.length === 0) return [];

  const headers = Object.keys(rows[0]);
  const dateCol = pick(headers, ['date']);
  const homeCol = pick(headers, ['hometeam', 'home']);
  const awayCol = pick(headers, ['awayteam', 'away']);
  const hgCol = pick(headers, ['fthg', 'hg', 'homegoals']);
  const agCol = pick(headers, ['ftag', 'ag', 'awaygoals']);
  if (!dateCol || !homeCol || !awayCol || !hgCol || !agCol) {
    throw new Error(
      `${source}: faltan columnas obligatorias. Encontradas: [${headers.slice(0, 25).join(', ')}]. ` +
        `Se esperaban Date, HomeTeam, AwayTeam, FTHG y FTAG (o Home/Away/HG/AG).`,
    );
  }
  // Odds preference: the average across books is the fairest consensus; Pinnacle
  // is the sharpest single book; Bet365 the most consistently present. "Max" is
  // the best available price, which flatters a bettor and is NOT a fair yardstick.
  const oh = pick(headers, ['avgh', 'avgch', 'psh', 'pch', 'b365h', 'b365ch']);
  const od = pick(headers, ['avgd', 'avgcd', 'psd', 'pcd', 'b365d', 'b365cd']);
  const oa = pick(headers, ['avga', 'avgca', 'psa', 'pca', 'b365a', 'b365ca']);
  const leagueCol = pick(headers, ['league']);
  // Pinnacle, las dos: la temprana (PS*) y la de cierre (PSC*). Son las que permiten medir
  // el CLV histórico (football/clv.ts). Se guardan aparte de odds_* para no cambiar lo que
  // ya medía el backtest.
  const psh = pick(headers, ['psh']);
  const psd = pick(headers, ['psd']);
  const psa = pick(headers, ['psa']);
  const psch = pick(headers, ['psch']);
  const pscd = pick(headers, ['pscd']);
  const psca = pick(headers, ['psca']);
  const oddsSource = oh ? FUENTE_POR_CABECERA[norm(oh)] ?? oh : null;
  // Córners y tarjetas. Se leen por nombre de cabecera como todo lo demás, y su
  // ausencia NO es un error: la mitad de los ficheros del sitio no las trae y un
  // partido sin ellas sigue siendo un partido válido para el modelo de goles.
  const hcCol = pick(headers, ['hc']);
  const acCol = pick(headers, ['ac']);
  const hyCol = pick(headers, ['hy']);
  const ayCol = pick(headers, ['ay']);
  const hrCol = pick(headers, ['hr']);
  const arCol = pick(headers, ['ar']);

  const out: ParsedFdMatch[] = [];
  for (const r of rows) {
    if (leagueFilter && leagueCol && (r[leagueCol] ?? '').trim() !== leagueFilter) continue;
    const date = parseUkDate(r[dateCol]);
    const home = (r[homeCol] ?? '').trim();
    const away = (r[awayCol] ?? '').trim();
    const hg = num(r[hgCol]);
    const ag = num(r[agCol]);
    if (!date || !home || !away || hg == null || ag == null) continue;
    out.push({
      date,
      homeName: home,
      awayName: away,
      homeGoals: hg,
      awayGoals: ag,
      oddsHome: validOdds(oh ? num(r[oh]) : null),
      oddsDraw: validOdds(od ? num(r[od]) : null),
      oddsAway: validOdds(oa ? num(r[oa]) : null),
      oddsSource,
      psHome: validOdds(psh ? num(r[psh]) : null),
      psDraw: validOdds(psd ? num(r[psd]) : null),
      psAway: validOdds(psa ? num(r[psa]) : null),
      pscHome: validOdds(psch ? num(r[psch]) : null),
      pscDraw: validOdds(pscd ? num(r[pscd]) : null),
      pscAway: validOdds(psca ? num(r[psca]) : null),
      homeCorners: hcCol ? num(r[hcCol]) : null,
      awayCorners: acCol ? num(r[acCol]) : null,
      homeYellows: hyCol ? num(r[hyCol]) : null,
      awayYellows: ayCol ? num(r[ayCol]) : null,
      homeReds: hrCol ? num(r[hrCol]) : null,
      awayReds: arCol ? num(r[arCol]) : null,
    });
  }
  return out;
}

/** Season 2025 → "2425", the site's directory naming. */
function seasonCode(endYear: number): string {
  const a = String((endYear - 1) % 100).padStart(2, '0');
  const b = String(endYear % 100).padStart(2, '0');
  return `${a}${b}`;
}

function manualFile(name: string): string | null {
  const p = path.join(MANUAL_DIR, name);
  return fs.existsSync(p) && fs.statSync(p).size > 100 ? p : null;
}

async function download(url: string, dest: string): Promise<string | null> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100) return dest;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    // A blocked request often returns a short HTML error page with a 200.
    if (text.length < 100 || /^\s*</.test(text)) return null;
    fs.writeFileSync(dest, text);
    return dest;
  } catch {
    return null;
  }
}

export interface FootballDataResult {
  league: string;
  matches: number;
  withOdds: number;
  seasons: number[];
  /** Nombres de football-data que cayeron sobre un id de openfootball por los partidos en común. */
  aprendidos?: number;
  /** Nombres sin partido en común ni nombre igual: se dan de alta como equipo nuevo. */
  creados?: string[];
  /** Partidos que quedaban de un club contra sí mismo tras emparejar: no se guardan. */
  descartados?: number;
  /** Partidos que openfootball tiene en otra fecha (1–3 días, o aplazado): se juntan con ese, no se duplican. */
  porFecha?: number;
}

/** Un partido de football-data con su temporada, lo justo para emparejar nombres. */
export interface FilaParaEmparejar {
  season: number;
  date: string;
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
}

/**
 * Qué id lleva cada nombre de football-data en cada temporada (nocturno «Datos»,
 * docs/plans/nocturno-datos.md).
 *
 * Antes, cada club se daba de alta como `slugify(nombre)` («Man United» → man-united), y solo
 * los clubes cuyo slug coincidía con el de openfootball se fundían: el resto entraba dos veces, con
 * ids distintos (con las CSV reales, 208 de 421 nombres). Una tabla de alias escrita a mano
 * sería adivinar; aquí lo dicen los PARTIDOS. El mismo partido está en las dos fuentes (misma liga,
 * mismo día, mismo marcador), así que cada partido de football-data que tiene exactamente un
 * gemelo en openfootball vota que «Man United» es manchester-united.
 *
 * - Por TEMPORADA. openfootball cambia a veces la grafía de un club entre temporadas («Bayer
 *   Leverkusen» en 2019-20, «Bayer 04 Leverkusen» después) y con ella el id. Cada temporada de
 *   football-data cae sobre el id que openfootball usó ese año, así que no añade partidos dobles.
 * - Solo con evidencia clara: al menos 3 votos y el 90 % para el mismo id. Si dos nombres eligen el
 *   mismo id en la misma temporada, ninguno de los dos se queda con él.
 * - Una temporada que openfootball no tiene (Ligue 2 de 2022 a 2024) toma el id de la temporada
 *   más cercana en la que ese nombre sí quedó emparejado.
 * - Si no hay nada de eso, el nombre: un id existente con el mismo slug, o el mismo nombre
 *   normalizado (sin prefijos: «Paris FC» no es el PSG; ver openfootball.ts).
 * - Y si tampoco, se da de alta como antes (`slugify`). Se devuelve en `creados` para que se vea.
 */
export function emparejarNombres(
  league: string,
  filas: FilaParaEmparejar[],
): { idDe: (nombre: string, season: number) => string; aprendidos: number; creados: string[]; alias: { alias: string; teamId: string; season: number }[] } {
  const db = getDb();
  const existentes = new Set((db.prepare('SELECT id FROM fb_teams WHERE league = ?').all(league) as { id: string }[]).map((r) => r.id));
  const indice = buildTeamIndex(league as never);
  const porNombre = (n: string): string | null => (existentes.has(slugify(n)) ? slugify(n) : (indice.get(normalizeTeamName(n)) ?? null));

  const buscar = db.prepare('SELECT home_id h, away_id a FROM fb_matches WHERE league = ? AND match_date = ? AND home_goals = ? AND away_goals = ?');
  const clave = (n: string, s: number) => `${s}\u0000${n}`;
  const votos = new Map<string, Map<string, number>>();
  const votar = (n: string, s: number, id: string) => {
    const v = votos.get(clave(n, s)) ?? new Map<string, number>();
    v.set(id, (v.get(id) ?? 0) + 1);
    votos.set(clave(n, s), v);
  };
  for (const f of filas) {
    let gemelos = buscar.all(league, f.date, f.homeGoals, f.awayGoals) as { h: string; a: string }[];
    if (gemelos.length > 1) {
      // Dos partidos el mismo día con el mismo marcador: solo si el nombre de un lado los separa.
      const h = porNombre(f.homeName);
      const a = porNombre(f.awayName);
      gemelos = gemelos.filter((g) => (!h || g.h === h) && (!a || g.a === a));
    }
    if (gemelos.length !== 1) continue;
    votar(f.homeName, f.season, gemelos[0].h);
    votar(f.awayName, f.season, gemelos[0].a);
  }

  const decidido = new Map<string, string>();
  for (const [k, v] of votos) {
    const orden = [...v.entries()].sort((x, y) => y[1] - x[1]);
    const total = orden.reduce((t, [, n]) => t + n, 0);
    if (orden[0][1] >= 3 && orden[0][1] >= 0.9 * total) decidido.set(k, orden[0][0]);
  }
  // Dos nombres al mismo id en la misma temporada: alguno está mal, y no se sabe cuál.
  const porTemporadaEId = new Map<string, string[]>();
  for (const [k, id] of decidido) {
    const s = k.slice(0, k.indexOf('\u0000'));
    porTemporadaEId.set(`${s}|${id}`, [...(porTemporadaEId.get(`${s}|${id}`) ?? []), k]);
  }
  for (const ks of porTemporadaEId.values()) if (ks.length > 1) for (const k of ks) decidido.delete(k);

  const temporadasDe = new Map<string, [number, string][]>();
  for (const [k, id] of decidido) {
    const i = k.indexOf('\u0000');
    const n = k.slice(i + 1);
    temporadasDe.set(n, [...(temporadasDe.get(n) ?? []), [Number(k.slice(0, i)), id]]);
  }
  const resolver = (n: string, s: number): { id: string; voto: boolean } => {
    const aqui = decidido.get(clave(n, s));
    if (aqui) return { id: aqui, voto: true };
    const otras = temporadasDe.get(n);
    if (otras?.length) {
      // La más cercana; a igual distancia, la más reciente.
      return { id: [...otras].sort((x, y) => Math.abs(x[0] - s) - Math.abs(y[0] - s) || y[0] - x[0])[0][1], voto: false };
    }
    const nombre = porNombre(n);
    return { id: nombre ?? slugify(n), voto: false };
  };
  // El resultado final de cada (nombre, temporada), y la misma guarda que con los votos, ahora también
  // para lo que sale de la temporada cercana o del nombre (revisión data-guardian, F7): dos nombres al
  // mismo id en una temporada juntarían a dos clubes. El que no salió de un voto se da de alta aparte.
  const final = new Map<string, string>();
  const enTemporada = new Map<string, { k: string; n: string; voto: boolean }[]>();
  for (const f of filas) {
    for (const n of [f.homeName, f.awayName]) {
      const k = clave(n, f.season);
      if (final.has(k)) continue;
      const r = resolver(n, f.season);
      final.set(k, r.id);
      const g = `${f.season}|${r.id}`;
      enTemporada.set(g, [...(enTemporada.get(g) ?? []), { k, n, voto: r.voto }]);
    }
  }
  for (const grupo of enTemporada.values()) {
    if (grupo.length < 2) continue;
    for (const x of grupo) if (!x.voto) final.set(x.k, slugify(x.n));
  }
  // Lo que se da de alta: los nombres cuyo id final no es de ningún equipo que ya exista.
  const creados = [...new Set([...final].filter(([, id]) => !existentes.has(id)).map(([k]) => k.slice(k.indexOf('\u0000') + 1)))].sort();
  const idDe = (n: string, s: number): string => final.get(clave(n, s)) ?? resolver(n, s).id;
  // Para los alias: el id de cada nombre en su temporada más reciente.
  const ultima = new Map<string, number>();
  for (const f of filas) for (const n of [f.homeName, f.awayName]) ultima.set(n, Math.max(ultima.get(n) ?? -Infinity, f.season));
  const alias = [...ultima].map(([n, s]) => ({ alias: n, teamId: idDe(n, s), season: s }));
  return { idDe, aprendidos: temporadasDe.size, creados, alias };
}

/** Ingest seasons for one league from football-data.co.uk. */
export async function ingestFootballData(
  league: LeagueConfig,
  seasons: number[],
): Promise<FootballDataResult> {
  if (!league.footballData) return { league: league.id, matches: 0, withOdds: 0, seasons: [] };
  const db = getDb();
  const cacheDir = path.join(RAW_DIR, 'football', 'football-data-cache');

  // Solo para los equipos que se dan de alta: el nombre de un equipo que ya existe (el formal de
  // openfootball, «Brighton & Hove Albion FC») no se pisa con el corto de aquí («Brighton»).
  const insertTeam = db.prepare(
    `INSERT INTO fb_teams (id, league, name) VALUES (?, ?, ?)
     ON CONFLICT(league, id) DO NOTHING`,
  );
  const insertMatch = db.prepare(
    `INSERT INTO fb_matches
       (league, season, match_date, home_id, away_id, home_goals, away_goals, result,
        odds_home, odds_draw, odds_away,
        home_corners, away_corners, home_yellows, away_yellows, home_reds, away_reds,
        odds_source, ps_home, ps_draw, ps_away, psc_home, psc_draw, psc_away)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(league, match_date, home_id, away_id) DO UPDATE SET
       odds_home = COALESCE(excluded.odds_home, fb_matches.odds_home),
       odds_draw = COALESCE(excluded.odds_draw, fb_matches.odds_draw),
       odds_away = COALESCE(excluded.odds_away, fb_matches.odds_away),
       odds_source = COALESCE(excluded.odds_source, fb_matches.odds_source),
       ps_home = COALESCE(excluded.ps_home, fb_matches.ps_home),
       ps_draw = COALESCE(excluded.ps_draw, fb_matches.ps_draw),
       ps_away = COALESCE(excluded.ps_away, fb_matches.ps_away),
       psc_home = COALESCE(excluded.psc_home, fb_matches.psc_home),
       psc_draw = COALESCE(excluded.psc_draw, fb_matches.psc_draw),
       psc_away = COALESCE(excluded.psc_away, fb_matches.psc_away),
       -- COALESCE y no sobrescritura: openfootball ya insertó el partido con sus
       -- goles y su descanso, y esta fuente solo añade lo que aquella no tiene. Un
       -- null de aquí no debe borrar un dato que ya estaba.
       home_corners = COALESCE(excluded.home_corners, fb_matches.home_corners),
       away_corners = COALESCE(excluded.away_corners, fb_matches.away_corners),
       home_yellows = COALESCE(excluded.home_yellows, fb_matches.home_yellows),
       away_yellows = COALESCE(excluded.away_yellows, fb_matches.away_yellows),
       home_reds = COALESCE(excluded.home_reds, fb_matches.home_reds),
       away_reds = COALESCE(excluded.away_reds, fb_matches.away_reds)`,
  );

  let matches = 0;
  let withOdds = 0;
  const used: number[] = [];

  const files: { file: string; season: number | null }[] = [];
  if (league.footballData.kind === 'main') {
    for (const season of seasons) {
      const code = seasonCode(season);
      const name = `${league.id}-${code}.csv`;
      const url = `${footballConfig.history.footballDataBase}/${code}/${league.footballData.div}.csv`;
      const f = manualFile(name) ?? (await download(url, path.join(cacheDir, name)));
      if (f) files.push({ file: f, season });
    }
  } else {
    // One file per country covering many seasons; the season comes from the row.
    const name = league.footballData.file;
    const url = `${footballConfig.history.footballDataExtraBase}/${name}`;
    const f = manualFile(name) ?? (await download(url, path.join(cacheDir, name)));
    if (f) files.push({ file: f, season: null });
  }

  // Todo leído antes de escribir nada: los ids salen de todas las temporadas a la vez.
  const leidos: { m: ParsedFdMatch; s: number }[][] = [];
  for (const { file, season } of files) {
    const parsed = parseFootballData(
      fs.readFileSync(file, 'utf8'),
      path.basename(file),
      league.footballData.kind === 'extra' ? league.footballData.league : undefined,
    );
    const filas: { m: ParsedFdMatch; s: number }[] = [];
    for (const m of parsed) {
      // For the multi-season files, derive the season from the match date:
      // a match in July or later belongs to the season ending next year.
      const y = Number(m.date.slice(0, 4));
      const mo = Number(m.date.slice(4, 6));
      const s = season ?? (mo >= 7 ? y + 1 : y);
      if (seasons.length && !seasons.includes(s)) continue;
      filas.push({ m, s });
    }
    if (filas.length) leidos.push(filas);
  }
  const ids = emparejarNombres(
    league.id,
    leidos.flat().map(({ m, s }) => ({ season: s, date: m.date, homeName: m.homeName, awayName: m.awayName, homeGoals: m.homeGoals, awayGoals: m.awayGoals })),
  );
  const yaExiste = db.prepare('SELECT 1 FROM fb_teams WHERE league = ? AND id = ?');
  const guardarAlias = db.prepare(
    `INSERT INTO fb_team_aliases (league, alias, team_id, fuente, season, updated_at) VALUES (?, ?, ?, 'football-data', ?, ?)
     ON CONFLICT(league, alias) DO UPDATE SET team_id = excluded.team_id, fuente = excluded.fuente, season = excluded.season, updated_at = excluded.updated_at`,
  );
  const ahora = new Date().toISOString();
  let descartados = 0;
  // El mismo partido con otra fecha en openfootball (hallazgo C del nocturno: 1–3 días de diferencia, o
  // uno aplazado). Si en su fecha no está, pero hay exactamente un partido de la misma pareja, temporada
  // y marcador a 45 días o menos, y la pareja sale una sola vez en football-data esa temporada, es el
  // mismo: se le añaden las cuotas y se queda la fecha de openfootball.
  const enSuFecha = db.prepare('SELECT 1 FROM fb_matches WHERE league = ? AND match_date = ? AND home_id = ? AND away_id = ?');
  const mismaPareja = db.prepare(
    'SELECT match_date AS d FROM fb_matches WHERE league = ? AND season = ? AND home_id = ? AND away_id = ? AND home_goals = ? AND away_goals = ? AND match_date != ?',
  );
  const dia = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))) / 86_400_000;
  const vecesPareja = new Map<string, number>();
  for (const { m, s } of leidos.flat()) {
    const k = `${s}|${ids.idDe(m.homeName, s)}|${ids.idDe(m.awayName, s)}`;
    vecesPareja.set(k, (vecesPareja.get(k) ?? 0) + 1);
  }
  let porFecha = 0;

  for (const filas of leidos) {
    db.exec('BEGIN');
    try {
      for (const { m, s } of filas) {
        const homeId = ids.idDe(m.homeName, s);
        const awayId = ids.idDe(m.awayName, s);
        // Un club contra sí mismo es un emparejado roto: mejor sin el partido que con él, y se cuenta.
        if (homeId === awayId) {
          descartados++;
          continue;
        }
        if (!yaExiste.get(league.id, homeId)) insertTeam.run(homeId, league.id, m.homeName);
        if (!yaExiste.get(league.id, awayId)) insertTeam.run(awayId, league.id, m.awayName);
        let fecha = m.date;
        if (!enSuFecha.get(league.id, m.date, homeId, awayId) && vecesPareja.get(`${s}|${homeId}|${awayId}`) === 1) {
          const cerca = (mismaPareja.all(league.id, s, homeId, awayId, m.homeGoals, m.awayGoals, m.date) as { d: string }[]).filter(
            (x) => Math.abs(dia(x.d) - dia(m.date)) <= 45,
          );
          if (cerca.length === 1) {
            fecha = cerca[0].d;
            porFecha++;
          }
        }
        insertMatch.run(
          league.id,
          s,
          fecha,
          homeId,
          awayId,
          m.homeGoals,
          m.awayGoals,
          m.homeGoals > m.awayGoals ? 'H' : m.homeGoals === m.awayGoals ? 'D' : 'A',
          m.oddsHome,
          m.oddsDraw,
          m.oddsAway,
          m.homeCorners,
          m.awayCorners,
          m.homeYellows,
          m.awayYellows,
          m.homeReds,
          m.awayReds,
          m.oddsHome ? m.oddsSource : null,
          m.psHome,
          m.psDraw,
          m.psAway,
          m.pscHome,
          m.pscDraw,
          m.pscAway,
        );
        matches++;
        if (m.oddsHome && m.oddsDraw && m.oddsAway) withOdds++;
        if (!used.includes(s)) used.push(s);
      }
      // Lo aprendido, en la misma transacción que los partidos de los que sale: lo usan las casas y
      // ClubElo vía buildTeamIndex (revisión data-guardian, F1). Gana la temporada más reciente.
      const enEste = new Set(filas.flatMap(({ m }) => [m.homeName, m.awayName]));
      for (const a of ids.alias) if (enEste.has(a.alias) && yaExiste.get(league.id, a.teamId)) guardarAlias.run(league.id, a.alias, a.teamId, a.season, ahora);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  return { league: league.id, matches, withOdds, seasons: used.sort(), aprendidos: ids.aprendidos, creados: ids.creados, descartados, porFecha };
}
