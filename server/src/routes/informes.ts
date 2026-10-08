// Rutas de la bandeja y de los informes archivados (Fase 6.4 y 6.7–6.9).

import type { FastifyInstance } from 'fastify';
import { featureEncendida } from '../features.ts';
import { listarBandeja, marcar, noLeidas } from '../bandeja/index.ts';
import { informe, listarInformes, generarDiario, generarSemanal, type TipoInforme } from '../informes/index.ts';
import { pdfDeMarkdown } from '../informes/pdf.ts';
import { zonaApp } from '../informes/tiempo.ts';
import {
  ESQUEMA_ERROR,
  ESQUEMA_BANDEJA,
  ESQUEMA_CONTADOR_BANDEJA,
  ESQUEMA_MARCADAS,
  ESQUEMA_INFORMES,
  ESQUEMA_INFORME,
  ESQUEMA_INFORME_GENERADO,
} from '../api/schemas.ts';

const APAGADA = { error: 'apagado (features.json: alertas.bandeja)' };
const APAGADOS = { error: 'apagados (features.json: informes.diario e informes.semanal)' };
const informesEncendidos = () => featureEncendida('informes.diario') || featureEncendida('informes.semanal');
const qs = (props: string[]) => ({ type: 'object', properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])) });

export async function registerInformesRoutes(app: FastifyInstance): Promise<void> {
  // --- la bandeja ---
  app.get<{ Querystring: { leida?: string; tipo?: string; sport?: string; antesDe?: string; limite?: string } }>(
    '/api/bandeja',
    { schema: { tags: ['producto'], summary: 'Avisos de la app (notificaciones y alertas) con leída/no leída', querystring: qs(['leida', 'tipo', 'sport', 'antesDe', 'limite']), response: { 200: ESQUEMA_BANDEJA, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('alertas.bandeja')) return reply.code(404).send(APAGADA);
      const q = req.query;
      return listarBandeja({
        leida: q.leida === '1' ? true : q.leida === '0' ? false : undefined,
        tipo: q.tipo || undefined,
        sport: q.sport || undefined,
        antesDe: Number(q.antesDe) || undefined,
        limite: Number(q.limite) || undefined,
      });
    },
  );
  app.get('/api/bandeja/contador', { schema: { tags: ['producto'], summary: 'Cuántos avisos sin leer (la campana)', response: { 200: ESQUEMA_CONTADOR_BANDEJA, 404: ESQUEMA_ERROR } } }, async (_req, reply) => {
    if (!featureEncendida('alertas.bandeja')) return reply.code(404).send(APAGADA);
    return { noLeidas: noLeidas() };
  });
  app.post<{ Body: { ids?: number[]; todas?: boolean; leida?: boolean } }>(
    '/api/bandeja/marcar',
    { schema: { tags: ['producto'], summary: 'Marcar avisos como leídos o no leídos (ids o todas)', body: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } }, todas: { type: 'boolean' }, leida: { type: 'boolean' } } }, response: { 200: ESQUEMA_MARCADAS, 400: ESQUEMA_ERROR, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!featureEncendida('alertas.bandeja')) return reply.code(404).send(APAGADA);
      const b = req.body ?? {};
      if (!b.todas && !(b.ids && b.ids.length)) return reply.code(400).send({ error: 'di qué marcar: ids o todas' });
      const marcadas = marcar({ ids: b.ids, todas: b.todas }, b.leida !== false);
      return { marcadas, noLeidas: noLeidas() };
    },
  );

  // --- los informes ---
  app.get<{ Querystring: { tipo?: string; limite?: string } }>(
    '/api/informes',
    { schema: { tags: ['producto'], summary: 'Informes archivados (resumen diario e informe semanal)', querystring: qs(['tipo', 'limite']), response: { 200: ESQUEMA_INFORMES, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      if (!informesEncendidos()) return reply.code(404).send(APAGADOS);
      const tipo = req.query.tipo === 'diario' || req.query.tipo === 'semanal' ? (req.query.tipo as TipoInforme) : undefined;
      return {
        informes: listarInformes({ tipo, limite: Number(req.query.limite) || undefined }),
        zona: zonaApp(),
        pdf: featureEncendida('informes.pdf'),
        diario: featureEncendida('informes.diario'),
        semanal: featureEncendida('informes.semanal'),
      };
    },
  );
  app.get<{ Params: { id: string } }>('/api/informes/:id', { schema: { tags: ['producto'], summary: 'Un informe archivado: Markdown y cifras', response: { 200: ESQUEMA_INFORME, 404: ESQUEMA_ERROR } } }, async (req, reply) => {
    if (!informesEncendidos()) return reply.code(404).send(APAGADOS);
    const r = informe(Number(req.params.id));
    if (!r) return reply.code(404).send({ error: 'no existe ese informe' });
    return { ...r, pdf: featureEncendida('informes.pdf') };
  });
  app.get<{ Params: { id: string } }>('/api/informes/:id/pdf', { schema: { tags: ['producto'], summary: 'Un informe archivado en PDF (texto, sin dependencias)' } }, async (req, reply) => {
    if (!informesEncendidos() || !featureEncendida('informes.pdf')) return reply.code(404).send({ error: 'apagado (features.json: informes.pdf)' });
    const r = informe(Number(req.params.id));
    if (!r) return reply.code(404).send({ error: 'no existe ese informe' });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="informe-${r.tipo}-${r.periodo}.pdf"`)
      .send(pdfDeMarkdown(r.titulo, r.markdown));
  });
  app.post<{ Body: { tipo?: string } }>(
    '/api/informes/generar',
    { schema: { tags: ['producto'], summary: 'Generar ya el informe del periodo actual si falta (no rehace uno archivado)', body: { type: 'object', properties: { tipo: { type: 'string', enum: ['diario', 'semanal'] } }, required: ['tipo'] }, response: { 200: ESQUEMA_INFORME_GENERADO, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      const tipo = req.body.tipo as TipoInforme;
      if (!featureEncendida(tipo === 'diario' ? 'informes.diario' : 'informes.semanal')) return reply.code(404).send({ error: `apagado (features.json: informes.${tipo})` });
      const r = tipo === 'diario' ? generarDiario() : generarSemanal();
      return { id: r.informe.id, nuevo: r.nuevo, periodo: r.informe.periodo };
    },
  );
}
