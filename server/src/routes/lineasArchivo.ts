// Rutas del comparador de líneas (Fase 6.5) y del archivo de predicciones (Fase 6.6). Solo lectura.

import type { FastifyInstance } from 'fastify';
import { featureEncendida } from '../features.ts';
import { comparadorDeLineas } from '../odds/lineas.ts';
import { buscarEnArchivo, type FiltroArchivo } from '../archivo/index.ts';
import { ESQUEMA_ERROR, ESQUEMA_LINEAS, ESQUEMA_ARCHIVO } from '../api/schemas.ts';

const qs = (props: string[]) => ({ type: 'object', properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])) });
const CONFIANZAS = ['ALTA', 'MEDIA', 'BAJA', 'ninguna'];
const BANDAS = ['50–60 %', '60–75 %', '≥ 75 %'];
const RESULTADOS = ['acierto', 'fallo', 'nulo', 'pendiente'];
const fecha = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export async function registerLineasArchivoRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { sport?: string; market?: string } }>(
    '/api/odds/lineas',
    { schema: { tags: ['producto'], summary: 'Comparador de líneas: mejor cuota por selección, consenso, dispersión y surebets (solo lectura)', querystring: qs(['sport', 'market']), response: { 200: ESQUEMA_LINEAS, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('mercado.lineas')) return reply.code(404).send({ error: 'apagado (features.json: mercado.lineas)' });
      return comparadorDeLineas(new Date(), { sport: req.query.sport || undefined, market: req.query.market || undefined });
    },
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/archivo',
    {
      schema: {
        tags: ['producto'],
        summary: 'Archivo de predicciones: lo que dijo el modelo, con resultado, confianza, CLV y política',
        querystring: qs(['q', 'sport', 'liga', 'confianza', 'banda', 'resultado', 'desde', 'hasta', 'pagina', 'porPagina']),
        response: { 200: ESQUEMA_ARCHIVO, 404: ESQUEMA_ERROR },
      },
    },
    async (req, reply) => {
      if (!featureEncendida('archivo.predicciones')) return reply.code(404).send({ error: 'apagado (features.json: archivo.predicciones)' });
      const q = req.query;
      const f: FiltroArchivo = {
        q: q.q?.slice(0, 100) || undefined,
        sport: q.sport || undefined,
        liga: q.liga || undefined,
        confianza: CONFIANZAS.includes(String(q.confianza)) ? (q.confianza as FiltroArchivo['confianza']) : undefined,
        banda: BANDAS.includes(String(q.banda)) ? (q.banda as FiltroArchivo['banda']) : undefined,
        resultado: RESULTADOS.includes(String(q.resultado)) ? (q.resultado as FiltroArchivo['resultado']) : undefined,
        desde: fecha(q.desde),
        hasta: fecha(q.hasta),
        pagina: Number(q.pagina) || 1,
        porPagina: Number(q.porPagina) || 50,
      };
      return buscarEnArchivo(f);
    },
  );
}
