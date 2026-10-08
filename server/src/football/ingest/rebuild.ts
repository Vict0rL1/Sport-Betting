// Qué pasa con lo que ya hay en fb_matches cuando se vuelve a ingerir una liga.
//
// Hasta la Fase 2 `update-data:fb` empezaba BORRANDO la liga entera y la rellenaba desde las
// fuentes. Funcionaba mientras las fuentes respondieran; el día que openfootball o
// football-data no contestaban, la liga se quedaba vacía y el Elo se recalculaba sobre nada.
// Las tres fuentes ya escriben con `INSERT … ON CONFLICT DO UPDATE` dentro de una transacción,
// así que el borrado no hacía falta para no duplicar: solo servía para «limpiar». Ahora la
// ingesta es incremental por defecto y el borrado existe solo como decisión explícita
// (`--rebuild`), para cuando una fuente cambió de criterio y hay que rehacer la liga.

import { getDb } from '../../db.ts';

export interface EstadoLiga {
  partidos: number;
  equipos: number;
}

export function estadoLiga(ligaId: string): EstadoLiga {
  const db = getDb();
  return {
    partidos: (db.prepare('SELECT COUNT(*) AS n FROM fb_matches WHERE league = ?').get(ligaId) as { n: number }).n,
    equipos: (db.prepare('SELECT COUNT(*) AS n FROM fb_teams WHERE league = ?').get(ligaId) as { n: number }).n,
  };
}

/** Borra partidos, equipos y ratings de las ligas, en una transacción. Solo con `--rebuild`. */
export function borrarLigas(ligas: string[]): Record<string, EstadoLiga> {
  const db = getDb();
  const antes: Record<string, EstadoLiga> = {};
  db.exec('BEGIN');
  try {
    for (const l of ligas) {
      antes[l] = estadoLiga(l);
      db.prepare('DELETE FROM fb_matches WHERE league = ?').run(l);
      db.prepare('DELETE FROM fb_teams WHERE league = ?').run(l);
      db.prepare('DELETE FROM fb_team_ratings WHERE league = ?').run(l);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return antes;
}

/**
 * Prepara la ingesta de las ligas: incremental (no toca nada) o reconstrucción (borra).
 * Devuelve lo que había, para que el resumen final pueda decir cuántos partidos son nuevos.
 */
export function prepararIngesta(ligas: string[], opts: { rebuild: boolean }): { modo: 'incremental' | 'rebuild'; antes: Record<string, EstadoLiga> } {
  if (opts.rebuild) return { modo: 'rebuild', antes: borrarLigas(ligas) };
  const antes: Record<string, EstadoLiga> = {};
  for (const l of ligas) antes[l] = estadoLiga(l);
  return { modo: 'incremental', antes };
}
