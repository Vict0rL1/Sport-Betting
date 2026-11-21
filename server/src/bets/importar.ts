// Importar apuestas propias desde un CSV (Fase 5.16). Cabecera con los nombres de columna
// del registro (sport, event, market, selection, odds, stake; opcionales placed_on, league,
// status, payout, notes, tags, model_prob, market_prob, match_key); separador coma o punto y
// coma; comillas RFC 4180. Cada fila se valida como una apuesta normal: lo que no pasa se
// devuelve con su número de línea y NO se guarda nada de esa fila.

import { normalizarEtiquetas, type Bet, type BetInput } from '../bets.ts';
import { parseBet } from './validar.ts';

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

const COLUMNAS = ['placed_on', 'sport', 'league', 'event', 'market', 'selection', 'odds', 'stake', 'status', 'payout', 'notes', 'model_prob', 'market_prob', 'match_key', 'tags', 'currency'] as const;

/**
 * Las etiquetas de una celda: la lista JSON que escribe la exportación (`["a","b"]`, que puede llevar
 * comas o punto y coma dentro de una etiqueta) o una lista a mano separada por `|` o `;`. Antes la
 * JSON entraba como UNA etiqueta (revisión data-guardian).
 */
function leerEtiquetas(celda: string): string[] {
  const c = celda.trim();
  if (!c) return [];
  if (c.startsWith('[')) {
    try {
      const v = JSON.parse(c) as unknown;
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return normalizarEtiquetas(v);
    } catch {
      // No es JSON: se lee como lista a mano.
    }
  }
  return normalizarEtiquetas(c.split(/[|;]/));
}

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
    // Un apóstrofo delante de = + - @ tab o CR es el que pone la exportación (exports/datasets.ts,
    // aCsv) para que una hoja de cálculo no lo abra como fórmula: se quita al volver a importar.
    const v = (k: string) => {
      const j = idx(k);
      return j >= 0 ? (f[j] ?? '').trim().replace(/^'(?=[=+\-@\t\r])/, '') : '';
    };
    try {
      // La misma validación que POST /api/bets (bets/validar.ts): deporte, mercado, cuota, estado,
      // fecha, probabilidades, cashout con importe, longitudes y etiquetas. Una celda opcional
      // vacía es «no dado»; las obligatorias vacías dan su error.
      const opcional = (k: string) => v(k) || undefined;
      // La API toma un número opcional ilegible como vacío; aquí se rechaza la fila, como antes:
      // «55 %» en model_prob no puede perderse en silencio (revisión data-guardian).
      for (const k of ['payout', 'model_prob', 'market_prob']) {
        const t = v(k);
        if (t && !Number.isFinite(Number(t.replace(',', '.')))) throw new Error(`${k}: «${t}» no es un número`);
      }
      const parsed = parseBet(
        {
          sport: v('sport'),
          event: v('event'),
          market: v('market') || 'other',
          selection: v('selection'),
          odds: v('odds'),
          stake: v('stake'),
          placed_on: opcional('placed_on'),
          league: opcional('league'),
          status: opcional('status'),
          payout: opcional('payout'),
          notes: opcional('notes'),
          model_prob: opcional('model_prob'),
          market_prob: opcional('market_prob'),
          match_key: opcional('match_key'),
          currency: opcional('currency'),
          tags: leerEtiquetas(v('tags')),
        },
        false,
      );
      if ('errors' in parsed) throw new Error(parsed.errors.map((e) => `${e.field}: ${e.message}`).join('; '));
      const input = parsed.input as BetInput;
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
