// Ingesta de la NHL en sombra (Fase 8.1): partidos TERMINADOS de la API web pública de la NHL
// (`https://api-web.nhle.com/v1/schedule/{fecha}`, una semana por petición). Solo se guardan los
// terminados (gameState FINAL u OFF) con su marcador; lo demás se ignora. Si la fuente no contesta, se
// dice y no se escribe nada: nunca un partido inventado.

import { getDb } from '../db.ts';

export const NHL_API = 'https://api-web.nhle.com/v1';

export interface PartidoNhl {
  id: number;
  season: number;
  game_type: number;
  game_date: string;
  home_id: string;
  away_id: string;
  home_name: string | null;
  away_name: string | null;
  home_goals: number;
  away_goals: number;
  final_period: 'REG' | 'OT' | 'SO';
}

interface EquipoApi {
  abbrev?: string;
  score?: number;
  name?: { default?: string };
  placeName?: { default?: string };
  commonName?: { default?: string };
}
interface PartidoApi {
  id?: number;
  season?: number;
  gameType?: number;
  gameDate?: string;
  startTimeUTC?: string;
  gameState?: string;
  homeTeam?: EquipoApi;
  awayTeam?: EquipoApi;
  periodDescriptor?: { periodType?: string };
  gameOutcome?: { lastPeriodType?: string };
}

const nombre = (t: EquipoApi | undefined) =>
  t?.name?.default ?? ([t?.placeName?.default, t?.commonName?.default].filter(Boolean).join(' ') || null);

/** Los partidos terminados de una respuesta de /schedule (gameWeek) o /score (games). */
export function partidosDe(json: unknown): PartidoNhl[] {
  const j = json as { gameWeek?: { date?: string; games?: PartidoApi[] }[]; games?: PartidoApi[] };
  const crudos: (PartidoApi & { _fecha?: string })[] = [
    ...(j.games ?? []),
    ...(j.gameWeek ?? []).flatMap((d) => (d.games ?? []).map((g) => ({ ...g, _fecha: d.date }))),
  ];
  const out: PartidoNhl[] = [];
  for (const g of crudos) {
    if (!['FINAL', 'OFF'].includes(String(g.gameState))) continue;
    const h = g.homeTeam;
    const a = g.awayTeam;
    if (!g.id || !g.season || !h?.abbrev || !a?.abbrev || typeof h.score !== 'number' || typeof a.score !== 'number' || h.score === a.score) continue;
    const periodo = String(g.gameOutcome?.lastPeriodType ?? g.periodDescriptor?.periodType ?? 'REG');
    const fecha = g.gameDate ?? g._fecha ?? g.startTimeUTC?.slice(0, 10);
    if (!fecha) continue;
    out.push({
      id: g.id,
      season: Math.floor(g.season / 10000),
      game_type: g.gameType ?? 2,
      game_date: fecha.slice(0, 10),
      home_id: h.abbrev,
      away_id: a.abbrev,
      home_name: nombre(h),
      away_name: nombre(a),
      home_goals: h.score,
      away_goals: a.score,
      final_period: periodo === 'OT' || periodo === 'SO' ? periodo : 'REG',
    });
  }
  return out;
}

export function guardarPartidos(xs: PartidoNhl[], ahora = new Date()): number {
  const st = getDb().prepare(
    `INSERT INTO nhl_games (id, season, game_type, game_date, home_id, away_id, home_name, away_name, home_goals, away_goals, final_period, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET home_goals = excluded.home_goals, away_goals = excluded.away_goals, final_period = excluded.final_period, ingested_at = excluded.ingested_at`,
  );
  let n = 0;
  for (const x of xs) {
    st.run(x.id, x.season, x.game_type, x.game_date, x.home_id, x.away_id, x.home_name, x.away_name, x.home_goals, x.away_goals, x.final_period, ahora.toISOString());
    n++;
  }
  return n;
}

/** Semana a semana entre dos fechas. Devuelve lo guardado; lanza con un mensaje claro si la fuente falla. */
export async function ingestarRango(desde: string, hasta: string, f: typeof fetch = fetch, log: (m: string) => void = () => {}): Promise<{ semanas: number; partidos: number }> {
  let fecha = desde;
  let semanas = 0;
  let partidos = 0;
  while (fecha <= hasta) {
    let res: Response;
    try {
      res = await f(`${NHL_API}/schedule/${fecha}`);
    } catch (e) {
      throw new Error(`no se pudo contactar con api-web.nhle.com (${(e as Error).message}); no se ha escrito nada de esta semana`);
    }
    if (!res.ok) throw new Error(`api-web.nhle.com contestó ${res.status} para ${fecha}`);
    const j = (await res.json()) as { nextStartDate?: string };
    partidos += guardarPartidos(partidosDe(j));
    semanas++;
    const siguiente = j.nextStartDate ?? new Date(Date.parse(`${fecha}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    if (siguiente <= fecha) break;
    fecha = siguiente;
    if (semanas % 10 === 0) log(`NHL: ${semanas} semanas, ${partidos} partidos (hasta ${fecha})`);
  }
  return { semanas, partidos };
}
