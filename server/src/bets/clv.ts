// CLV de las apuestas PROPIAS (Fase 5.16), cuando hay snapshot que casar. La apuesta del
// registro personal no lleva id del proveedor: se busca el evento por los nombres de los
// equipos y la selección por su texto. Si no casa, se dice «sin cierre» y punto.

import { getDb } from '../db.ts';
import { closingLine, selectionsOf } from '../odds/snapshots.ts';
import type { Bet } from '../bets.ts';

export interface ClvPropio {
  id: number;
  clv: number | null;
  cierre: number | null;
  casas: number | null;
  eventId: string | null;
  seleccion: string | null;
  motivo: string | null;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function clvDeApuesta(b: Bet): ClvPropio {
  const base: ClvPropio = { id: b.id, clv: null, cierre: null, casas: null, eventId: null, seleccion: null, motivo: null };
  if (b.market !== 'moneyline') return { ...base, motivo: 'solo se mide en el ganador (h2h)' };
  const partes = b.event.split(/\s+(?:vs\.?|@|-|–)\s+/i).map(norm);
  if (partes.length !== 2) return { ...base, motivo: 'no se reconocen los dos equipos en el evento' };
  const ev = getDb()
    .prepare(
      `SELECT event_id, home_team, away_team, commence_time FROM odds_snapshots
        WHERE market = 'h2h' AND home_team IS NOT NULL AND commence_time BETWEEN ? AND ?
        GROUP BY event_id ORDER BY commence_time`,
    )
    // El partido empieza el día de la apuesta o en los tres siguientes (se apuesta con antelación).
    .all(`${b.placed_on}T00:00:00Z`, new Date(Date.parse(`${b.placed_on}T00:00:00Z`) + 4 * 86_400_000).toISOString()) as { event_id: string; home_team: string; away_team: string; commence_time: string }[];
  const hit = ev.find((e) => {
    const h = norm(e.home_team);
    const a = norm(e.away_team);
    return partes.every((p) => h.includes(p) || p.includes(h) || a.includes(p) || p.includes(a));
  });
  if (!hit) return { ...base, motivo: 'sin snapshot de cuotas para ese partido en esa fecha' };
  const sels = selectionsOf(hit.event_id, 'h2h');
  const sel = norm(b.selection);
  const seleccion = sels.find((s) => norm(s) === sel) ?? sels.find((s) => norm(s).includes(sel) || sel.includes(norm(s))) ?? null;
  if (!seleccion) return { ...base, eventId: hit.event_id, motivo: 'la selección no casa con ninguna del mercado' };
  const cierre = closingLine(hit.event_id, 'h2h', seleccion, hit.commence_time);
  if (!cierre) return { ...base, eventId: hit.event_id, seleccion, motivo: 'sin observación de cierre' };
  return { id: b.id, clv: b.odds / cierre.consensus - 1, cierre: cierre.consensus, casas: cierre.books, eventId: hit.event_id, seleccion, motivo: null };
}
