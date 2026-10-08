// La NHL en sombra (Fase 8.1): solo la evaluación del backtest, nunca una predicción publicada.
// Detrás de `deportes.nhl` (apagado por defecto). La evaluación recorre todos los partidos, así que se
// guarda en memoria hasta que cambie la tabla (número de filas y última ingesta).

import type { FastifyInstance } from 'fastify';
import { featureEncendida } from '../features.ts';
import { getDb } from '../db.ts';
import { evaluarNhl } from '../nhl/evaluacion.ts';
import { NHL } from '../nhl/model.ts';
import { ESQUEMA_ERROR, ESQUEMA_NHL_SOMBRA } from '../api/schemas.ts';

let memo: { firma: string; valor: unknown } | null = null;

export function sombraNhl() {
  const f = getDb().prepare('SELECT COUNT(*) AS n, MAX(ingested_at) AS i, MAX(game_date) AS u FROM nhl_games').get() as { n: number; i: string | null; u: string | null };
  const firma = `${f.n}|${f.i}`;
  if (memo?.firma === firma) return memo.valor;
  const r = evaluarNhl();
  const m = r.modelo;
  const valor = {
    partidos: r.partidos,
    puntuados: r.puntuados,
    holdoutExcluido: r.holdoutExcluido,
    ultimo: f.u,
    modelo: m ? { n: m.n, logLoss: m.logLoss, brier: m.brier, accuracy: m.accuracy, ece: m.ece } : null,
    referencias: r.referencias,
    porTemporada: r.porTemporada,
    aviso: r.aviso,
    nota: r.nota,
    parametros: { k: NHL.k, campo: NHL.campo, golesLiga: NHL.golesLiga, fuerzaProrroga: NHL.fuerzaProrroga },
  };
  memo = { firma, valor };
  return valor;
}

export async function registerNhlRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/nhl/sombra',
    { schema: { tags: ['modelos'], summary: 'NHL en sombra: evaluación del backtest (sin holdout); nada se publica', response: { 200: ESQUEMA_NHL_SOMBRA, 404: ESQUEMA_ERROR } } },
    async (_req, reply) => {
      if (!featureEncendida('deportes.nhl')) return reply.code(404).send({ error: 'apagado (features.json: deportes.nhl)' });
      return sombraNhl();
    },
  );
}
