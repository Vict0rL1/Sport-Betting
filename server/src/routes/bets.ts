// The bet log's endpoints.
//
// Its own namespace and its own file, mirroring how each sport is separated:
// nothing here reads a model and nothing in the model reads a bet. The only
// coupling is that a bet may carry the model's probability at the time it was
// placed, and that arrives as plain numbers in the request body.
//
// VALIDATION IS DONE HERE AND NOT TRUSTED FROM THE CLIENT. Everything below is a
// number a person types under time pressure into a phone, and an odds field that
// silently accepts "1,85" or a stake that accepts "-50" produces a P&L that is
// wrong in a way nobody notices for weeks. Bad input is refused with a message
// naming the field.

import type { FastifyInstance } from 'fastify';
import {
  BET_MARKETS,
  BET_SPORTS,
  BET_STATUSES,
  createBet,
  ErrorDeEnlace,
  deleteBet,
  getBet,
  listBets,
  summarizeBets,
  updateBet,
  type BetInput,
} from '../bets.ts';
import { listBetCandidates } from '../betCandidates.ts';
import { analizarCsv, importarCsv } from '../bets/importar.ts';
import { sugerenciaStake } from '../bets/sugerencia.ts';
import { clvDeApuesta } from '../bets/clv.ts';
import { parseBet } from '../bets/validar.ts';
import { featureEncendida } from '../features.ts';

export async function registerBetRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { from?: string; to?: string; sport?: string; status?: string } }>(
    '/',
    async (req) => ({ bets: listBets(req.query) }),
  );

  app.get<{ Querystring: { from?: string; to?: string; sport?: string; currency?: string } }>(
    '/summary',
    async (req) => summarizeBets(req.query),
  );

  /**
   * Upcoming matches to pick from, so a bet can capture the model's and the
   * market's probability at the time it was placed. See betCandidates.ts for why
   * that matters and cannot be recovered later.
   */
  app.get('/candidates', async () => ({ candidates: listBetCandidates() }));

  /** The vocabulary, so the UI never hardcodes a list the server can reject. */
  app.get('/options', async () => ({
    sports: BET_SPORTS,
    markets: BET_MARKETS,
    statuses: BET_STATUSES,
  }));

  app.post('/', async (req, reply) => {
    const parsed = parseBet(req.body, false);
    if ('errors' in parsed) return reply.code(400).send({ errors: parsed.errors });
    try {
      return reply.code(201).send(createBet(parsed.input as BetInput));
    } catch (e) {
      if (e instanceof ErrorDeEnlace) return reply.code(400).send({ errors: [{ field: 'snapshot_id', code: e.code, message: e.message }] });
      throw e;
    }
  });

  // Fase 5.16: importar un CSV (una apuesta por fila), sugerencia de stake con la misma
  // política Kelly (solo sugerencia) y CLV de las apuestas propias cuando hay snapshot.
  // La vista previa (fase F del seguimiento del PR #18): qué filas entrarían, cuáles no (campo y código) y
  // qué se pierde, SIN escribir nada. Importar después vuelve a leer y validar el CSV desde cero.
  app.post<{ Body: { csv?: string } }>('/import/preview', async (req, reply) => {
    if (!featureEncendida('apuestas.importacion')) return reply.code(404).send({ error: 'apagado (features.json: apuestas.importacion)' });
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!csv.trim()) return reply.code(400).send({ error: 'falta el CSV' });
    const a = analizarCsv(csv);
    // Lo que se guardaría va resumido: lo que la persona reconoce de su apuesta, no todo el objeto.
    return {
      ...a,
      filas: a.filas.map((f) => ({
        linea: f.linea,
        valida: f.valida,
        errores: f.errores,
        avisos: f.avisos,
        apuesta: f.apuesta && { placed_on: f.apuesta.placed_on ?? null, sport: f.apuesta.sport, event: f.apuesta.event, selection: f.apuesta.selection, odds: f.apuesta.odds, stake: f.apuesta.stake, currency: f.apuesta.currency ?? null, status: f.apuesta.status ?? 'pending' },
      })),
    };
  });
  app.post<{ Body: { csv?: string } }>('/import', async (req, reply) => {
    if (!featureEncendida('apuestas.importacion')) return reply.code(404).send({ error: 'apagado (features.json: apuestas.importacion)' });
    const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
    if (!csv.trim()) return reply.code(400).send({ error: 'falta el CSV' });
    const r = importarCsv(csv, (input) => createBet(input));
    return r;
  });
  app.get<{ Querystring: { odds?: string; prob?: string } }>('/sugerencia', async (req, reply) => {
    const odds = Number(req.query.odds);
    const prob = Number(req.query.prob);
    if (!(odds > 1) || !(prob > 0 && prob < 1)) return reply.code(400).send({ error: 'odds > 1 y prob entre 0 y 1' });
    return sugerenciaStake(prob, odds);
  });
  app.get<{ Params: { id: string } }>('/:id/clv', async (req, reply) => {
    const b = getBet(Number(req.params.id));
    if (!b) return reply.code(404).send({ error: 'bet not found' });
    return clvDeApuesta(b);
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const bet = getBet(Number(req.params.id));
    return bet ?? reply.code(404).send({ error: 'no existe esa apuesta' });
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const parsed = parseBet(req.body, true);
    if ('errors' in parsed) return reply.code(400).send({ errors: parsed.errors });
    let bet;
    try {
      bet = updateBet(Number(req.params.id), parsed.input);
    } catch (e) {
      if (e instanceof ErrorDeEnlace) return reply.code(400).send({ errors: [{ field: 'snapshot_id', code: e.code, message: e.message }] });
      throw e;
    }
    return bet ?? reply.code(404).send({ error: 'no existe esa apuesta' });
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    return deleteBet(Number(req.params.id))
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'no existe esa apuesta' });
  });
}
