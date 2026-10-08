// Subir un fichero a un almacén S3 compatible (AWS, Cloudflare R2, Backblaze B2, MinIO) con
// `fetch` y la firma SigV4 escrita con `node:crypto`. Sin SDK: son cuarenta líneas, y una
// dependencia de 10 MB para hacer un PUT no encaja en este proyecto.
//
// Variables: BACKUP_S3_BUCKET, BACKUP_S3_REGION, BACKUP_S3_ENDPOINT (p. ej.
// https://<cuenta>.r2.cloudflarestorage.com; vacío = AWS), BACKUP_S3_ACCESS_KEY,
// BACKUP_S3_SECRET_KEY.

import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';

export interface ConfigS3 {
  bucket: string;
  region: string;
  endpoint: string;
  accessKey: string;
  secretKey: string;
}

export function configS3(entorno: NodeJS.ProcessEnv = process.env): ConfigS3 | null {
  const bucket = entorno.BACKUP_S3_BUCKET?.trim();
  const accessKey = entorno.BACKUP_S3_ACCESS_KEY?.trim();
  const secretKey = entorno.BACKUP_S3_SECRET_KEY?.trim();
  if (!bucket || !accessKey || !secretKey) return null;
  const region = entorno.BACKUP_S3_REGION?.trim() || 'us-east-1';
  const endpoint = (entorno.BACKUP_S3_ENDPOINT?.trim() || `https://s3.${region}.amazonaws.com`).replace(/\/$/, '');
  return { bucket, region, endpoint, accessKey, secretKey };
}

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, m: string) => createHmac('sha256', k).update(m).digest();

/** Las cabeceras firmadas de un PUT (exportado para probar la firma sin red). */
export function firmarPut(c: ConfigS3, clave: string, cuerpo: Buffer, ahora = new Date()): { url: string; headers: Record<string, string> } {
  const host = new URL(c.endpoint).host;
  const url = `${c.endpoint}/${c.bucket}/${clave.split('/').map(encodeURIComponent).join('/')}`;
  const fecha = ahora.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261007T001122Z
  const dia = fecha.slice(0, 8);
  const hashCuerpo = sha256(cuerpo);
  const headers: Record<string, string> = {
    host,
    'content-type': 'application/octet-stream',
    'x-amz-content-sha256': hashCuerpo,
    'x-amz-date': fecha,
  };
  const firmadas = Object.keys(headers).sort();
  const canonico = ['PUT', `/${c.bucket}/${clave.split('/').map(encodeURIComponent).join('/')}`, '', ...firmadas.map((h) => `${h}:${headers[h]}`), '', firmadas.join(';'), hashCuerpo].join('\n');
  const alcance = `${dia}/${c.region}/s3/aws4_request`;
  const aFirmar = ['AWS4-HMAC-SHA256', fecha, alcance, sha256(canonico)].join('\n');
  const kFecha = hmac(`AWS4${c.secretKey}`, dia);
  const kRegion = hmac(kFecha, c.region);
  const kServicio = hmac(kRegion, 's3');
  const kFirma = hmac(kServicio, 'aws4_request');
  const firma = createHmac('sha256', kFirma).update(aFirmar).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${alcance}, SignedHeaders=${firmadas.join(';')}, Signature=${firma}`;
  const { host: _h, ...sinHost } = headers;
  void _h;
  return { url, headers: sinHost };
}

export async function subirS3(c: ConfigS3, fichero: string, clave: string): Promise<string> {
  const cuerpo = fs.readFileSync(fichero);
  const { url, headers } = firmarPut(c, clave, cuerpo);
  const res = await fetch(url, { method: 'PUT', headers, body: cuerpo });
  if (!res.ok) throw new Error(`S3 respondió ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return url;
}
