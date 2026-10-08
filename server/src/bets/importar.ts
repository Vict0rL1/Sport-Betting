// Importar apuestas propias desde un CSV (Fase 5.16). Cabecera con los nombres de columna
// del registro (sport, event, market, selection, odds, stake; opcionales placed_on, league,
// status, payout, notes, tags, model_prob, market_prob, match_key); separador coma o punto y
// coma; comillas RFC 4180. Cada fila se valida como una apuesta normal: lo que no pasa se
// devuelve con su número de línea y NO se guarda nada de esa fila.

import type { Bet, BetInput } from '../bets.ts';

export interface ResultadoImportacion {
  importadas: number;
  rechazadas: { linea: number; error: string }[];
  ids: number[];
}

export function parsearCsv(texto: string): string[][] {
  const sep = texto.split('\n')[0].includes(';') && !texto.split('\n')[0].includes(',') ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else entreComillas = false;
      } else celda += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda);
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas;
}

const COLUMNAS = ['placed_on', 'sport', 'league', 'event', 'market', 'selection', 'odds', 'stake', 'status', 'payout', 'notes', 'model_prob', 'market_prob', 'match_key', 'tags'] as const;

export function importarCsv(texto: string, crear: (input: BetInput) => Bet, maxFilas = 1000): ResultadoImportacion {
  const filas = parsearCsv(texto);
  const out: ResultadoImportacion = { importadas: 0, rechazadas: [], ids: [] };
  if (filas.length < 2) {
    out.rechazadas.push({ linea: 1, error: 'hace falta una cabecera y al menos una fila' });
    return out;
  }
  const cab = filas[0].map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'));
  const idx = (k: string) => cab.indexOf(k);
  for (const req of ['sport', 'event', 'market', 'selection', 'odds', 'stake']) {
    if (idx(req) < 0) {
      out.rechazadas.push({ linea: 1, error: `falta la columna ${req}` });
      return out;
    }
  }
  for (let i = 1; i < Math.min(filas.length, maxFilas + 1); i++) {
    const f = filas[i];
    const v = (k: string) => {
      const j = idx(k);
      return j >= 0 ? (f[j] ?? '').trim() : '';
    };
    try {
      const num = (k: string) => {
        const t = v(k);
        if (!t) return undefined;
        const n = Number(t.replace(',', '.'));
        if (!Number.isFinite(n)) throw new Error(`${k}: «${t}» no es un número`);
        return n;
      };
      const odds = num('odds');
      const stake = num('stake');
      if (odds == null || !(odds > 1)) throw new Error('odds: cuota decimal mayor que 1');
      if (stake == null || !(stake > 0)) throw new Error('stake: mayor que 0');
      const input: BetInput = {
        sport: v('sport'),
        event: v('event'),
        market: v('market') || 'other',
        selection: v('selection'),
        odds,
        stake,
        placed_on: v('placed_on') || undefined,
        league: v('league') || null,
        status: (v('status') || undefined) as BetInput['status'],
        payout: num('payout') ?? null,
        notes: v('notes') || null,
        model_prob: num('model_prob') ?? null,
        market_prob: num('market_prob') ?? null,
        match_key: v('match_key') || null,
        tags: v('tags') ? v('tags').split(/[|;]/).map((t) => t.trim()).filter(Boolean).slice(0, 12) : [],
      };
      if (!input.sport || !input.event || !input.selection) throw new Error('sport, event y selection son obligatorios');
      if (input.placed_on && !/^\d{4}-\d{2}-\d{2}$/.test(input.placed_on)) throw new Error('placed_on: AAAA-MM-DD');
      const b = crear(input);
      out.importadas++;
      out.ids.push(b.id);
    } catch (e) {
      out.rechazadas.push({ linea: i + 1, error: (e as Error).message });
    }
  }
  void COLUMNAS;
  return out;
}
