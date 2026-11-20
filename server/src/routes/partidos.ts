// El explorador de partidos (rediseño de noviembre): GET /api/partidos. Ver partidos/explorador.ts.

import type { FastifyInstance } from 'fastify';
import { explorarPartidos, ventana, DEPORTES_EXPLORADOR } from '../partidos/explorador.ts';
import type { SportId } from '../sports.ts';

export async function registerPartidosRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { dia?: string; zona?: string; desde?: string; hasta?: string; deportes?: string } }>(
    '/api/partidos',
    {
      schema: {
        tags: ['producto'],
        summary: 'Los próximos de todos los deportes en una lista, con el origen del partido, de la predicción y de las cuotas',
        querystring: {
          type: 'object',
          properties: {
            dia: { type: 'string', description: 'Día local YYYY-MM-DD en `zona`' },
            zona: { type: 'string', description: 'Zona IANA de quien mira (Europe/Madrid)' },
            desde: { type: 'string', description: 'Instante ISO (si no hay `dia`)' },
            hasta: { type: 'string', description: 'Instante ISO (si no hay `dia`)' },
            deportes: { type: 'string', description: 'Lista separada por comas; sin ella, todos' },
          },
        },
      },
    },
    async (req) => {
      const q = req.query;
      const pedidos = (q.deportes ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is SportId => (DEPORTES_EXPLORADOR as string[]).includes(s));
      return explorarPartidos({ ...ventana(q), sports: pedidos.length ? pedidos : undefined });
    },
  );
}
