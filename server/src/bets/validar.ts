// LA VALIDACIÓN DE UNA APUESTA, una sola para la API (POST y PATCH /api/bets) y la importación por CSV
// (bets/importar.ts). Antes vivía en routes/bets.ts y la importación no pasaba por ella: una fila con
// deporte «foo» o cuota 5000 entraba en el libro mayor (revisión data-guardian del 21-nov).
import { BET_CURRENCIES, BET_MARKETS, BET_SPORTS, BET_STATUSES, normalizarEtiquetas, type BetInput, type BetStatus } from '../bets.ts';

/** A finite number, accepting the comma decimal separator a Spanish keyboard gives. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un error de validación. `code` (y `params`) es estable y la web lo traduce (G2 de la revisión del
 * PR 17: el texto del servidor está en español); `message` sigue para quien lea la API.
 */
export interface Problem {
  field: string;
  code: string;
  params?: Record<string, string | number>;
  message: string;
}

/**
 * Validate a body into a BetInput.
 *
 * `partial` skips the required-field checks, for PATCH — where sending only
 * `{status:'won'}` has to be legal.
 */
export function parseBet(body: unknown, partial: boolean): { input: Partial<BetInput> } | { errors: Problem[] } {
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: Problem[] = [];
  const out: Partial<BetInput> = {};

  const has = (k: string) => k in b && b[k] !== undefined;

  if (has('sport') || !partial) {
    const v = text(b.sport);
    if (!v) errors.push({ field: 'sport', code: 'apuesta.falta-deporte', message: 'Falta el deporte.' });
    else if (!(BET_SPORTS as readonly string[]).includes(v))
      errors.push({ field: 'sport', code: 'apuesta.deporte-invalido', params: { lista: BET_SPORTS.join(', ') }, message: `Deporte no válido. Usa: ${BET_SPORTS.join(', ')}.` });
    else out.sport = v;
  }
  if (has('event') || !partial) {
    const v = text(b.event);
    if (!v) errors.push({ field: 'event', code: 'apuesta.falta-evento', message: 'Falta el partido o evento.' });
    else out.event = v.slice(0, 200);
  }
  if (has('market') || !partial) {
    const v = text(b.market);
    if (!v) errors.push({ field: 'market', code: 'apuesta.falta-mercado', message: 'Falta el mercado.' });
    else if (!(BET_MARKETS as readonly string[]).includes(v))
      errors.push({ field: 'market', code: 'apuesta.mercado-invalido', params: { lista: BET_MARKETS.join(', ') }, message: `Mercado no válido. Usa: ${BET_MARKETS.join(', ')}.` });
    else out.market = v;
  }
  if (has('selection') || !partial) {
    const v = text(b.selection);
    if (!v) errors.push({ field: 'selection', code: 'apuesta.falta-seleccion', message: 'Falta qué apostaste.' });
    else out.selection = v.slice(0, 200);
  }
  if (has('odds') || !partial) {
    const v = num(b.odds);
    // Decimal odds below 1 pay less than the stake back, which is not a price a
    // book offers — it is almost always an American odds figure in the wrong box.
    if (v == null) errors.push({ field: 'odds', code: 'apuesta.cuota-no-numero', message: 'La cuota tiene que ser un número.' });
    else if (v <= 1) errors.push({ field: 'odds', code: 'apuesta.cuota-minima', message: 'La cuota decimal tiene que ser mayor que 1 (ej. 1.85).' });
    else if (v > 1000) errors.push({ field: 'odds', code: 'apuesta.cuota-alta', message: 'Cuota demasiado alta, revisa el número.' });
    else out.odds = v;
  }
  if (has('stake') || !partial) {
    const v = num(b.stake);
    if (v == null) errors.push({ field: 'stake', code: 'apuesta.cantidad-no-numero', message: 'La cantidad tiene que ser un número.' });
    else if (v <= 0) errors.push({ field: 'stake', code: 'apuesta.cantidad-minima', message: 'La cantidad tiene que ser mayor que 0.' });
    // Céntimos y no más (D8): 10,005 es un error de tecleo, no 10,00. No se trunca nunca.
    else if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) errors.push({ field: 'stake', code: 'apuesta.dos-decimales', message: 'Como mucho 2 decimales.' });
    else if (v > 1_000_000) errors.push({ field: 'stake', code: 'apuesta.cantidad-alta', message: 'Cantidad demasiado alta, revisa el número.' });
    else out.stake = v;
  }
  if (has('currency')) {
    const v = b.currency === null ? null : text(b.currency);
    if (v != null && !(BET_CURRENCIES as readonly string[]).includes(v))
      errors.push({ field: 'currency', code: 'apuesta.moneda-invalida', params: { lista: BET_CURRENCIES.join(', ') }, message: `Moneda no válida. Usa: ${BET_CURRENCIES.join(', ')}.` });
    else out.currency = v;
  }

  if (has('status')) {
    const v = text(b.status);
    if (!v || !BET_STATUSES.includes(v as BetStatus))
      errors.push({ field: 'status', code: 'apuesta.estado-invalido', params: { lista: BET_STATUSES.join(', ') }, message: `Estado no válido. Usa: ${BET_STATUSES.join(', ')}.` });
    else out.status = v as BetStatus;
  }
  if (has('placed_on')) {
    const v = text(b.placed_on);
    if (!v || !DAY_RE.test(v)) errors.push({ field: 'placed_on', code: 'apuesta.fecha-invalida', message: 'La fecha tiene que ser AAAA-MM-DD.' });
    else out.placed_on = v;
  }
  if (has('payout')) {
    const v = b.payout === null ? null : num(b.payout);
    if (v != null && v < 0) errors.push({ field: 'payout', code: 'apuesta.retorno-negativo', message: 'El retorno no puede ser negativo.' });
    else out.payout = v;
  }
  for (const [key, max] of [['league', 80], ['notes', 500], ['match_key', 200]] as const) {
    if (has(key)) out[key] = b[key] === null ? null : (text(b[key]) ?? '').slice(0, max) || null;
  }
  if (has('tags')) {
    const v = b.tags;
    if (v === null) out.tags = [];
    else if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) errors.push({ field: 'tags', code: 'apuesta.etiquetas-invalidas', message: 'Las etiquetas son una lista de textos.' });
    else out.tags = normalizarEtiquetas(v as string[]);
  }
  if (has('snapshot_id')) {
    const v = b.snapshot_id;
    if (v === null) out.snapshot_id = null;
    else if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) errors.push({ field: 'snapshot_id', code: 'apuesta.enlace-invalido', message: 'La estimación enlazada tiene que ser el id de una instantánea.' });
    else out.snapshot_id = v;
  }
  for (const key of ['model_prob', 'market_prob'] as const) {
    if (has(key)) {
      const v = b[key] === null ? null : num(b[key]);
      if (v != null && (v < 0 || v > 1))
        errors.push({ field: key, code: 'apuesta.probabilidad-rango', message: 'La probabilidad va entre 0 y 1.' });
      else out[key] = v;
    }
  }

  // A cashout without the returned amount cannot be scored, and guessing it from
  // the odds would report a profit the bet never produced.
  const status = out.status ?? (partial ? undefined : 'pending');
  if (status === 'cashout' && out.payout == null) {
    errors.push({ field: 'payout', code: 'apuesta.cashout-sin-importe', message: 'Un cashout necesita el importe que te devolvieron.' });
  }

  return errors.length ? { errors } : { input: out };
}
