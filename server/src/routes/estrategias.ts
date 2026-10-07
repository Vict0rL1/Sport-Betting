// Rutas del laboratorio de estrategias (Fase 6.1): crear, archivar, comparar y «¿qué habría pasado?».

import type { FastifyInstance } from 'fastify';
import { featureEncendida } from '../features.ts';
import { politica } from '../staking/policyStore.ts';
import {
  DEPORTES_ESTRATEGIA,
  MAX_ACTIVAS,
  MERCADOS_ESTRATEGIA,
  apuestasDe,
  archivarEstrategia,
  compararEstrategias,
  configDe,
  crearEstrategia,
  estrategia,
  listarEstrategias,
  sinFrenoDeCalibracion,
  type PeticionEstrategia,
} from '../estrategias/index.ts';
import type { CalibrationFile } from '../staking/calibration.ts';
import { DEPORTES_HISTORICO, historicosDisponibles, reproducir, type DeporteHistorico } from '../estrategias/historico.ts';
import { ESQUEMA_ERROR, ESQUEMA_ESTRATEGIA, ESQUEMA_ESTRATEGIAS, ESQUEMA_HISTORICO_ESTRATEGIA, ESQUEMA_APUESTAS_ESTRATEGIA } from '../api/schemas.ts';

const APAGADO = { error: 'apagado (features.json: estrategias.laboratorio)' };
const APAGADO_HISTORICO = { error: 'apagado (features.json: estrategias.historico)' };
const libre = { type: 'object', additionalProperties: true } as const;

function deporteHistorico(s: string | undefined): DeporteHistorico | null {
  return (DEPORTES_HISTORICO as readonly string[]).includes(String(s)) ? (s as DeporteHistorico) : null;
}

export async function registerEstrategiasRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/estrategias', { schema: { tags: ['producto'], summary: 'Estrategias, comparación con el banco principal e históricos disponibles', response: { 200: ESQUEMA_ESTRATEGIAS, 404: ESQUEMA_ERROR } } }, async (_req, reply) => {
    if (!featureEncendida('estrategias.laboratorio')) return reply.code(404).send(APAGADO);
    return {
      estrategias: listarEstrategias(true),
      comparacion: compararEstrategias(),
      historicos: historicosDisponibles(),
      limites: { maxActivas: MAX_ACTIVAS, deportes: [...DEPORTES_ESTRATEGIA], mercados: [...MERCADOS_ESTRATEGIA] },
      politica: politica().staking,
    };
  });

  app.post<{ Body: PeticionEstrategia }>('/api/estrategias', { schema: { tags: ['producto'], summary: 'Crear una estrategia (no se edita: cambiarla es crear otra)', body: libre, response: { 200: ESQUEMA_ESTRATEGIA, 400: ESQUEMA_ERROR, 404: ESQUEMA_ERROR } } }, async (req, reply) => {
    if (!featureEncendida('estrategias.laboratorio')) return reply.code(404).send(APAGADO);
    try {
      return crearEstrategia(req.body ?? ({} as PeticionEstrategia));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.post<{ Params: { id: string } }>('/api/estrategias/:id/archivar', { schema: { tags: ['producto'], summary: 'Archivar una estrategia (una vez; deja de apostar)', response: { 200: ESQUEMA_ESTRATEGIA, 400: ESQUEMA_ERROR, 404: ESQUEMA_ERROR } } }, async (req, reply) => {
    if (!featureEncendida('estrategias.laboratorio')) return reply.code(404).send(APAGADO);
    if (!estrategia(Number(req.params.id))) return reply.code(404).send({ error: 'no existe esa estrategia' });
    try {
      return archivarEstrategia(Number(req.params.id));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  app.get<{ Params: { id: string }; Querystring: { limite?: string } }>('/api/estrategias/:id/apuestas', { schema: { tags: ['producto'], summary: 'Apuestas de una estrategia, las últimas primero', querystring: { type: 'object', properties: { limite: { type: 'string' } } }, response: { 200: ESQUEMA_APUESTAS_ESTRATEGIA, 404: ESQUEMA_ERROR } } }, async (req, reply) => {
    if (!featureEncendida('estrategias.laboratorio')) return reply.code(404).send(APAGADO);
    if (!estrategia(Number(req.params.id))) return reply.code(404).send({ error: 'no existe esa estrategia' });
    return { apuestas: apuestasDe(Number(req.params.id), Number(req.query.limite) || 100) };
  });

  // «¿Qué habría pasado?» con la política vigente o con una estrategia guardada.
  app.get<{ Querystring: { sport?: string; id?: string; desde?: string; hasta?: string } }>(
    '/api/estrategias/historico',
    { schema: { tags: ['producto'], summary: '«¿Qué habría pasado?»: una estrategia (o la política vigente) sobre el histórico con cuotas, sin holdout', querystring: { type: 'object', properties: { sport: { type: 'string' }, id: { type: 'string' }, desde: { type: 'string' }, hasta: { type: 'string' } } }, response: { 200: ESQUEMA_HISTORICO_ESTRATEGIA, 400: ESQUEMA_ERROR, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('estrategias.historico')) return reply.code(404).send(APAGADO_HISTORICO);
      const sport = deporteHistorico(req.query.sport);
      if (!sport) return reply.code(400).send({ error: `sport: uno de ${DEPORTES_HISTORICO.join(', ')} (los que tienen cuotas históricas)` });
      let staking = politica().staking;
      let cal: CalibrationFile | undefined;
      if (req.query.id && req.query.id !== 'principal') {
        const e = estrategia(Number(req.query.id));
        if (!e) return reply.code(404).send({ error: 'no existe esa estrategia' });
        if (!e.config.deportes.includes(sport)) return reply.code(400).send({ error: `la estrategia «${e.nombre}» no apuesta ${sport}` });
        staking = e.config.staking;
        if (e.config.calibracion === false) cal = sinFrenoDeCalibracion(sport);
      }
      return reproducir(sport, staking, { desde: req.query.desde, hasta: req.query.hasta, cal });
    },
  );

  // Lo mismo con una configuración que todavía no se ha guardado (la vista previa del formulario).
  app.post<{ Body: { sport?: string; staking?: Record<string, unknown>; calibracion?: boolean; desde?: string; hasta?: string } }>(
    '/api/estrategias/historico',
    { schema: { tags: ['producto'], summary: '«¿Qué habría pasado?» con una configuración sin guardar', body: libre, response: { 200: ESQUEMA_HISTORICO_ESTRATEGIA, 400: ESQUEMA_ERROR, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('estrategias.historico')) return reply.code(404).send(APAGADO_HISTORICO);
      const sport = deporteHistorico(req.body?.sport);
      if (!sport) return reply.code(400).send({ error: `sport: uno de ${DEPORTES_HISTORICO.join(', ')} (los que tienen cuotas históricas)` });
      try {
        const cfg = configDe({ nombre: 'vista previa', deportes: [sport], staking: (req.body?.staking ?? {}) as never });
        return reproducir(sport, cfg.staking, { desde: req.body?.desde, hasta: req.body?.hasta, cal: req.body?.calibracion === false ? sinFrenoDeCalibracion(sport) : undefined });
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );
}
