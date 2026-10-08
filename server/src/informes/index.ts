// Los informes archivados (Fase 6.7–6.9): generar, guardar una vez y servir.
//
// «Cada mañana» es a partir de las 7:00 de APP_TIMEZONE: el trabajo corre cada hora y genera el
// del día si todavía no existe, así que un servidor que arranca a las 11 lo genera a las 11 y no
// se lo salta. El semanal, igual con la semana anterior a partir del lunes a las 7:00. Uno por
// tipo y periodo: generar dos veces devuelve el que ya había, porque un informe archivado dice lo
// que se sabía cuando se escribió.

import { getDb } from '../db.ts';
import { featureEncendida } from '../features.ts';
import { notificar } from '../notifications/index.ts';
import { datosDiario, markdownDiario } from './diario.ts';
import { datosSemanal, markdownSemanal, semanaAnterior } from './semanal.ts';
import { local, zonaApp } from './tiempo.ts';

export { REPORTS_SCHEMA } from './schema.ts';

export type TipoInforme = 'diario' | 'semanal';
export const HORA_INFORMES = 7;

export interface ResumenInforme {
  id: number;
  tipo: TipoInforme;
  periodo: string;
  created_at: string;
  titulo: string;
  resumen: string;
}
export interface Informe extends ResumenInforme {
  markdown: string;
  datos: unknown;
}

const fila = (r: Record<string, unknown>): Informe => ({ ...(r as unknown as Informe), datos: JSON.parse(String(r.datos)) });

export function informe(id: number): Informe | null {
  const r = getDb().prepare('SELECT * FROM reports WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? fila(r) : null;
}

export function informeDe(tipo: TipoInforme, periodo: string): Informe | null {
  const r = getDb().prepare('SELECT * FROM reports WHERE tipo = ? AND periodo = ?').get(tipo, periodo) as Record<string, unknown> | undefined;
  return r ? fila(r) : null;
}

export function listarInformes(opts: { tipo?: TipoInforme; limite?: number } = {}): ResumenInforme[] {
  const limite = Math.max(1, Math.min(500, opts.limite ?? 60));
  return getDb()
    .prepare(`SELECT id, tipo, periodo, created_at, titulo, resumen FROM reports ${opts.tipo ? 'WHERE tipo = ?' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...(opts.tipo ? [opts.tipo, limite] : [limite])) as unknown as ResumenInforme[];
}

function guardar(tipo: TipoInforme, periodo: string, r: { titulo: string; resumen: string; markdown: string }, datos: unknown, ahora: Date): { informe: Informe; nuevo: boolean } {
  const ya = informeDe(tipo, periodo);
  if (ya) return { informe: ya, nuevo: false };
  const alta = getDb()
    .prepare('INSERT OR IGNORE INTO reports (tipo, periodo, created_at, titulo, resumen, markdown, datos) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(tipo, periodo, ahora.toISOString(), r.titulo, r.resumen, r.markdown, JSON.stringify(datos));
  const guardado = informeDe(tipo, periodo) as Informe;
  return { informe: guardado, nuevo: Number(alta.changes) > 0 };
}

/** El del día de `ahora` (en la zona), lo genera si falta. No mira la hora: eso es del trabajo. */
export function generarDiario(ahora = new Date(), zona = zonaApp()): { informe: Informe; nuevo: boolean } {
  const ya = informeDe('diario', local(ahora, zona).fecha);
  if (ya) return { informe: ya, nuevo: false };
  const d = datosDiario(ahora, zona);
  const r = guardar('diario', d.fecha, markdownDiario(d), d, ahora);
  if (r.nuevo) void notificar('digest_listo', { titulo: r.informe.titulo, cuerpo: r.informe.resumen, url: `/informes/${r.informe.id}` });
  return r;
}

/** El de la semana anterior a `ahora`, lo genera si falta. */
export function generarSemanal(ahora = new Date(), zona = zonaApp()): { informe: Informe; nuevo: boolean } {
  const ya = informeDe('semanal', semanaAnterior(ahora, zona).semana);
  if (ya) return { informe: ya, nuevo: false };
  const d = datosSemanal(ahora, zona);
  const r = guardar('semanal', d.semana, markdownSemanal(d), d, ahora);
  if (r.nuevo) void notificar('informe_semanal', { titulo: r.informe.titulo, cuerpo: r.informe.resumen, url: `/informes/${r.informe.id}` });
  return r;
}

/** El trabajo programado del diario: a partir de las 7:00 locales, una vez al día. */
export function cicloResumenDiario(log: (m: string) => void = () => {}, ahora = new Date(), zona = zonaApp()): Informe | null {
  if (!featureEncendida('informes.diario')) return null;
  if (local(ahora, zona).hora < HORA_INFORMES) return null;
  const r = generarDiario(ahora, zona);
  if (r.nuevo) log(`Resumen diario ${r.informe.periodo} archivado (#${r.informe.id}).`);
  return r.informe;
}

/** El trabajo programado del semanal: la semana anterior, a partir del lunes a las 7:00. */
export function cicloInformeSemanal(log: (m: string) => void = () => {}, ahora = new Date(), zona = zonaApp()): Informe | null {
  if (!featureEncendida('informes.semanal')) return null;
  const l = local(ahora, zona);
  if (l.diaSemana === 1 && l.hora < HORA_INFORMES) return null;
  const r = generarSemanal(ahora, zona);
  if (r.nuevo) log(`Informe semanal ${r.informe.periodo} archivado (#${r.informe.id}).`);
  return r.informe;
}
