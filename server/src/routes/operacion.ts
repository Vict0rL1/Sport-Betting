// Rutas de operación (Fase 3): métricas, trabajos programados, política y exportaciones.
// Todas detrás de la contraseña; las de salud van en app.ts porque van sin ella.

import type { FastifyInstance } from 'fastify';
import { renderPrometheus, fijar } from '../observability/metrics.ts';
import { estado as estadoTrabajos, habilitar, ejecutar, registroArrancado } from '../scheduler/registry.ts';
import { getQuota } from '../oddsQuota.ts';
import { getDb } from '../db.ts';
import { contarErrores } from '../security/errors.ts';
import { ESQUEMA_ERROR, ESQUEMA_SCHEDULER, ESQUEMA_TRABAJO, ESQUEMA_POLICY, ESQUEMA_POLICY_VERSION, ESQUEMA_CANALES, ESQUEMA_EXPORT_JSON } from '../api/schemas.ts';
import { politicaVigente, historial, nuevaVersion, type CambiosPolitica } from '../staking/policyStore.ts';
import { canales, probarCanal, ultimosEnvios, guardarSuscripcionPush, borrarSuscripcionPush, clavePublicaVapid } from '../notifications/index.ts';
import { exportar, DATASETS, aCsv, type Dataset } from '../exports/datasets.ts';
import { featureEncendida } from '../features.ts';

export async function registerOperacionRoutes(app: FastifyInstance): Promise<void> {
  // Métricas en texto de Prometheus. Los medidores de estado se leen al raspar.
  app.get('/api/metrics', { schema: { tags: ['operación'], summary: 'Métricas en formato Prometheus', response: { 200: { type: 'string' }, 404: { type: 'string' } } } }, async (_req, reply) => {
    if (!featureEncendida('observabilidad.metricas')) return reply.code(404).send('apagado (features.json: observabilidad.metricas)');
    const db = getDb();
    const cuenta = (sql: string) => {
      try {
        return (db.prepare(sql).get() as { n: number }).n;
      } catch {
        return 0;
      }
    };
    fijar('apuestas_papel_total', cuenta('SELECT COUNT(*) AS n FROM paper_bets'), {}, 'apuestas de papel registradas');
    fijar('apuestas_papel_pendientes', cuenta("SELECT COUNT(*) AS n FROM paper_bets WHERE status = 'pending'"), {}, 'apuestas de papel sin liquidar');
    fijar('senales_total', cuenta('SELECT COUNT(*) AS n FROM edge_signals'), {}, 'señales de edge registradas');
    fijar('snapshots_cuotas_total', cuenta('SELECT COUNT(*) AS n FROM odds_snapshots'), {}, 'snapshots de cuotas');
    const q = getQuota();
    if (q.used != null) fijar('odds_api_peticiones_usadas', q.used, {}, 'peticiones usadas de The Odds API (según el proveedor)');
    if (q.remaining != null) fijar('odds_api_peticiones_restantes', q.remaining, {}, 'peticiones restantes de The Odds API');
    fijar('errores_servidor_24h', contarErrores(new Date(Date.now() - 24 * 3_600_000).toISOString()), {}, 'errores no controlados en 24 h (error_log)');
    fijar('registro_trabajos_arrancado', registroArrancado() ? 1 : 0, {}, '1 si el registro de trabajos está en marcha');
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(renderPrometheus());
  });

  app.get('/api/scheduler', { schema: { tags: ['operación'], summary: 'Trabajos programados', response: { 200: ESQUEMA_SCHEDULER } } }, async () => ({ arrancado: registroArrancado(), trabajos: estadoTrabajos() }));
  app.patch<{ Params: { nombre: string }; Body: { enabled?: boolean } }>(
    '/api/scheduler/:nombre',
    { schema: { tags: ['operación'], summary: 'Encender o apagar un trabajo', body: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] }, response: { 200: ESQUEMA_TRABAJO, 404: ESQUEMA_ERROR } } },
    async (req, reply) => {
      const r = habilitar(req.params.nombre, !!req.body.enabled);
      if (!r) return reply.code(404).send({ error: 'trabajo desconocido' });
      return r;
    },
  );
  app.post<{ Params: { nombre: string } }>('/api/scheduler/:nombre/ejecutar', { schema: { tags: ['operación'], summary: 'Ejecutar un trabajo ahora' } }, async (req, reply) => {
    const r = await ejecutar(req.params.nombre);
    if (r.saltado && /desconocido/.test(r.error ?? '')) return reply.code(404).send({ error: r.error });
    return r;
  });

  app.get('/api/policy', { schema: { tags: ['operación'], summary: 'La política de apuestas vigente y su historial', response: { 200: ESQUEMA_POLICY } } }, async () => ({ vigente: politicaVigente(), historial: historial() }));
  app.post<{ Body: { cambios?: CambiosPolitica; nota?: string } }>(
    '/api/policy',
    { schema: { tags: ['operación'], summary: 'Nueva versión de la política (nunca reescribe)', body: { type: 'object', properties: { cambios: { type: 'object', additionalProperties: true }, nota: { type: 'string' } }, required: ['cambios'] }, response: { 200: ESQUEMA_POLICY_VERSION, 400: ESQUEMA_ERROR } } },
    async (req, reply) => {
      try {
        return nuevaVersion(req.body.cambios ?? {}, req.body.nota ?? null, 'api');
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );

  app.get('/api/notifications/canales', { schema: { tags: ['operación'], summary: 'Canales de notificación y últimos envíos', response: { 200: ESQUEMA_CANALES } } }, async () => ({ canales: canales(), ultimos: ultimosEnvios(20) }));
  app.post<{ Params: { canal: string } }>('/api/notifications/test/:canal', { schema: { tags: ['operación'], summary: 'Enviar una notificación de prueba por un canal' } }, async (req, reply) => {
    const r = await probarCanal(req.params.canal);
    if (!r.ok && /desconocido/.test(r.error ?? '')) return reply.code(404).send(r);
    return r;
  });
  app.get('/api/notifications/push/clave', { schema: { tags: ['operación'], summary: 'Clave pública VAPID para Web Push' } }, async () => ({ clave: clavePublicaVapid() }));
  app.post<{ Body: { endpoint?: string; keys?: Record<string, string> } }>('/api/notifications/push/subscribe', { schema: { tags: ['operación'], summary: 'Guardar una suscripción Web Push', body: { type: 'object', properties: { endpoint: { type: 'string' }, keys: { type: 'object', additionalProperties: true } }, required: ['endpoint', 'keys'] } } }, async (req) => guardarSuscripcionPush(req.body.endpoint!, req.body.keys!));
  app.delete<{ Body: { endpoint?: string } }>('/api/notifications/push/subscribe', { schema: { tags: ['operación'], summary: 'Quitar una suscripción Web Push' } }, async (req) => ({ borradas: borrarSuscripcionPush(req.body?.endpoint ?? '') }));

  app.get<{ Params: { dataset: string }; Querystring: { formato?: string; desde?: string; hasta?: string; sport?: string } }>(
    '/api/export/:dataset',
    { schema: { tags: ['operación'], summary: `Exportar un conjunto (${DATASETS.join(', ')}) en CSV o JSON`, querystring: { type: 'object', properties: { formato: { type: 'string', enum: ['csv', 'json'] }, desde: { type: 'string' }, hasta: { type: 'string' }, sport: { type: 'string' } } }, response: { 200: { oneOf: [ESQUEMA_EXPORT_JSON, { type: 'string' }] } } } },
    async (req, reply) => {
      if (!(DATASETS as readonly string[]).includes(req.params.dataset)) return reply.code(404).send({ error: `conjunto desconocido; usa ${DATASETS.join(', ')}` });
      const r = exportar(req.params.dataset as Dataset, { desde: req.query.desde, hasta: req.query.hasta, sport: req.query.sport });
      if ((req.query.formato ?? 'json') === 'csv') {
        return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${req.params.dataset}.csv"`).send(aCsv(r.columnas, r.datos));
      }
      return { dataset: req.params.dataset, filas: r.datos.length, columnas: r.columnas, datos: r.datos };
    },
  );
}
