// Estimaciones guardadas (rediseño de noviembre, FAV-3). Ver el esquema en watchlist/schema.ts.
//
// Se guarda la REFERENCIA a una instantánea que ya existe (sport + match_key + id). La etiqueta la
// pone el servidor a partir de la propia instantánea, no el navegador: lo guardado dice lo que se
// publicó, con su hora. Quitar una guardada solo borra la referencia.

import { getDb } from '../db.ts';
import { SPORT_IDS, type SportId } from '../sports.ts';

export interface Guardada {
  id: number;
  sport: SportId;
  match_key: string;
  snapshot_id: number;
  label: string;
  created_at: string;
  /** De la instantánea, tal como se guardó. */
  captured_at: string;
  commence_time: string;
  outcomes: string[];
  probs: number[];
  model_version: string | null;
}

const pct = (p: number) => `${Math.round(p * 1000) / 10}`.replace('.', ',');

export function guardarInstantanea(x: { sport: SportId; matchKey: string; snapshotId: number }, ahora = new Date()): Guardada {
  if (!(SPORT_IDS as readonly string[]).includes(x.sport)) throw new Error(`deporte desconocido: ${String(x.sport)}`);
  if (!Number.isInteger(x.snapshotId) || x.snapshotId <= 0) throw new Error('la instantánea no existe');
  const db = getDb();
  const s = db
    .prepare('SELECT id, outcomes, probs, captured_at FROM prediction_snapshots WHERE id = ? AND sport = ? AND match_key = ?')
    .get(x.snapshotId, x.sport, x.matchKey) as { id: number; outcomes: string; probs: string; captured_at: string } | undefined;
  if (!s) throw new Error('la instantánea no existe para ese partido');
  const outcomes = JSON.parse(s.outcomes) as string[];
  const probs = JSON.parse(s.probs) as number[];
  const label = `${outcomes.map((o, i) => `${o} ${pct(probs[i])} %`).join(' · ')} (${s.captured_at.slice(0, 16).replace('T', ' ')} UTC)`.slice(0, 200);
  db.prepare('INSERT OR IGNORE INTO saved_predictions (sport, match_key, snapshot_id, label, created_at) VALUES (?, ?, ?, ?, ?)').run(x.sport, x.matchKey, x.snapshotId, label, ahora.toISOString());
  const r = listarGuardadas().find((g) => g.sport === x.sport && g.snapshot_id === x.snapshotId);
  if (!r) throw new Error('no se pudo guardar');
  return r;
}

export function listarGuardadas(): Guardada[] {
  const filas = getDb()
    .prepare(
      `SELECT g.id, g.sport, g.match_key, g.snapshot_id, g.label, g.created_at,
              s.captured_at, s.commence_time, s.outcomes, s.probs, s.model_version
         FROM saved_predictions g JOIN prediction_snapshots s ON s.id = g.snapshot_id
        ORDER BY g.created_at DESC, g.id DESC`,
    )
    .all() as Record<string, unknown>[];
  return filas.map((r) => ({
    id: Number(r.id),
    sport: r.sport as SportId,
    match_key: String(r.match_key),
    snapshot_id: Number(r.snapshot_id),
    label: String(r.label),
    created_at: String(r.created_at),
    captured_at: String(r.captured_at),
    commence_time: String(r.commence_time),
    outcomes: JSON.parse(String(r.outcomes)) as string[],
    probs: JSON.parse(String(r.probs)) as number[],
    model_version: (r.model_version as string | null) ?? null,
  }));
}

export function quitarGuardada(id: number): boolean {
  return Number(getDb().prepare('DELETE FROM saved_predictions WHERE id = ?').run(id).changes) > 0;
}
