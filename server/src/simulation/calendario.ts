// El calendario que queda por jugar (Fase 4.6).
//
// La base solo guarda los próximos días (fb_upcoming, naf_upcoming…): para simular una
// temporada hace falta TODO lo pendiente. Lo traen las fuentes que ya se descargan —
// openfootball lista los partidos sin jugar, nflverse la temporada entera, MLB Stats API el
// calendario— y se guarda aquí (`remaining_fixtures`, historia). Si para una liga de fútbol
// no hay nada, se reconstruye la doble vuelta que falta (cada par de equipos, ida y vuelta,
// menos lo ya jugado) y se dice «calendario reconstruido»: las fechas no se conocen, el
// conjunto de partidos sí.

import { getDb } from '../db.ts';
import type { SportId } from '../sports.ts';

export interface Fixture {
  fecha: string; // YYYYMMDD (o '' si se reconstruyó)
  homeId: string;
  awayId: string;
  neutral: boolean;
}

export interface Calendario {
  partidos: Fixture[];
  origen: 'fuente' | 'reconstruido' | 'ninguno';
  fuente: string | null;
  actualizado: string | null;
}

/** Sustituye el calendario pendiente de una liga y temporada por el de la fuente. */
export function guardarCalendario(sport: SportId, league: string, season: number, partidos: Fixture[], fuente: string, ahora = new Date()): number {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM remaining_fixtures WHERE sport = ? AND league = ? AND season = ?').run(sport, league, season);
    const ins = db.prepare(
      'INSERT OR REPLACE INTO remaining_fixtures (sport, league, season, fixture_date, home_id, away_id, neutral, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const p of partidos) ins.run(sport, league, season, p.fecha, p.homeId, p.awayId, p.neutral ? 1 : 0, fuente, ahora.toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return partidos.length;
}

/** Lo pendiente de la fuente a partir de `desde` (YYYYMMDD inclusive). */
export function calendarioGuardado(sport: SportId, league: string, season: number, desde: string): Calendario {
  const filas = getDb()
    .prepare(
      `SELECT fixture_date AS fecha, home_id AS homeId, away_id AS awayId, neutral, source, updated_at
         FROM remaining_fixtures WHERE sport = ? AND league = ? AND season = ? AND fixture_date >= ? ORDER BY fixture_date, home_id`,
    )
    .all(sport, league, season, desde) as unknown as { fecha: string; homeId: string; awayId: string; neutral: number; source: string; updated_at: string }[];
  if (!filas.length) return { partidos: [], origen: 'ninguno', fuente: null, actualizado: null };
  return {
    partidos: filas.map((f) => ({ fecha: f.fecha, homeId: f.homeId, awayId: f.awayId, neutral: !!f.neutral })),
    origen: 'fuente',
    fuente: filas[0].source,
    actualizado: filas[0].updated_at,
  };
}

/**
 * La doble vuelta pendiente: cada par ordenado (local, visitante) que todavía no se ha
 * jugado esta temporada. Solo para ligas de todos contra todos; una liga con grupos o
 * apertura/clausura (Liga MX, Argentina) saldría mal, y la configuración lo dice.
 */
export function reconstruirDobleVuelta(equipos: string[], jugados: { homeId: string; awayId: string }[]): Fixture[] {
  const hecho = new Set(jugados.map((j) => `${j.homeId}|${j.awayId}`));
  const out: Fixture[] = [];
  const ids = [...equipos].sort();
  for (const h of ids) for (const a of ids) if (h !== a && !hecho.has(`${h}|${a}`)) out.push({ fecha: '', homeId: h, awayId: a, neutral: false });
  return out;
}
