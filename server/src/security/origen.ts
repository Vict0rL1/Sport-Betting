// Que otra web no pueda hacer que tu navegador cambie (ni, sin contraseña, lea) nada de la app
// (lote J, J1).
//
// Un POST «simple» (text/plain o sin cuerpo) no lleva preflight de CORS: el navegador lo manda
// aunque la app no lo permita, y solo esconde la respuesta. Sin contraseña (lo normal en el
// portátil, escuchando en 127.0.0.1), cualquier página que visitaras podía así generar informes,
// cambiar ajustes o lanzar lo que haga una ruta POST, sin cookie que valga. Con contraseña, solo
// lo frenaba la cookie SameSite=Strict, que no frena a un subdominio hermano.
//
// La regla, para POST, PUT, PATCH y DELETE (en CUALQUIER ruta: el router decodifica los escapes, y
// `/%61pi/…` es `/api/…`; la revisión de security-reviewer lo reprodujo en un navegador):
//   · Un origen de CORS_ORIGINS pasa siempre: es la lista de quien SÍ puede llamar desde fuera.
//   · Si el navegador manda Sec-Fetch-Site (todos los actuales), pasa `same-origin` o `none`.
//   · Si no, un Origin presente tiene que ser exactamente el host:puerto de la petición. El
//     proxy de Vite ya no cambia el Host (scripts/proxy-api.mjs), así que el móvil en la misma
//     wifi, por HTTP a la IP (sin Sec-Fetch-Site), también casa.
//   · Sin ninguna de las dos cabeceras (curl, scripts, servidor a servidor) no hay navegador al
//     que engañar: pasa.
// Leer (GET, HEAD, OPTIONS) no se mira: no cambia nada, y CORS ya esconde la respuesta.
//
// Y sin contraseña, el Host (rebinding de DNS): una web cuyo dominio pasa a apuntar a 127.0.0.1
// es, para el navegador, «el mismo sitio» que la app; con ella leería y cambiaría todo. Sin
// contraseña solo se atiende a localhost, a una IP literal o a los nombres de APP_HOSTS. Con
// contraseña (y en producción, donde el Host es el dominio público) decide la puerta.

import type { FastifyInstance } from 'fastify';

const CAMBIAN = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const sinBarra = (o: string) => o.replace(/\/$/, '');

/** El host:puerto de una cabecera Host, normalizado como lo hace URL; null si no se entiende. */
function hostDe(host: string | undefined): URL | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`);
  } catch {
    return null;
  }
}

/** ¿Se acepta esta petición que cambia algo? Pura, para los tests. */
export function origenAceptado(peticion: { method: string; host?: string; origin?: string; secFetchSite?: string }, permitidos: string[]): boolean {
  if (!CAMBIAN.has(peticion.method.toUpperCase())) return true;
  const origin = peticion.origin ? sinBarra(peticion.origin) : undefined;
  if (origin && permitidos.map(sinBarra).includes(origin)) return true;
  const sitio = peticion.secFetchSite?.toLowerCase();
  if (sitio) return sitio === 'same-origin' || sitio === 'none';
  if (!origin) return true;
  const deHost = hostDe(peticion.host);
  try {
    return !!deHost && new URL(origin).host === deHost.host;
  } catch {
    return false;
  }
}

/** Los nombres de máquina que se aceptan sin contraseña, además de localhost y las IP: APP_HOSTS. */
export function hostsPermitidos(entorno: NodeJS.ProcessEnv = process.env): string[] {
  return (entorno.APP_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Sin contraseña: ¿es un Host al que se atiende? localhost, una IP literal o uno de APP_HOSTS. */
export function hostAceptado(host: string | undefined, permitidos: string[]): boolean {
  if (!host) return true; // HTTP/1.0 sin Host: no es un navegador, no hay rebinding.
  const h = hostDe(host)?.hostname;
  if (!h) return false;
  return h === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith('[') || permitidos.includes(h);
}

export function registrarComprobacionDeOrigen(app: FastifyInstance, opciones: { permitidos: string[]; comprobarHost: boolean; hosts: string[] }): void {
  app.addHook('onRequest', async (req, reply) => {
    const cabecera = (k: string) => {
      const v = req.headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    if (opciones.comprobarHost && !hostAceptado(cabecera('host'), opciones.hosts)) {
      return reply.code(403).send({ error: 'Sin contraseña, la app solo atiende a localhost, a su IP o a los nombres de APP_HOSTS.' });
    }
    const ok = origenAceptado({ method: req.method, host: cabecera('host'), origin: cabecera('origin'), secFetchSite: cabecera('sec-fetch-site') }, opciones.permitidos);
    if (!ok) return reply.code(403).send({ error: 'Petición de otro sitio: la app no cambia nada desde fuera de su propia página.' });
  });
}
