// Seguimiento: lo que la persona quiere ver primero y de lo que quiere enterarse.
import { getDb } from '../db.ts';
import { SPORT_IDS, type SportId } from '../sports.ts';

export type TipoSeguido = 'equipo' | 'jugador' | 'partido';
export const TIPOS_SEGUIDOS: TipoSeguido[] = ['equipo', 'jugador', 'partido'];

export interface Seguido {
  id: number;
  kind: TipoSeguido;
  sport: SportId;
  league: string | null;
  ref_id: string;
  label: string;
  created_at: string;
}

export function listarSeguidos(): Seguido[] {
  return getDb().prepare('SELECT id, kind, sport, league, ref_id, label, created_at FROM watchlist ORDER BY created_at DESC, id DESC').all() as unknown as Seguido[];
}

export function validarSeguido(x: unknown): Omit<Seguido, 'id' | 'created_at'> {
  const o = (x ?? {}) as Record<string, unknown>;
  if (!TIPOS_SEGUIDOS.includes(o.kind as TipoSeguido)) throw new Error(`tipo desconocido: ${String(o.kind)}`);
  if (!(SPORT_IDS as readonly string[]).includes(String(o.sport))) throw new Error(`deporte desconocido: ${String(o.sport)}`);
  const ref = typeof o.ref_id === 'string' ? o.ref_id.trim() : '';
  if (!ref || ref.length > 200) throw new Error('ref_id vacío o demasiado largo');
  const label = typeof o.label === 'string' ? o.label.trim().slice(0, 200) : '';
  if (!label) throw new Error('falta la etiqueta');
  const league = typeof o.league === 'string' && o.league.trim() ? o.league.trim().slice(0, 64) : null;
  return { kind: o.kind as TipoSeguido, sport: o.sport as SportId, league, ref_id: ref, label };
}

/** Añade (o devuelve el existente): seguir dos veces no duplica. */
export function seguir(x: Omit<Seguido, 'id' | 'created_at'>, ahora = new Date()): Seguido {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO watchlist (kind, sport, league, ref_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(x.kind, x.sport, x.league, x.ref_id, x.label, ahora.toISOString());
  return db.prepare('SELECT id, kind, sport, league, ref_id, label, created_at FROM watchlist WHERE kind = ? AND sport = ? AND ref_id = ?').get(x.kind, x.sport, x.ref_id) as unknown as Seguido;
}

export function dejarDeSeguir(id: number): boolean {
  return Number(getDb().prepare('DELETE FROM watchlist WHERE id = ?').run(id).changes) > 0;
}

/** ¿Se sigue este partido (o alguno de sus equipos/jugadores)? Para las notificaciones de línea. */
export function seguido(sport: string, matchKey: string, participantes: string[] = []): boolean {
  const db = getDb();
  const partido = db.prepare("SELECT 1 FROM watchlist WHERE kind = 'partido' AND sport = ? AND ref_id = ? LIMIT 1").get(sport, matchKey);
  if (partido) return true;
  if (!participantes.length) return false;
  const q = db.prepare("SELECT 1 FROM watchlist WHERE kind IN ('equipo', 'jugador') AND sport = ? AND ref_id = ? LIMIT 1");
  return participantes.some((p) => !!q.get(sport, p));
}

export function haySeguidos(): boolean {
  return ((getDb().prepare('SELECT COUNT(*) AS n FROM watchlist').get() as { n: number }).n ?? 0) > 0;
}
