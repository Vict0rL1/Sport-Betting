// Rutas de analítica (Fase 4): fiabilidad, segmentos, monitorización y simulaciones.
// Nada de aquí cambia una probabilidad publicada: se lee, se enseña y se guarda para graficar.

import type { FastifyInstance } from 'fastify';
import { fiabilidad } from '../evaluation/reliability.ts';
import { segmentos } from '../evaluation/segmentos.ts';
import { monitorizacion } from '../monitoring/series.ts';
import { simulacionDelDia } from '../simulation/season.ts';
import { torneoTenis } from '../simulation/torneo.ts';
import { combinada, validarPatas } from '../picks/parlay.ts';
import { inteligenciaMercado } from '../odds/intel.ts';
import { isSportId, SPORT_IDS } from '../sports.ts';
import { featureEncendida } from '../features.ts';
import { ESQUEMA_ERROR, ESQUEMA_FIABILIDAD, ESQUEMA_SEGMENTOS, ESQUEMA_MONITORIZACION, ESQUEMA_SIMULACION, ESQUEMA_TORNEO, ESQUEMA_COMBINADA, ESQUEMA_INTEL } from '../api/schemas.ts';

const DEPORTE = { type: 'object', properties: { sport: { type: 'string', enum: [...SPORT_IDS] } }, required: ['sport'] } as const;

export async function registerAnaliticaRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { sport: string } }>(
    '/api/evaluation/reliability',
    { schema: { tags: ['analítica'], summary: 'Diagrama de fiabilidad (backtest y vivo, sin mezclar)', querystring: DEPORTE, response: { 200: ESQUEMA_FIABILIDAD, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('analitica.fiabilidad')) return reply.code(404).send({ error: 'apagado (features.json: analitica.fiabilidad)' });
      if (!isSportId(req.query.sport)) return reply.code(404).send({ error: 'deporte desconocido' });
      return fiabilidad(req.query.sport);
    },
  );
  app.get<{ Querystring: { sport: string } }>(
    '/api/evaluation/segmentos',
    { schema: { tags: ['analítica'], summary: 'Acierto, Brier y CLV por segmento (solo celdas con muestra)', querystring: DEPORTE, response: { 200: ESQUEMA_SEGMENTOS, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('analitica.segmentos')) return reply.code(404).send({ error: 'apagado (features.json: analitica.segmentos)' });
      if (!isSportId(req.query.sport)) return reply.code(404).send({ error: 'deporte desconocido' });
      return segmentos(req.query.sport);
    },
  );
  app.get<{ Querystring: { sport: string } }>(
    '/api/monitoring',
    { schema: { tags: ['analítica'], summary: 'Ventana móvil de 4 semanas, PSI contra el backtest y deriva', querystring: DEPORTE, response: { 200: ESQUEMA_MONITORIZACION, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('analitica.monitorizacion')) return reply.code(404).send({ error: 'apagado (features.json: analitica.monitorizacion)' });
      if (!isSportId(req.query.sport)) return reply.code(404).send({ error: 'deporte desconocido' });
      return monitorizacion(req.query.sport);
    },
  );
  app.get<{ Params: { sport: string; league: string } }>(
    '/api/simulation/season/:sport/:league',
    { schema: { tags: ['analítica'], summary: 'Simulación Monte Carlo de la temporada (cacheada por día; no es predicción publicada)', params: { type: 'object', properties: { sport: { type: 'string' }, league: { type: 'string' } }, required: ['sport', 'league'] }, response: { 200: ESQUEMA_SIMULACION, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('simulacion.temporada')) return reply.code(404).send({ error: 'apagado (features.json: simulacion.temporada)' });
      const s = req.params.sport;
      if (!isSportId(s) || s === 'tennis') return reply.code(404).send({ error: 'deporte sin temporada de liga' });
      if (!/^[a-z0-9_-]{1,32}$/.test(req.params.league)) return reply.code(404).send({ error: 'liga desconocida' });
      return simulacionDelDia(s, req.params.league);
    },
  );
  app.get('/api/simulation/torneo', { schema: { tags: ['analítica'], summary: 'Cuadro de tenis: no hay fuente, y lo dice', response: { 200: ESQUEMA_TORNEO, 404: ESQUEMA_ERROR } } }, async (_req, reply) => {
    if (!featureEncendida('simulacion.torneo')) return reply.code(404).send({ error: 'apagado (features.json: simulacion.torneo)' });
    return torneoTenis();
  });
  app.post<{ Body: { patas?: unknown } }>(
    '/api/picks/parlay',
    { schema: { tags: ['analítica'], summary: 'Probabilidad conjunta de una selección descontando la correlación medida (aproximación)', body: { type: 'object', properties: { patas: { type: 'array', items: { type: 'object', additionalProperties: true } } }, required: ['patas'] }, response: { 200: ESQUEMA_COMBINADA, 400: ESQUEMA_ERROR, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('picks.combinadasCorrelacion')) return reply.code(404).send({ error: 'apagado (features.json: picks.combinadasCorrelacion)' });
      try {
        return combinada(validarPatas(req.body.patas));
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );
  app.get('/api/odds/intel', { schema: { tags: ['analítica'], summary: 'Steam moves, surebets y referencia afilada (aproximación)', response: { 200: ESQUEMA_INTEL, 404: ESQUEMA_ERROR } } }, async (_req, reply) => {
    if (!featureEncendida('mercado.inteligencia')) return reply.code(404).send({ error: 'apagado (features.json: mercado.inteligencia)' });
    return inteligenciaMercado();
  });
}
