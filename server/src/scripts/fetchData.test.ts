// A7: una instalación nueva acababa con la base vacía. `setup` corría db:migrate antes de los
// datos, eso dejaba un history.db solo con esquema, fetch-data veía que el fichero existía y no
// descargaba. Ahora una base sin filas cuenta como ausente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { hayHistoria } = (await import(path.join(ROOT, 'scripts', 'datos-estado.mjs'))) as { hayHistoria: (fichero: string) => boolean };

/**
 * El script en un proceso hijo, SIN bloquear: el servidor que le sirve la release vive en este
 * mismo proceso, y con `spawnSync` nunca llegaría a contestarle.
 */
function correFetchData(env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((ok, mal) => {
    const h = spawn(process.execPath, [path.join(ROOT, 'scripts', 'fetch-data.mjs')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    h.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    h.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    h.on('error', mal);
    h.on('close', (status) => ok({ status, stdout, stderr }));
  });
}

const ESQUEMA = 'CREATE TABLE matches (id INTEGER PRIMARY KEY, winner_id TEXT); CREATE TABLE fb_matches (id INTEGER PRIMARY KEY); CREATE TABLE naf_games (id INTEGER PRIMARY KEY); CREATE TABLE player_ratings (player_id TEXT PRIMARY KEY);';

function baseCon(filas: number, fichero: string): void {
  const db = new DatabaseSync(fichero);
  db.exec(ESQUEMA);
  db.exec('BEGIN');
  const ins = db.prepare('INSERT INTO matches (winner_id) VALUES (?)');
  for (let i = 0; i < filas; i++) ins.run(`p${i}`);
  db.exec('COMMIT');
  db.close();
}

test('A7: hayHistoria distingue una base solo con esquema de una con filas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datos-estado-'));
  assert.equal(hayHistoria(path.join(dir, 'no-existe.db')), false);
  baseCon(0, path.join(dir, 'vacia.db'));
  assert.equal(hayHistoria(path.join(dir, 'vacia.db')), false);
  baseCon(12, path.join(dir, 'llena.db'));
  assert.equal(hayHistoria(path.join(dir, 'llena.db')), true);
  fs.writeFileSync(path.join(dir, 'rota.db'), 'esto no es sqlite');
  assert.equal(hayHistoria(path.join(dir, 'rota.db')), false);
});

test('A7: fetch-data descarga aunque haya un history.db solo con esquema (y lo aparta)', async () => {
  // La release, servida en local (DATA_BASE_URL): una base con filas de sobra, comprimida y con su checksum.
  const publicada = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  baseCon(10_500, path.join(publicada, 'history.db'));
  const gz = zlib.gzipSync(fs.readFileSync(path.join(publicada, 'history.db')));
  const sha = crypto.createHash('sha256').update(gz).digest('hex');
  const servidor = http.createServer((req, res) => {
    if (req.url === '/history.db.gz') return res.writeHead(200, { 'content-type': 'application/gzip' }).end(gz);
    if (req.url === '/history.db.gz.sha256') return res.writeHead(200, { 'content-type': 'text/plain' }).end(`${sha}  history.db.gz\n`);
    res.writeHead(404).end('no');
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const puerto = (servidor.address() as AddressInfo).port;

  // La instalación: un history.db solo con esquema (lo que deja db:migrate antes de bajar datos).
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instalacion-'));
  baseCon(0, path.join(dataDir, 'history.db'));
  try {
    const entorno = { ...process.env, DATA_DIR: dataDir, DATA_BASE_URL: `http://127.0.0.1:${puerto}`, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' };
    const r = await correFetchData(entorno);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(hayHistoria(path.join(dataDir, 'history.db')), true, r.stdout);
    const db = new DatabaseSync(path.join(dataDir, 'history.db'));
    assert.equal((db.prepare('SELECT COUNT(*) n FROM matches').get() as { n: number }).n, 10_500);
    db.close();
    const apartada = fs.readdirSync(dataDir).find((f) => f.startsWith('history.db.sin-filas-'));
    assert.ok(apartada, `la base sin filas se aparta con fecha: ${fs.readdirSync(dataDir).join(', ')}`);
    assert.match(r.stdout, /sin filas/i);

    // Una segunda vez, con filas, no toca nada.
    const r2 = await correFetchData(entorno);
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /No se toca/);
  } finally {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  }
});
