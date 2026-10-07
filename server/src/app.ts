// La aplicación Fastify, construida en un sitio.
//
// Antes todo esto vivía dentro de `main()` en index.ts, mezclado con los temporizadores y
// el `listen`. Separarlo tiene un motivo concreto: poder construir la app en un test y
// pedirle rutas con `app.inject`, sin puerto ni red. Sin eso, la puerta de la contraseña,
// las cabeceras o el límite de cuerpo no se podían probar, y una medida de seguridad sin
// test es una que puede dejar de funcionar sin que nadie lo note.
//
// index.ts sigue siendo el arranque: llama a `buildApp`, escucha y lanza los ciclos.

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { registerRoutes } from './routes/api.ts';
import { registerBasketballRoutes } from './routes/basketball.ts';
import { registerFootballRoutes } from './routes/football.ts';
import { registerBaseballRoutes } from './routes/baseball.ts';
import { registerNflRoutes } from './routes/nfl.ts';
import { registerBetRoutes } from './routes/bets.ts';
import { registerLatencyRoutes } from './routes/latency.ts';
import { registerStakingRoutes } from './routes/staking.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerAuth, authRuntimeDesdeEntorno, type AuthRuntime } from './auth.ts';
import { registerStatic, webBuildExists, WEB_DIST } from './static.ts';
import { recordLatency } from './latency/record.ts';
import { registerSecurityHeaders } from './security/headers.ts';
import { origenesPermitidos, politicaCors } from './security/cors.ts';
import { registerErrorHandler } from './security/errors.ts';
import { estadoFeatures, featureEncendida } from './features.ts';

export interface AppOptions {
  /** La puerta: configuración y limitador. Por defecto, del entorno. */
  auth?: AuthRuntime;
  /** Servir web/dist si existe (producción). Los tests lo dejan apagado. */
  servirWeb?: boolean;
  /** Logger de Fastify (apagado en tests). */
  logger?: boolean;
  entorno?: NodeJS.ProcessEnv;
  /** Para los tests: ver cada ruta que se registra (y comprobar que todas están detrás de la puerta). */
  onRoute?: (r: { method: string | string[]; url: string }) => void;
}

/** 256 KB: cabe cualquier formulario de la app; no cabe un intento de llenar la memoria. */
export const BODY_LIMIT_POR_DEFECTO = 256 * 1024;

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const entorno = opts.entorno ?? process.env;
  const auth = opts.auth ?? authRuntimeDesdeEntorno(entorno);
  const bodyLimit = Number(entorno.BODY_LIMIT_BYTES) > 0 ? Number(entorno.BODY_LIMIT_BYTES) : BODY_LIMIT_POR_DEFECTO;

  const app = Fastify({
    logger: opts.logger === false ? false : { level: 'info', transport: undefined },
    bodyLimit,
    // Cada petición lleva un id (UUID) que vuelve en las respuestas de error y en el log.
    // Se respeta el que traiga un proxy en `x-request-id` para poder seguir la traza.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: auth.config.produccion,
  });

  // ===========================================================================
  // ETAPA «SERVIDOR»: petición → respuesta
  // ===========================================================================
  // Se mide con los ganchos de Fastify y no con un cronómetro dentro de cada ruta,
  // porque así cubre TODA la petición —parseo, ruta, serialización— y no se puede
  // olvidar en una ruta nueva. Solo se guardan las de predicción: medir el endpoint de
  // latencia dentro de la propia latencia añade ruido y no informa de nada.
  if (opts.onRoute) app.addHook('onRoute', (r) => opts.onRoute!({ method: r.method, url: r.url }));

  app.addHook('onRequest', async (req) => {
    (req as { __t0?: bigint }).__t0 = process.hrtime.bigint();
  });
  app.addHook('onResponse', async (req) => {
    const t0 = (req as { __t0?: bigint }).__t0;
    if (!t0) return;
    const url = req.url;
    if (!/\/api\/(football|basketball|baseball|nfl|matches)/.test(url)) return;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const sport = url.includes('/football')
      ? 'football'
      : url.includes('/basketball')
        ? 'basketball'
        : url.includes('/baseball')
          ? 'baseball'
          : url.includes('/nfl')
            ? 'nfl'
            : 'tennis';
    try {
      recordLatency({ stage: 'servidor', ms, sport });
    } catch {
      // Medir no puede tumbar una respuesta que ya se ha enviado.
    }
  });

  // La contraseña, antes que NADA. Un hook registrado después de las rutas sigue
  // corriendo antes que ellas —Fastify ordena por ciclo de vida, no por orden de
  // registro—, pero ponerlo aquí hace que al leer el fichero se vea que está puesto, y
  // que nadie añada una ruta «arriba» creyendo que la esquiva.
  registerAuth(app, auth);

  if (featureEncendida('seguridad.cabeceras')) registerSecurityHeaders(app, { hsts: auth.config.produccion });
  registerErrorHandler(app, { guardar: featureEncendida('seguridad.errorLog') });

  // Cerrado salvo lista explícita (ver security/cors.ts).
  await app.register(cors, { origin: politicaCors(origenesPermitidos(entorno)), credentials: true });

  await app.register(registerAuthRoutes(auth), { prefix: '/api/auth' });
  app.get('/api/features', async () => ({ features: estadoFeatures(entorno) }));

  await app.register(registerRoutes, { prefix: '/api' });
  // Basketball lives in its own namespace: no endpoint can return both sports.
  await app.register(registerBasketballRoutes, { prefix: '/api/basketball' });
  await app.register(registerFootballRoutes, { prefix: '/api/football' });
  await app.register(registerLatencyRoutes, { prefix: '/api/latency' });
  await app.register(registerStakingRoutes, { prefix: '/api/staking' });
  await app.register(registerBaseballRoutes, { prefix: '/api/baseball' });
  await app.register(registerNflRoutes, { prefix: '/api/nfl' });
  // The bet log is not a sixth sport: it records what the person staked, not what
  // any model claimed, so it gets its own namespace rather than living under one.
  await app.register(registerBetRoutes, { prefix: '/api/bets' });

  // Fly comprueba que la máquina vive pidiendo esto. Va sin contraseña a propósito (ver
  // auth.ts) y no toca la base: solo dice que el proceso responde.
  app.get('/healthz', async () => ({ ok: true }));

  // La app construida, si la hay. En desarrollo no la hay y la sirve Vite, así que esto
  // no se registra y `/` sigue devolviendo el índice de la API de abajo.
  const hayWeb = opts.servirWeb !== false && webBuildExists();
  if (hayWeb) {
    await registerStatic(app);
    app.log.info(`Sirviendo la app construida desde ${WEB_DIST}`);
  } else if (opts.servirWeb !== false && auth.config.produccion) {
    // En producción esto NO es un detalle: significa que el despliegue responde a la API
    // y devuelve 404 en la portada. Mejor no arrancar que quedar así.
    throw new Error(
      `No hay app construida en ${WEB_DIST}, y NODE_ENV=production.\n\n` +
        'El contenedor tiene que construir el frontend (npm run build) antes de arrancar\n' +
        'el servidor; si no, la URL contesta a /api pero no se puede abrir.',
    );
  }

  // El índice de la API en `/` SOLO cuando no hay app que servir: con las dos cosas
  // registradas gana la ruta explícita y abrir la URL desplegada devolvería un JSON.
  if (!hayWeb)
    app.get('/', async () => ({
      name: 'tennis-predictor API',
      docs:
        'Tenis: /api/health, /api/tours, /api/matches/upcoming, /api/predictions/:id · ' +
        'Baloncesto: /api/basketball/leagues, /api/basketball/games/upcoming · ' +
        'Fútbol: /api/football/leagues, /api/football/fixtures/upcoming, /api/football/power',
    }));

  return app;
}
