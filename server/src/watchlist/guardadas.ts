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
  /** La fila de próximos del partido (para enlazar su ficha); null si la instantánea no la guardó. */
  event_id: string | null;
  commence_time: string;
  outcomes: string[];
  probs: number[];
  model_version: string | null;
  /** Nota personal (E3): editable, aparte de la instantánea. null = sin nota. */
  nota: string | null;
  notaEn: string | null;
  /**
   * La estimación más reciente registrada de ese partido (E4), para comparar con lo guardado. Puede
   * ser la misma instantánea; null si el partido ya no tiene ninguna (no se inventa).
   */
  actual: { snapshot_id: number; captured_at: string; outcomes: string[]; probs: number[]; model_version: string | null } | null;
}

/** Largo máximo de una nota. */
export const NOTA_MAX = 1000;

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
      `SELECT g.id, g.sport, g.match_key, g.snapshot_id, g.label, g.created_at, g.note, g.note_updated_at,
              s.captured_at, s.commence_time, s.outcomes, s.probs, s.model_version, s.event_id,
              u.id AS u_id, u.captured_at AS u_en, u.outcomes AS u_outcomes, u.probs AS u_probs, u.model_version AS u_version
         FROM saved_predictions g JOIN prediction_snapshots s ON s.id = g.snapshot_id
         LEFT JOIN prediction_snapshots u ON u.id = (SELECT x.id FROM prediction_snapshots x WHERE x.sport = g.sport AND x.match_key = g.match_key
                                                     ORDER BY x.captured_at DESC, x.id DESC LIMIT 1)
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
    event_id: (r.event_id as string | null) ?? null,
    commence_time: String(r.commence_time),
    outcomes: JSON.parse(String(r.outcomes)) as string[],
    probs: JSON.parse(String(r.probs)) as number[],
    model_version: (r.model_version as string | null) ?? null,
    nota: (r.note as string | null) ?? null,
    notaEn: (r.note_updated_at as string | null) ?? null,
    actual:
      r.u_id == null
        ? null
        : { snapshot_id: Number(r.u_id), captured_at: String(r.u_en), outcomes: JSON.parse(String(r.u_outcomes)) as string[], probs: JSON.parse(String(r.u_probs)) as number[], model_version: (r.u_version as string | null) ?? null },
  }));
}

/**
 * Escribe, cambia o borra (en blanco) la nota de una estimación guardada. Es un dato personal: solo
 * toca la fila de saved_predictions, nunca la instantánea. null si la guardada no existe.
 */
export function anotarGuardada(id: number, nota: string | null, ahora = new Date()): Guardada | null {
  const limpia = nota == null ? null : nota.trim() || null;
  if (limpia != null && limpia.length > NOTA_MAX) throw new Error(`la nota tiene más de ${NOTA_MAX} caracteres`);
  const r = getDb().prepare('UPDATE saved_predictions SET note = ?, note_updated_at = ? WHERE id = ?').run(limpia, limpia == null ? null : ahora.toISOString(), id);
  if (Number(r.changes) === 0) return null;
  return listarGuardadas().find((g) => g.id === id) ?? null;
}

export function quitarGuardada(id: number): boolean {
  return Number(getDb().prepare('DELETE FROM saved_predictions WHERE id = ?').run(id).changes) > 0;
}
