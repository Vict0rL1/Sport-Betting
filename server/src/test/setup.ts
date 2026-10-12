// Preparación común de los tests (`npm test`). Se carga ANTES que cualquier módulo de la
// app, en cada proceso de test (node:test aísla cada fichero en su propio proceso).
//
// Tres garantías, y las tres son de seguridad, no de comodidad:
//
//  1. BASE DE DATOS DE USAR Y TIRAR. `DATA_DIR` apunta a un directorio temporal nuevo:
//     un test nunca puede tocar data/tennis.db, que es donde viven tus apuestas.
//  2. NUNCA TU CLAVE. dotenv no pisa una variable que ya existe, así que fijarla aquí
//     impide que el .env de la raíz meta tu ODDS_API_KEY real en un test.
//  3. NUNCA LA RED. `fetch` queda bloqueado: un test que olvide simular una respuesta
//     falla en voz alta en vez de gastar créditos de tu plan en silencio.
//  4. NUNCA TUS COPIAS. BACKUP_DIR es una ruta global, no de un DATA_DIR: con la de tu .env, un
//     test leería tus copias reales del libro mayor, escribiría entre ellas o subiría una de
//     demostración a tu bucket. Cada proceso de test usa la carpeta de su DATA_DIR y ningún S3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'predicciones-test-'));
process.env.BACKUP_DIR = path.join(process.env.DATA_DIR, 'backups');
for (const k of ['BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY', 'BACKUP_S3_ENDPOINT']) process.env[k] = '';
process.env.ODDS_API_KEY = 'clave-de-test-0000000000000000000';
process.env.THE_ODDS_API_KEY = '';
process.env.ODDS_REGIONS = 'eu';
process.env.DEMO_FIXTURES = 'on';
process.env.AUTO_REFRESH_MINUTES = '0';
process.env.ANTHROPIC_API_KEY = '';

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;
let handler: Handler | null = null;

/** Instala la respuesta simulada de `fetch` para el test en curso. */
export function simularFetch(h: Handler | null): void {
  handler = h;
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!handler) throw new Error(`test sin fetch simulado intentó salir a la red: ${url}`);
  return handler(url, init);
}) as typeof fetch;
