// Compresión y ETag de las respuestas (Fase 7.1), con node:zlib y node:crypto: sin dependencias.
//
// ===========================================================================
// POR QUÉ
// ===========================================================================
// Medido antes de esta fase: la lista de próximos de fútbol pesaba 1,4 MB de JSON sin comprimir
// en cada petición, y ninguna respuesta llevaba ETag, así que un dato que no había cambiado se
// volvía a bajar entero cada vez. JSON repetitivo comprime a menos de una décima parte.
//
// ===========================================================================
// QUÉ HACE
// ===========================================================================
// · ETag débil sobre el cuerpo SIN comprimir en todo GET /api/* que responda 200, con
//   `Cache-Control: no-cache` (el navegador guarda y revalida siempre) y 304 sin cuerpo si
//   coincide. Así los datos casi estáticos —interruptores, históricos, tablas— salen gratis sin
//   tener que enumerarlos, y nada se sirve viejo: siempre se pregunta.
// · Brotli (calidad 5) o gzip para lo que sea texto de más de 1 KB y el cliente acepte. Los ficheros
//   de la web van ya comprimidos desde la build (static.ts, `preCompressed`).
// No toca el canal SSE (sale del ciclo normal de Fastify) ni lo que ya venga comprimido.

import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import type { FastifyInstance } from 'fastify';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

export const MIN_BYTES = 1024;
const COMPRIMIBLE = /^(application\/(json|javascript|xml|pdf|problem\+json)|text\/|image\/svg\+xml)/;

export function etagDe(cuerpo: string | Buffer): string {
  return `W/"${createHash('sha1').update(cuerpo).digest('base64url')}"`;
}

/** ¿Coincide alguna de las etiquetas de If-None-Match? («*» también vale). */
export function coincide(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const debil = (s: string) => s.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some((x) => x.trim() === '*' || debil(x) === debil(etag));
}

/** La codificación a usar según Accept-Encoding: br, gzip o ninguna (q=0 es «no»). */
export function codificacionPara(acceptEncoding: string | undefined): 'br' | 'gzip' | null {
  const aceptadas = new Set<string>();
  for (const parte of String(acceptEncoding ?? '').toLowerCase().split(',')) {
    const [nombre, ...params] = parte.split(';').map((x) => x.trim());
    const q = params.find((p) => p.startsWith('q='));
    if (nombre && (!q || Number(q.slice(2)) > 0)) aceptadas.add(nombre);
  }
  if (aceptadas.has('br')) return 'br';
  if (aceptadas.has('gzip') || aceptadas.has('*')) return 'gzip';
  return null;
}

/**
 * Los últimos cuerpos comprimidos, por ETag y codificación: una lista de próximos que no ha
 * cambiado (Fase 7.2) no se vuelve a comprimir en cada petición. Acotada en número y en bytes.
 */
const COMPRIMIDOS = new Map<string, Buffer>();
const MAX_COMPRIMIDOS = 64;
const MAX_BYTES_COMPRIMIDOS = 32 * 1024 * 1024;
let bytesComprimidos = 0;

function guardarComprimido(clave: string, b: Buffer): void {
  if (b.length > MAX_BYTES_COMPRIMIDOS / 4) return;
  COMPRIMIDOS.set(clave, b);
  bytesComprimidos += b.length;
  while (COMPRIMIDOS.size > MAX_COMPRIMIDOS || bytesComprimidos > MAX_BYTES_COMPRIMIDOS) {
    const [k, v] = COMPRIMIDOS.entries().next().value as [string, Buffer];
    COMPRIMIDOS.delete(k);
    bytesComprimidos -= v.length;
  }
}

function conVary(actual: unknown, valor: string): string {
  const xs = String(actual ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return xs.some((x) => x.toLowerCase() === valor.toLowerCase()) ? xs.join(', ') : [...xs, valor].join(', ');
}

export function registrarCompresionYEtag(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, payload) => {
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    if (req.method === 'GET' && reply.statusCode === 200 && req.url.startsWith('/api/') && !reply.getHeader('etag')) {
      const etag = etagDe(payload);
      reply.header('etag', etag);
      if (!reply.getHeader('cache-control')) reply.header('cache-control', 'no-cache');
      if (coincide(req.headers['if-none-match'], etag)) {
        reply.code(304);
        reply.removeHeader('content-length');
        return '';
      }
    }
    if (req.method === 'HEAD' || reply.getHeader('content-encoding')) return payload;
    const tipo = String(reply.getHeader('content-type') ?? '');
    if (!COMPRIMIBLE.test(tipo) || Buffer.byteLength(payload) < MIN_BYTES) return payload;
    reply.header('vary', conVary(reply.getHeader('vary'), 'Accept-Encoding'));
    const cod = codificacionPara(req.headers['accept-encoding']);
    if (!cod) return payload;
    reply.header('content-encoding', cod);
    reply.removeHeader('content-length');
    const etag = reply.getHeader('etag');
    const clave = etag ? `${String(etag)}|${cod}` : null;
    const ya = clave ? COMPRIMIDOS.get(clave) : undefined;
    if (ya) return ya;
    const b = cod === 'br' ? await brotli(payload, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : await gzip(payload, { level: 6 });
    if (clave) guardarComprimido(clave, b);
    return b;
  });
}
