// Importar apuestas propias desde un CSV (Fase 5.16). Cabecera con los nombres de columna
// del registro (sport, event, market, selection, odds, stake; opcionales placed_on, league,
// status, payout, notes, tags, model_prob, market_prob, match_key); separador coma o punto y
// coma; comillas RFC 4180. Cada fila se valida como una apuesta normal: lo que no pasa se
// devuelve con su número de línea y NO se guarda nada de esa fila.

import { normalizarEtiquetas, type Bet, type BetInput } from '../bets.ts';
import { parseBet } from './validar.ts';
import { getDb } from '../db.ts';
import { diaEn, zonaPolitica } from '../staking/contabilidad.ts';

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

/** Un problema de una fila: su campo, un código estable (la web lo traduce) y el texto en español. */
export interface ErrorDeFila {
  campo: string;
  codigo: string;
  params?: Record<string, string | number>;
  mensaje: string;
}

/**
 * Lo que una fila válida pierde o puede repetir. No impide importarla: se dice ANTES.
 *   enlace-no-restaurado           la fila traía `snapshot_id`: un id de instantánea es de su instalación,
 *                                  no de esta, y no se engancha a otra que tenga el mismo número.
 *   posible-duplicado              idéntica (fecha, deporte, evento, mercado, selección, cuota, importe,
 *                                  moneda y estado) a una apuesta ya guardada o a otra fila del fichero.
 *                                  Puede ser legítimo (dos apuestas iguales): se avisa, no se descarta.
 *   dia-de-liquidacion-desconocido liquidada sin `settled_at` y colocada antes de hoy: entra con la hora
 *                                  de la importación y los límites de pérdida no sabrán qué día se
 *                                  liquidó (staking/contabilidad.ts).
 */
export type CodigoAviso = 'enlace-no-restaurado' | 'posible-duplicado' | 'dia-de-liquidacion-desconocido';

export interface FilaAnalizada {
  linea: number;
  valida: boolean;
  /** Lo que se guardaría, ya validado (solo si es válida). */
  apuesta: BetInput | null;
  errores: ErrorDeFila[];
  avisos: { codigo: CodigoAviso }[];
}

export interface Analisis {
  /** Un problema de todo el fichero (sin cabecera, sin una columna obligatoria): no hay filas. */
  error: ErrorDeFila | null;
  /** Columnas que no se leen (se ignoran). */
  ignoradas: string[];
  filas: FilaAnalizada[];
  resumen: { validas: number; rechazadas: number; conAvisos: number; omitidas: number };
}

const OBLIGATORIAS = ['sport', 'event', 'market', 'selection', 'odds', 'stake'];
const LEIDAS = new Set<string>([...COLUMNAS, 'settled_at', 'snapshot_id', 'created_at']);

/** Un instante ISO con zona: «…Z» o «…±hh:mm», como lo escribe la exportación. Sin zona no se adivina. */
const INSTANTE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Hoy (YYYY-MM-DD) en la zona de la política, como los límites de pérdida. */
const hoyPolitica = () => {
  const z = zonaPolitica().zona;
  return z ? (diaEn(new Date(), z) ?? new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10);
};

/**
 * La huella con que se reconoce un posible duplicado (ver CodigoAviso): sin el estado ni la moneda, que
 * cambian sin que la apuesta sea otra (una pendiente que ya se liquidó; una de antes de la v29 sin
 * moneda). Es un aviso: mejor de más que de menos (revisión data-guardian).
 */
const huella = (b: { placed_on?: string | null; sport: string; event: string; market: string; selection: string; odds: number; stake: number }) =>
  JSON.stringify([b.placed_on ?? null, b.sport, b.event, b.market, b.selection, b.odds, b.stake]);

/**
 * Lee y valida un CSV SIN escribir nada: qué filas entrarían, cuáles no y por qué (campo y código), y
 * qué avisos tiene cada una. La importación usa esto mismo, así que lo que dice la vista previa es lo
 * que hará, y vuelve a validarlo todo al importar.
 */
export function analizarCsv(texto: string, maxFilas = 1000): Analisis {
  const filas = parsearCsv(texto);
  const vacio = (e: ErrorDeFila): Analisis => ({ error: e, ignoradas: [], filas: [], resumen: { validas: 0, rechazadas: 0, conAvisos: 0, omitidas: 0 } });
  if (filas.length < 2) return vacio({ campo: '', codigo: 'importar.sin-filas', mensaje: 'hace falta una cabecera y al menos una fila' });
  const cab = filas[0].map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'));
  const idx = (k: string) => cab.indexOf(k);
  for (const req of OBLIGATORIAS) {
    if (idx(req) < 0) return vacio({ campo: req, codigo: 'importar.falta-columna', params: { columna: req }, mensaje: `falta la columna ${req}` });
  }
  const hoy = hoyPolitica();
  // Las apuestas guardadas con las fechas de colocación del fichero (usa idx_bets_day): leerlas todas
  // costaba 0,3–0,4 s con 100.000 (revisión data-guardian).
  const fechas = [...new Set(filas.slice(1, maxFilas + 1).map((f) => (idx('placed_on') >= 0 ? (f[idx('placed_on')] ?? '').trim() : '') || hoy))];
  const yaGuardadas = new Set<string>();
  for (let k = 0; k < fechas.length; k += 500) {
    const trozo = fechas.slice(k, k + 500);
    for (const b of getDb().prepare(`SELECT placed_on, sport, event, market, selection, odds, stake FROM bets WHERE placed_on IN (${trozo.map(() => '?').join(',')})`).all(...trozo) as unknown as Parameters<typeof huella>[0][]) yaGuardadas.add(huella(b));
  }
  const enEsteFichero = new Map<string, number>();
  const zona = zonaPolitica().zona;
  const out: FilaAnalizada[] = [];
  for (let i = 1; i < Math.min(filas.length, maxFilas + 1); i++) {
    const f = filas[i];
    // Un apóstrofo delante de = + - @ tab o CR es el que pone la exportación (exports/datasets.ts,
    // aCsv) para que una hoja de cálculo no lo abra como fórmula: se quita al volver a importar.
    const v = (k: string) => {
      const j = idx(k);
      return j >= 0 ? (f[j] ?? '').trim().replace(/^'(?=[=+\-@\t\r])/, '') : '';
    };
    const errores: ErrorDeFila[] = [];
    // La API toma un número opcional ilegible como vacío; aquí se rechaza la fila, como antes:
    // «55 %» en model_prob no puede perderse en silencio (revisión data-guardian).
    for (const k of ['payout', 'model_prob', 'market_prob']) {
      const t = v(k);
      if (t && !Number.isFinite(Number(t.replace(',', '.')))) errores.push({ campo: k, codigo: 'importar.no-es-numero', params: { valor: t }, mensaje: `«${t}» no es un número` });
    }
    // La misma validación que POST /api/bets (bets/validar.ts). Una celda opcional vacía es «no dado».
    const opcional = (k: string) => v(k) || undefined;
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
    if ('errors' in parsed) for (const e of parsed.errors) errores.push({ campo: e.field, codigo: e.code, params: e.params, mensaje: e.message });
    const input = 'errors' in parsed ? null : (parsed.input as BetInput);
    // La fecha de liquidación, si la trae: legible, de una liquidada, no antes de colocarse ni en el futuro.
    // La fecha de liquidación, si la trae: un instante ISO CON zona (una fecha a secas o una hora sin zona
    // no se adivina: el día de los límites depende de ella), de una liquidada, no futura y no anterior al
    // día de colocación en la zona de la política (revisión data-guardian).
    const sa = v('settled_at');
    // Entró ya liquidada en su instalación (settled_at = created_at): su día no se sabía y no se sabe.
    const sinDia = sa && v('created_at') && Date.parse(sa) === Date.parse(v('created_at'));
    if (input && sa && !sinDia) {
      const t = Date.parse(sa);
      const colocada = input.placed_on || hoy;
      if (!INSTANTE_RE.test(sa)) errores.push({ campo: 'settled_at', codigo: 'importar.liquidacion-sin-zona', params: { valor: sa }, mensaje: `settled_at: «${sa}» no es una fecha y hora con zona (p. ej. 2026-11-21T19:00:00Z)` });
      else if (!Number.isFinite(t)) errores.push({ campo: 'settled_at', codigo: 'importar.liquidacion-ilegible', params: { valor: sa }, mensaje: `settled_at: «${sa}» no es una fecha y hora` });
      else if ((input.status ?? 'pending') === 'pending') errores.push({ campo: 'settled_at', codigo: 'importar.liquidacion-de-pendiente', mensaje: 'settled_at: una apuesta pendiente no está liquidada' });
      else if (t > Date.now()) errores.push({ campo: 'settled_at', codigo: 'importar.liquidacion-futura', mensaje: 'settled_at: está en el futuro' });
      // En la zona de la política; sin ella, el primer instante posible del día (UTC+14: 14 h antes).
      else if (zona ? (diaEn(new Date(t), zona) ?? '') < colocada : t < Date.parse(`${colocada}T00:00:00Z`) - 14 * 3_600_000) {
        errores.push({ campo: 'settled_at', codigo: 'importar.liquidacion-antes', mensaje: 'settled_at: es anterior a la colocación' });
      } else input.settled_at = new Date(t).toISOString();
    }
    const avisos: FilaAnalizada['avisos'] = [];
    if (errores.length === 0 && input) {
      if (v('snapshot_id')) avisos.push({ codigo: 'enlace-no-restaurado' });
      const h = huella({ ...input, placed_on: input.placed_on || hoy });
      const antes = enEsteFichero.get(h);
      if (yaGuardadas.has(h) || antes != null) {
        avisos.push({ codigo: 'posible-duplicado' });
        // La primera del fichero también lo es, si otra la repite.
        if (antes != null && !out[antes].avisos.some((a) => a.codigo === 'posible-duplicado')) out[antes].avisos.push({ codigo: 'posible-duplicado' });
      }
      if (antes == null) enEsteFichero.set(h, out.length);
      if ((input.status ?? 'pending') !== 'pending' && !input.settled_at && (input.placed_on ?? hoy) < hoy) avisos.push({ codigo: 'dia-de-liquidacion-desconocido' });
    }
    out.push({ linea: i + 1, valida: errores.length === 0 && input != null, apuesta: errores.length === 0 ? input : null, errores, avisos });
  }
  const validas = out.filter((x) => x.valida).length;
  return {
    error: null,
    ignoradas: cab.filter((c) => c && !LEIDAS.has(c)),
    filas: out,
    resumen: { validas, rechazadas: out.length - validas, conAvisos: out.filter((x) => x.valida && x.avisos.length > 0).length, omitidas: Math.max(0, filas.length - 1 - maxFilas) },
  };
}

export interface ResultadoImportacion {
  importadas: number;
  rechazadas: { linea: number; error: string; errores?: ErrorDeFila[] }[];
  ids: number[];
  avisos: { linea: number; codigo: CodigoAviso }[];
  /** Filas que pasan del límite y no se leyeron. */
  omitidas: number;
}

/** Importa las filas válidas, validándolas de nuevo (`analizarCsv`); de las demás, la línea y el porqué. */
export function importarCsv(texto: string, crear: (input: BetInput) => Bet, maxFilas = 1000): ResultadoImportacion {
  const a = analizarCsv(texto, maxFilas);
  const out: ResultadoImportacion = { importadas: 0, rechazadas: [], ids: [], avisos: [], omitidas: a.resumen.omitidas };
  if (a.error) {
    out.rechazadas.push({ linea: 1, error: a.error.mensaje, errores: [a.error] });
    return out;
  }
  for (const f of a.filas) {
    if (!f.valida || !f.apuesta) {
      out.rechazadas.push({ linea: f.linea, error: f.errores.map((e) => (e.campo ? `${e.campo}: ${e.mensaje}` : e.mensaje)).join('; '), errores: f.errores });
      continue;
    }
    try {
      const b = crear(f.apuesta);
      out.importadas++;
      out.ids.push(b.id);
      for (const av of f.avisos) out.avisos.push({ linea: f.linea, codigo: av.codigo });
    } catch (e) {
      out.rechazadas.push({ linea: f.linea, error: (e as Error).message });
    }
  }
  return out;
}
