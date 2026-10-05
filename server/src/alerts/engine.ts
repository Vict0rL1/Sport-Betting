// Alertas internas: un registro de cosas interesantes que han pasado, con su motivo.
//
// Sin SMS ni correo (no hay esa infraestructura): una tabla append-only que la app enseña
// y que cualquier canal futuro puede leer. Cada alerta sale de un hecho guardado —una
// instantánea, una evaluación, una apuesta—, nunca de una suposición, y lleva los datos
// que la dispararon.
//
// Tipos y de dónde salen:
//   edge_umbral            la evaluación de un partido pasa a BET (trust/assess.ts)
//   calidad_datos_baja     la calidad de datos cae 20 puntos o más (trust/assess.ts)
//   cuotas_viejas          la evaluación abstiene por un precio de más de 6 h
//   deriva                 la evaluación detecta deriva reciente del deporte
//   cambio_prediccion      la probabilidad enseñada se mueve ≥ 3 pp entre instantáneas
//   mercado_movido         la probabilidad del mercado se mueve ≥ 5 pp entre instantáneas
//   alineacion_confirmada  fútbol: una alineación pasa a publicada
//   abridor_cambiado       MLB: cambia (o se anuncia) un abridor
//   qb_cambiado            NFL: cambia el QB supuesto
//   limite_riesgo          una apuesta se recorta o se descarta por un tope de grupo
//
// Una alerta igual (tipo + partido) no se repite en 6 horas: una alerta que suena cada
// cuarto de hora se deja de leer.

import { getDb } from '../db.ts';

export { ALERTS_SCHEMA } from './schema.ts';

export type TipoAlerta =
  | 'edge_umbral' | 'calidad_datos_baja' | 'cuotas_viejas' | 'deriva' | 'cambio_prediccion' | 'mercado_movido'
  | 'alineacion_confirmada' | 'abridor_cambiado' | 'qb_cambiado' | 'limite_riesgo';

export const SILENCIO_HORAS = 6;

export interface Alerta {
  id: number;
  created_at: string;
  type: TipoAlerta;
  severity: 'info' | 'aviso' | 'importante';
  sport: string | null;
  match_key: string | null;
  title: string;
  body: string;
  data: unknown;
}

/** Emite una alerta salvo que la misma (tipo + partido) haya sonado hace menos de 6 h. Nunca lanza. */
export function emitirAlerta(
  a: { type: TipoAlerta; severity?: Alerta['severity']; sport?: string | null; matchKey?: string | null; title: string; body: string; data?: unknown },
  now = new Date(),
): boolean {
  try {
    const db = getDb();
    const desde = new Date(now.getTime() - SILENCIO_HORAS * 3_600_000).toISOString();
    const reciente = db
      .prepare('SELECT 1 FROM alerts WHERE type = ? AND COALESCE(sport, \'\') = ? AND COALESCE(match_key, \'\') = ? AND created_at > ? LIMIT 1')
      .get(a.type, a.sport ?? '', a.matchKey ?? '', desde);
    if (reciente) return false;
    db.prepare('INSERT INTO alerts (created_at, type, severity, sport, match_key, title, body, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      now.toISOString(), a.type, a.severity ?? 'info', a.sport ?? null, a.matchKey ?? null, a.title, a.body, a.data === undefined ? null : JSON.stringify(a.data),
    );
    return true;
  } catch {
    return false;
  }
}

export function alertas(opts: { limit?: number; sport?: string; matchKey?: string } = {}): Alerta[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.sport) { where.push('sport = ?'); args.push(opts.sport); }
  if (opts.matchKey) { where.push('match_key = ?'); args.push(opts.matchKey); }
  return (
    getDb()
      .prepare(`SELECT * FROM alerts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...args, opts.limit ?? 100) as Record<string, unknown>[]
  ).map((r) => ({ ...(r as unknown as Alerta), data: r.data == null ? null : JSON.parse(String(r.data)) }));
}
