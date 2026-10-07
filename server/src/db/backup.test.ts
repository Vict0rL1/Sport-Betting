// La copia del libro mayor: un fichero aparte, íntegro, con las mismas filas; la restauración
// aparta la actual antes de pisar nada; la firma S3 es determinista y no sale a la red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { hacerCopia, copiasLocales, ultimaCopia, restaurarCopia, COPIAS_LOCALES } = await import('./backup.ts');
const { configS3, firmarPut } = await import('./s3.ts');
const { TABLAS_LEDGER } = await import('./tables.ts');

test('hacerCopia: un ledger-<fecha>.db íntegro, solo con tablas del libro mayor y con las mismas filas; se anota la fecha', async () => {
  const db = getDb();
  db.exec("INSERT INTO alerts (created_at, type, severity, title, body) VALUES ('2026-10-01T00:00:00Z', 'x', 'info', 't', 'b'), ('2026-10-02T00:00:00Z', 'y', 'aviso', 't2', 'b2')");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copias-'));
  const ahora = new Date('2026-10-07T04:10:00Z');
  const c = await hacerCopia({ dir, ahora, subir: false });
  assert.ok(c.fichero.endsWith('ledger-2026-10-07T04-10-00.db'));
  assert.equal(c.integridad, 'ok');
  assert.ok(c.bytes > 0);
  assert.equal(c.s3, undefined, 'sin credenciales no se intenta subir');
  const copia = new DatabaseSync(c.fichero, { readOnly: true });
  const tablas = new Set((copia.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name));
  for (const t of ['paper_bets', 'prediction_log', 'odds_snapshots', 'alerts', 'settings']) assert.ok(tablas.has(t), `${t} en la copia`);
  for (const t of ['fb_matches', 'matches', 'players', 'meta']) assert.ok(!tablas.has(t), `${t} NO va en la copia: es historia`);
  for (const t of tablas) assert.ok(TABLAS_LEDGER.includes(t) || t === 'schema_version', `${t} es del libro mayor`);
  assert.equal((copia.prepare('SELECT COUNT(*) AS n FROM alerts').get() as { n: number }).n, 2);
  copia.close();
  assert.deepEqual(ultimaCopia(), { cuando: ahora.toISOString(), fichero: c.fichero });
  assert.equal(copiasLocales(dir).length, 1);
});

test('rotación: nunca más de COPIAS_LOCALES ficheros, y se van los más viejos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copias-'));
  for (let i = 0; i < COPIAS_LOCALES + 3; i++) {
    const c = await hacerCopia({ dir, ahora: new Date(Date.UTC(2026, 0, 1 + i)), subir: false });
    // mtime creciente a mano: en el mismo segundo el orden sería ambiguo.
    fs.utimesSync(c.fichero, new Date(Date.UTC(2026, 0, 1 + i)), new Date(Date.UTC(2026, 0, 1 + i)));
  }
  const quedan = copiasLocales(dir);
  assert.equal(quedan.length, COPIAS_LOCALES);
  assert.ok(quedan.every((c) => !c.fichero.includes('2026-01-01') && !c.fichero.includes('2026-01-02') && !c.fichero.includes('2026-01-03')), 'las tres primeras se fueron');
});

test('restaurarCopia: exige integridad y pinta de libro mayor, aparta el destino actual y copia', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'restaurar-'));
  const c = await hacerCopia({ dir, ahora: new Date('2026-10-07T05:00:00Z'), subir: false });
  const destino = path.join(dir, 'ledger.db');
  fs.writeFileSync(destino, 'lo que había');
  fs.writeFileSync(`${destino}-wal`, 'wal viejo');
  const r = restaurarCopia(c.fichero, { destino, ahora: new Date('2026-10-07T06:00:00Z') });
  assert.equal(r.destino, destino);
  assert.ok(r.apartado && fs.existsSync(r.apartado) && fs.readFileSync(r.apartado, 'utf8') === 'lo que había', 'lo anterior se apartó entero');
  assert.ok(!fs.existsSync(`${destino}-wal`), 'el WAL del fichero viejo no puede quedarse: pertenecía a otra base');
  const abierta = new DatabaseSync(destino, { readOnly: true });
  assert.equal((abierta.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  abierta.close();
  // Un fichero que no es un libro mayor se rechaza antes de tocar nada.
  const otra = path.join(dir, 'otra.db');
  const o = new DatabaseSync(otra);
  o.exec('CREATE TABLE x (n)');
  o.close();
  assert.throws(() => restaurarCopia(otra, { destino }), /no parece un libro mayor/);
  assert.throws(() => restaurarCopia(path.join(dir, 'no-existe.db'), { destino }), /No existe/);
});

test('S3: sin las tres variables no hay configuración; la firma SigV4 es determinista y lleva lo que AWS exige', () => {
  assert.equal(configS3({} as NodeJS.ProcessEnv), null);
  assert.equal(configS3({ BACKUP_S3_BUCKET: 'b', BACKUP_S3_ACCESS_KEY: 'a' } as NodeJS.ProcessEnv), null);
  const c = configS3({ BACKUP_S3_BUCKET: 'copias', BACKUP_S3_ACCESS_KEY: 'AKIAEXAMPLE', BACKUP_S3_SECRET_KEY: 'secreto', BACKUP_S3_REGION: 'eu-west-1' } as NodeJS.ProcessEnv)!;
  assert.equal(c.endpoint, 'https://s3.eu-west-1.amazonaws.com');
  const r2 = configS3({ BACKUP_S3_BUCKET: 'copias', BACKUP_S3_ACCESS_KEY: 'a', BACKUP_S3_SECRET_KEY: 's', BACKUP_S3_ENDPOINT: 'https://cuenta.r2.cloudflarestorage.com/' } as NodeJS.ProcessEnv)!;
  assert.equal(r2.endpoint, 'https://cuenta.r2.cloudflarestorage.com', 'sin barra final');
  const cuando = new Date('2026-10-07T00:11:22Z');
  const a = firmarPut(c, 'ledger/ledger-2026.db', Buffer.from('hola'), cuando);
  const b = firmarPut(c, 'ledger/ledger-2026.db', Buffer.from('hola'), cuando);
  assert.deepEqual(a, b, 'misma entrada, misma firma');
  assert.equal(a.url, 'https://s3.eu-west-1.amazonaws.com/copias/ledger/ledger-2026.db');
  assert.equal(a.headers['x-amz-date'], '20261007T001122Z');
  assert.match(a.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261007\/eu-west-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(a.headers['x-amz-content-sha256'].length, 64);
  const distinta = firmarPut(c, 'ledger/ledger-2026.db', Buffer.from('adiós'), cuando);
  assert.notEqual(distinta.headers.authorization, a.headers.authorization, 'otro cuerpo, otra firma');
  assert.ok(!('host' in a.headers), 'host lo pone fetch');
});
