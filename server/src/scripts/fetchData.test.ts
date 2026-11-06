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
function correFetchData(env: NodeJS.ProcessEnv, args: string[] = []): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((ok, mal) => {
    // Con tsx, como `npm run fetch-data`: importa la clasificación de claves del servidor (tables.ts).
    const h = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'fetch-data.mjs'), ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
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

// ---------------------------------------------------------------------------
// B1 · B3: --force con WAL, con el servidor en marcha, y lo tuyo que sobrevive
// ---------------------------------------------------------------------------
const { otraConexionAbierta } = (await import(path.join(ROOT, 'scripts', 'datos-estado.mjs'))) as { otraConexionAbierta: (fichero: string) => boolean };

const ESQUEMA_MIO =
  'CREATE TABLE bets (id INTEGER PRIMARY KEY, stake REAL); CREATE TABLE fb_news (id TEXT PRIMARY KEY, quote TEXT); CREATE TABLE fb_lineups (fixture_id TEXT, team_id TEXT, player_id TEXT, kind TEXT, recorded_at TEXT); ' +
  'CREATE TABLE fb_odds_history (id INTEGER PRIMARY KEY, fixture_id TEXT, observed_at TEXT); CREATE TABLE latency_samples (id INTEGER PRIMARY KEY, stage TEXT, ms REAL); CREATE TABLE player_ids (tour TEXT, name TEXT, id INTEGER, PRIMARY KEY (tour, name)); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);';

async function servidorConRelease(filasPublicadas: number, metaPublicada: Record<string, string> = {}, tablasExtra: string[] = []) {
  const publicada = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  baseCon(filasPublicadas, path.join(publicada, 'history.db'));
  const d = new DatabaseSync(path.join(publicada, 'history.db'));
  // Como una release oficial: sin tablas del libro mayor (la exportación las rechaza desde la Fase 2).
  d.exec(ESQUEMA_MIO.replace('CREATE TABLE bets (id INTEGER PRIMARY KEY, stake REAL); ', ''));
  for (const sql of tablasExtra) d.exec(sql);
  const ins = d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(metaPublicada)) ins.run(k, v);
  d.close();
  const gz = zlib.gzipSync(fs.readFileSync(path.join(publicada, 'history.db')));
  const sha = crypto.createHash('sha256').update(gz).digest('hex');
  const servidor = http.createServer((req, res) => {
    if (req.url === '/history.db.gz') return res.writeHead(200, { 'content-type': 'application/gzip' }).end(gz);
    if (req.url === '/history.db.gz.sha256') return res.writeHead(200, { 'content-type': 'text/plain' }).end(`${sha}  history.db.gz\n`);
    res.writeHead(404).end('no');
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  return { puerto: (servidor.address() as AddressInfo).port, cerrar: () => new Promise<void>((ok) => servidor.close(() => ok())) };
}

test('B1: otraConexionAbierta (datos-estado.mjs) ve una conexión abierta y deja de verla al cerrar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonda-'));
  const f = path.join(dir, 'x.db');
  const db = new DatabaseSync(f);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (x); INSERT INTO t VALUES (1);');
  assert.equal(otraConexionAbierta(f), true);
  db.close();
  assert.equal(otraConexionAbierta(f), false);
});

test('B1: fetch-data --force se niega con la base abierta; cerrada, la copia de la anterior lleva lo que estaba en el WAL y no queda un -wal viejo', async () => {
  const s = await servidorConRelease(10_500);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instalacion-force-'));
  const history = path.join(dataDir, 'history.db');
  try {
    // La instalación actual: con filas, con lo tuyo, y con páginas en el WAL (como la deja un
    // servidor en marcha): se copia el fichero Y su WAL mientras la conexión sigue abierta.
    const vivo = fs.mkdtempSync(path.join(os.tmpdir(), 'viva-'));
    baseCon(12, path.join(vivo, 'history.db'));
    const v = new DatabaseSync(path.join(vivo, 'history.db'));
    v.exec('PRAGMA journal_mode = WAL;');
    v.exec(ESQUEMA_MIO);
    v.exec("INSERT INTO fb_news VALUES ('n1', 'lesión'); INSERT INTO fb_lineups VALUES ('f1', 't1', 'p1', 'confirmada', '2026-10-08T10:00:00Z'); INSERT INTO fb_odds_history (fixture_id, observed_at) VALUES ('f1', '2026-10-08T09:00:00Z'); INSERT INTO latency_samples (stage, ms) VALUES ('servidor', 12); INSERT INTO player_ids VALUES ('atp', 'Nadie', 999);");
    v.exec("INSERT INTO matches (winner_id) VALUES ('en-el-wal')");
    // Lo del dueño que aún esté en la meta de la historia (una instalación que todavía no pasó por la
    // migración 27) y procedencia de la descarga anterior, que no tiene que pasar.
    v.exec(`INSERT INTO meta VALUES ('features.anulaciones', '{"estrategias.laboratorio":false}'), ('ajustes.usuario', '{"idioma":"en"}'), ('fb_updated_at', 'vieja')`);
    for (const suf of ['', '-wal', '-shm']) if (fs.existsSync(path.join(vivo, 'history.db') + suf)) fs.copyFileSync(path.join(vivo, 'history.db') + suf, history + suf);
    v.close();
    assert.ok(fs.statSync(`${history}-wal`).size > 0, 'la instalación tiene páginas en el WAL');

    const entorno = { ...process.env, DATA_DIR: dataDir, DATA_BASE_URL: `http://127.0.0.1:${s.puerto}`, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' };
    // 1. Con una conexión abierta (el servidor en marcha): no se toca nada.
    const abierta = new DatabaseSync(history);
    abierta.exec('SELECT 1');
    const negado = await correFetchData(entorno, ['--force']);
    abierta.close();
    assert.equal(negado.status, 1, `${negado.stdout}\n${negado.stderr}`);
    assert.match(negado.stdout + negado.stderr, /abiert|en marcha/i);
    assert.equal(fs.readdirSync(dataDir).filter((f) => f.startsWith('history.db.backup-')).length, 0, 'ni copia ni reemplazo');

    // 2. Cerrada: reemplaza, con copia COMPLETA de la anterior y lo tuyo conservado.
    const r = await correFetchData(entorno, ['--force']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.equal(fs.existsSync(`${history}-wal`), false, 'un WAL de otro fichero no puede quedarse al lado del nuevo');
    const backup = fs.readdirSync(dataDir).find((f) => f.startsWith('history.db.backup-'));
    assert.ok(backup, fs.readdirSync(dataDir).join(', '));
    const copia = new DatabaseSync(path.join(dataDir, backup!), { readOnly: true });
    assert.equal((copia.prepare("SELECT COUNT(*) n FROM matches WHERE winner_id = 'en-el-wal'").get() as { n: number }).n, 1, 'la copia de la anterior lleva lo que estaba en el WAL');
    assert.equal((copia.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
    copia.close();
    const nueva = new DatabaseSync(history, { readOnly: true });
    assert.equal((nueva.prepare('SELECT COUNT(*) n FROM matches').get() as { n: number }).n, 10_500);
    // `bets` es del libro mayor: una historia oficial no la trae, y la nueva tampoco la tiene (taparía la
    // del libro mayor). Con filas en la local, fetch-data no reemplaza nada (prueba de más abajo).
    assert.equal((nueva.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'bets'").get() as { n: number }).n, 0, 'ninguna tabla del libro mayor en la historia');
    for (const t of ['fb_news', 'fb_lineups', 'fb_odds_history', 'latency_samples', 'player_ids']) {
      assert.equal((nueva.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n, 1, `${t} sobrevive al --force (B3)`);
    }
    // Los interruptores de Ajustes y los ajustes del usuario pasan, para que la migración 27 los lleve
    // al libro mayor (revisión data-guardian del 29 de octubre); la procedencia de la descarga, no.
    const meta = Object.fromEntries((nueva.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    assert.deepEqual(meta, { 'features.anulaciones': '{"estrategias.laboratorio":false}', 'ajustes.usuario': '{"idioma":"en"}' });
    nueva.close();
  } finally {
    await s.cerrar();
  }
});

// Auditoría paralela del 3 de noviembre: carryOver conservaba lo del dueño con INSERT OR IGNORE, así
// que si la historia descargada traía esas claves, mandaban las descargadas; y en una instalación
// nueva (sin historia local) la migración 27 las habría llevado tal cual al libro mayor. Una
// descarga nunca trae estado del dueño: lo que traiga con una clave del libro mayor se descarta.
const CONTAMINADA = {
  'ajustes.usuario': '{"bancoPersonal":99999,"idioma":"de"}',
  'features.anulaciones': '{"estrategias.laboratorio":true}',
  'telegram:chat_id': 'chat-ajeno-777',
  fb_updated_at: 'de-la-release',
};
const metaDe = (f: string) => {
  const d = new DatabaseSync(f, { readOnly: true });
  try {
    return Object.fromEntries((d.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  } finally {
    d.close();
  }
};

test('una descarga con claves del libro mayor en su meta: en una instalación nueva se descartan (no las recoge la migración 27), con aviso y sin enseñar los valores', async () => {
  const s = await servidorConRelease(10_500, CONTAMINADA);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instalacion-nueva-'));
  try {
    const entorno = { ...process.env, DATA_DIR: dataDir, DATA_BASE_URL: `http://127.0.0.1:${s.puerto}`, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' };
    const r = await correFetchData(entorno);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.deepEqual(metaDe(path.join(dataDir, 'history.db')), { fb_updated_at: 'de-la-release' }, 'solo la procedencia de la descarga');
    assert.match(r.stdout + r.stderr, /3 clave\(s\) del libro mayor/);
    assert.doesNotMatch(r.stdout + r.stderr, /99999|chat-ajeno/, 'sin los valores');
  } finally {
    await s.cerrar();
  }
});

test('--force sobre una instalación de antes de la migración 27: mandan los ajustes locales del dueño, no los de la descarga', async () => {
  const s = await servidorConRelease(10_500, CONTAMINADA);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instalacion-local-'));
  const history = path.join(dataDir, 'history.db');
  try {
    baseCon(12, history);
    const v = new DatabaseSync(history);
    v.exec(ESQUEMA_MIO);
    v.exec(`INSERT INTO meta VALUES ('features.anulaciones', '{"estrategias.laboratorio":false}'), ('ajustes.usuario', '{"bancoPersonal":250,"idioma":"en"}'), ('fb_updated_at', 'local-vieja'), ('backup:last_file', '/home/dueno/copias/ledger.db')`);
    v.close();
    const entorno = { ...process.env, DATA_DIR: dataDir, DATA_BASE_URL: `http://127.0.0.1:${s.puerto}`, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' };
    const r = await correFetchData(entorno, ['--force']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.deepEqual(
      metaDe(history),
      { 'features.anulaciones': '{"estrategias.laboratorio":false}', 'ajustes.usuario': '{"bancoPersonal":250,"idioma":"en"}', fb_updated_at: 'de-la-release' },
      'lo del dueño que recoge la migración 27, el local; la procedencia, la de la descarga; nada ajeno del libro mayor, ni más estado local (rutas de copias) del que hace falta',
    );
    // La copia de la anterior sigue con lo que tenía (es la recuperación de --force).
    const backup = fs.readdirSync(dataDir).find((f) => f.startsWith('history.db.backup-'));
    assert.ok(backup);
    assert.equal(metaDe(path.join(dataDir, backup!))['ajustes.usuario'], '{"bancoPersonal":250,"idioma":"en"}');
  } finally {
    await s.cerrar();
  }
});

test('una descarga con tablas del libro mayor no se instala: en la instalación taparían las tuyas (revisión data-guardian)', async () => {
  // Una release que no sale del workflow oficial (DATA_REPO, DATA_TAG o DATA_BASE_URL apuntan a otra):
  // su SHA-256 prueba que llegó entera, no de dónde viene. Con `watchlist` en la historia, la app la
  // leería y escribiría ahí en vez de en el libro mayor.
  const s = await servidorConRelease(10_500, {}, ["CREATE TABLE watchlist (id INTEGER PRIMARY KEY, kind TEXT); INSERT INTO watchlist (kind) VALUES ('plantada')", "CREATE VIEW paper_bets AS SELECT 1 AS id"]);
  const nuevaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instalacion-tablas-'));
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'instalacion-tablas-local-'));
  try {
    const entorno = (dir: string) => ({ ...process.env, DATA_DIR: dir, DATA_BASE_URL: `http://127.0.0.1:${s.puerto}`, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' });
    const nueva = await correFetchData(entorno(nuevaDir));
    assert.equal(nueva.status, 1, `${nueva.stdout}\n${nueva.stderr}`);
    assert.match(nueva.stdout + nueva.stderr, /tablas del libro mayor.*watchlist/);
    // Una vista con el nombre de una tabla del libro mayor también la tapa (y la deja sin escritura).
    assert.match(nueva.stdout + nueva.stderr, /tablas del libro mayor.*paper_bets/);
    assert.equal(fs.existsSync(path.join(nuevaDir, 'history.db')), false, 'instalación nueva: no se instala nada');
    baseCon(12, path.join(localDir, 'history.db'));
    const huella = crypto.createHash('sha256').update(fs.readFileSync(path.join(localDir, 'history.db'))).digest('hex');
    const force = await correFetchData(entorno(localDir), ['--force']);
    assert.equal(force.status, 1, `${force.stdout}\n${force.stderr}`);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(localDir, 'history.db'))).digest('hex'), huella, '--force: la tuya, intacta');
    assert.deepEqual(fs.readdirSync(localDir).filter((f) => f !== 'history.db'), [], 'ni copia ni temporales');
  } finally {
    await s.cerrar();
  }
});

test('una historia local con filas en tablas del libro mayor no se reemplaza ni se aparta: son registros que no se recuperan (revisión data-guardian)', async () => {
  // Una instalación anómala: `bets` en la historia tapó la del libro mayor y guardó ahí apuestas de
  // verdad. Antes, --force las dejaba solo en la copia con fecha sin decir nada.
  const s = await servidorConRelease(10_500);
  try {
    for (const [nombre, filas] of [['con-historia', 12], ['solo-esquema', 0]] as const) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `instalacion-${nombre}-`));
      const history = path.join(dataDir, 'history.db');
      baseCon(filas, history);
      const v = new DatabaseSync(history);
      v.exec(ESQUEMA_MIO);
      v.exec('INSERT INTO bets (stake) VALUES (25.5), (40)');
      v.close();
      const huella = crypto.createHash('sha256').update(fs.readFileSync(history)).digest('hex');
      const entorno = { ...process.env, DATA_DIR: dataDir, DATA_BASE_URL: `http://127.0.0.1:${s.puerto}`, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' };
      const r = await correFetchData(entorno, ['--force']);
      assert.equal(r.status, 1, `${nombre}: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout + r.stderr, /bets: 2/);
      assert.doesNotMatch(r.stdout + r.stderr, /25\.5/, 'sin los valores');
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(history)).digest('hex'), huella, `${nombre}: intacta`);
      assert.deepEqual(fs.readdirSync(dataDir), ['history.db'], `${nombre}: ni apartada, ni copia, ni temporales`);
    }
  } finally {
    await s.cerrar();
  }
});

// ---- Auditoría del 5 de noviembre: una historia sin filas perdía los ajustes del dueño ----
// La historia sin filas (solo esquema) se apartaba como history.db.sin-filas-* ANTES de calcular
// `exists`, y como carryOver solo corría con `exists`, sus ajustes (de antes de la migración 27) no
// pasaban a la nueva: se quedaban solo en la copia apartada. Y si la descarga fallaba, history.db ya no
// estaba en su sitio.

/** Una instalación: history.db con `filas` partidos y la meta dada, y un ledger.db que no se debe tocar. */
function instalacion(nombre: string, filas: number, meta: Record<string, string>): { dataDir: string; history: string; huellaLedger: string } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `instalacion-${nombre}-`));
  const history = path.join(dataDir, 'history.db');
  baseCon(filas, history);
  const v = new DatabaseSync(history);
  v.exec(ESQUEMA_MIO.replace('CREATE TABLE bets (id INTEGER PRIMARY KEY, stake REAL); ', ''));
  const ins = v.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [k, val] of Object.entries(meta)) ins.run(k, val);
  v.close();
  const l = new DatabaseSync(path.join(dataDir, 'ledger.db'));
  l.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL); INSERT INTO settings VALUES ('ajustes.usuario', '{\"bancoPersonal\":321}', '2026-11-01T00:00:00.000Z'); CREATE TABLE paper_bets (id INTEGER PRIMARY KEY, stake REAL); INSERT INTO paper_bets (stake) VALUES (10);");
  l.close();
  return { dataDir, history, huellaLedger: crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'ledger.db'))).digest('hex') };
}
const huellaDe = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const DEL_DUENO = { 'features.anulaciones': '{"estrategias.laboratorio":false}', 'ajustes.usuario': '{"idioma":"en","bancoPersonal":250}' };
const entornoDe = (dataDir: string, puerto: number) => ({ ...process.env, DATA_DIR: dataDir, DATA_BASE_URL: `http://127.0.0.1:${puerto}`, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' });

test('historia sin filas con ajustes del dueño, sin y con --force: los ajustes pasan a la nueva (mandan los locales, los privados de la descarga se descartan, su procedencia se queda) y el libro mayor no se toca', async () => {
  const s = await servidorConRelease(10_500, CONTAMINADA);
  try {
    for (const args of [[], ['--force']]) {
      const { dataDir, history, huellaLedger } = instalacion(`vacia${args.join('')}`, 0, { ...DEL_DUENO, fb_updated_at: 'local-vieja' });
      const r = await correFetchData(entornoDe(dataDir, s.puerto), args);
      assert.equal(r.status, 0, `${args}: ${r.stdout}\n${r.stderr}`);
      assert.deepEqual(metaDe(history), { ...DEL_DUENO, fb_updated_at: 'de-la-release' }, `${args}: lo del dueño, el local; la procedencia, la de la descarga; nada ajeno`);
      assert.match(r.stdout, /sin filas/i);
      const apartada = fs.readdirSync(dataDir).find((f) => /^history\.db\.sin-filas-[^-]+.*\d$/.test(f) && !/-(wal|shm)$/.test(f));
      assert.ok(apartada, `${args}: la anterior queda apartada con fecha: ${fs.readdirSync(dataDir).join(', ')}`);
      assert.equal(metaDe(path.join(dataDir, apartada!))['ajustes.usuario'], DEL_DUENO['ajustes.usuario'], `${args}: y con lo que tenía`);
      assert.equal(huellaDe(path.join(dataDir, 'ledger.db')), huellaLedger, `${args}: ledger.db, ni un byte`);
    }
  } finally {
    await s.cerrar();
  }
});

test('historia sin filas y sin ajustes: solo la procedencia de la descarga; con filas y ajustes (--force): mandan los locales; el libro mayor, igual', async () => {
  const s = await servidorConRelease(10_500, CONTAMINADA);
  try {
    const vacia = instalacion('vacia-sin-ajustes', 0, {});
    const r1 = await correFetchData(entornoDe(vacia.dataDir, s.puerto));
    assert.equal(r1.status, 0, `${r1.stdout}\n${r1.stderr}`);
    assert.deepEqual(metaDe(vacia.history), { fb_updated_at: 'de-la-release' });
    assert.equal(huellaDe(path.join(vacia.dataDir, 'ledger.db')), vacia.huellaLedger);
    const llena = instalacion('llena-con-ajustes', 12, { ...DEL_DUENO, fb_updated_at: 'local-vieja' });
    const r2 = await correFetchData(entornoDe(llena.dataDir, s.puerto), ['--force']);
    assert.equal(r2.status, 0, `${r2.stdout}\n${r2.stderr}`);
    assert.deepEqual(metaDe(llena.history), { ...DEL_DUENO, fb_updated_at: 'de-la-release' });
    assert.equal(huellaDe(path.join(llena.dataDir, 'ledger.db')), llena.huellaLedger);
  } finally {
    await s.cerrar();
  }
});

test('si la descarga falla, una historia sin filas se queda en su sitio, idéntica, sin copias ni temporales (antes se apartaba antes de descargar)', async () => {
  // Una casi vacía (no pasa la validación) y otra con tablas del libro mayor (se rechaza).
  const casiVacia = await servidorConRelease(40);
  const conLibroMayor = await servidorConRelease(10_500, {}, ['CREATE TABLE watchlist (id INTEGER PRIMARY KEY)']);
  try {
    for (const [nombre, srv] of [['casi-vacia', casiVacia], ['con-libro-mayor', conLibroMayor]] as const) {
      for (const args of [[], ['--force']]) {
        const { dataDir, history, huellaLedger } = instalacion(`falla-${nombre}${args.join('')}`, 0, DEL_DUENO);
        const antes = huellaDe(history);
        const r = await correFetchData(entornoDe(dataDir, srv.puerto), args);
        assert.equal(r.status, 1, `${nombre} ${args}: ${r.stdout}\n${r.stderr}`);
        assert.equal(huellaDe(history), antes, `${nombre} ${args}: history.db en su sitio e idéntica`);
        assert.deepEqual(fs.readdirSync(dataDir).sort(), ['history.db', 'ledger.db'], `${nombre} ${args}: ni copias ni temporales`);
        assert.equal(huellaDe(path.join(dataDir, 'ledger.db')), huellaLedger);
      }
    }
  } finally {
    await casiVacia.cerrar();
    await conLibroMayor.cerrar();
  }
});
