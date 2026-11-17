// Auditoría paralela del 3 de noviembre: la migración 27 lleva `ajustes.usuario` y
// `features.anulaciones` al libro mayor y deja su copia en `main.meta` para recuperarlas si se
// restaura un libro mayor de antes. El exportador real (`db:export-history`) copiaba esa meta tal
// cual y decía que la exportación estaba limpia, y `check-publishable` solo miraba tablas: el banco
// personal del dueño podía acabar en la release pública.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import '../test/setup.ts';

const { getDb, cerrarDb, MIGRACIONES } = await import('../db.ts');
const { LEDGER_SCHEMA, ficherosDe } = await import('../db/layout.ts');
const { claveEsLedger } = await import('../db/tables.ts');

const SERVIDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAIZ = path.resolve(SERVIDOR, '..');
const NODE_OPTIONS = '--experimental-sqlite --disable-warning=ExperimentalWarning';

/** Lo que pide check-publishable para no tomar la base por vacía. */
const MINIMOS: [string, number][] = [
  ['matches', 10_000],
  ['fb_matches', 10_000],
  ['naf_games', 5_000],
  ['player_ratings', 500],
  ['fb_team_ratings', 100],
];

/** Filas de relleno que cumplen el esquema real (NOT NULL, claves únicas), sin inventar nada que se lea. */
function rellenar(db: DatabaseSync, tabla: string, n: number): void {
  const cols = (db.prepare(`PRAGMA main.table_info(${tabla})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[]).filter(
    (c) => !(c.pk === 1 && /INT/i.test(c.type)) && (c.notnull === 1 || c.pk > 0) && c.dflt_value === null,
  );
  const valor = (t: string) => (/INT/i.test(t) ? 'i' : /REAL|NUM|FLOA|DOUB/i.test(t) ? 'i * 1.0' : "'relleno-' || i");
  db.exec(
    `INSERT INTO main.${tabla} (${cols.map((c) => `"${c.name}"`).join(', ')})
     WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n})
     SELECT ${cols.map((c) => valor(c.type)).join(', ')} FROM n`,
  );
}

/**
 * Huella de un fichero de la base. Solo con la conexión de este proceso CERRADA (revisión data-guardian
 * del 3 de noviembre): leer con fs el fichero de una base que este proceso tiene abierta suelta sus
 * bloqueos POSIX; el siguiente hijo que cierra se cree la última conexión, hace checkpoint y borra el
 * WAL que esta conexión sigue usando, y los hijos de después ya no ven lo que escribe.
 */
const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const correr = (script: string, args: string[], cwd: string) =>
  spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { cwd, env: { ...process.env, NODE_OPTIONS }, encoding: 'utf8', timeout: 120_000 });

test('migración 27 y exportación real: la exportación no lleva la meta privada (ni sus bytes), la original la conserva sin cambiar, y check-publishable rechaza la original y acepta la exportada', () => {
  const db = getDb();
  for (const [t, n] of MINIMOS) rellenar(db, t, n);
  // Como la dejaba una instalación de antes de la migración 27: lo del dueño en la meta de la
  // historia, y una clave de estado con prefijo del libro mayor de una base anterior a partirla.
  const meta = db.prepare('INSERT OR REPLACE INTO main.meta (key, value) VALUES (?, ?)');
  meta.run('ajustes.usuario', JSON.stringify({ bancoPersonal: 7531.25, idioma: 'es' }));
  meta.run('features.anulaciones', JSON.stringify({ 'estrategias.laboratorio': false }));
  meta.run('telegram:chat_id', 'chat-privado-424242');
  meta.run('fb_updated_at', '2026-11-01T00:00:00Z');
  const m27 = MIGRACIONES.find((x) => x.nombre === 'ajustes-al-ledger');
  assert.ok(m27);
  m27!.up(db, { ledger: LEDGER_SCHEMA, fichero: 'ledger' });
  const settings = `${LEDGER_SCHEMA === 'main' ? '' : `${LEDGER_SCHEMA}.`}settings`;
  assert.match((db.prepare(`SELECT value FROM ${settings} WHERE key = 'ajustes.usuario'`).get() as { value: string }).value, /7531\.25/, 'la migración la llevó al libro mayor');

  // La original, antes de exportar: lo que tiene que seguir igual.
  const historia = ficherosDe().history;
  const filasMeta = () => getDb().prepare('SELECT key, value FROM main.meta ORDER BY key').all();
  const metaAntes = filasMeta();
  cerrarDb();
  const huellaAntes = sha(historia);

  const destino = path.join(fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'export-')), 'history.export.db');
  const r = correr('src/scripts/dbExport.ts', [destino], SERVIDOR);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.doesNotMatch(r.stdout + r.stderr, /7531|chat-privado/, 'el informe no enseña los valores');

  // La exportación: sin las claves del libro mayor, con la procedencia, y sin sus bytes.
  const exp = new DatabaseSync(destino, { readOnly: true });
  const claves = (exp.prepare('SELECT key FROM meta').all() as { key: string }[]).map((x) => x.key);
  assert.deepEqual(claves.filter(claveEsLedger), [], 'ninguna clave del libro mayor');
  assert.ok(claves.includes('fb_updated_at'), 'la procedencia de los datos sí');
  assert.equal((exp.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  exp.close();
  const bytes = fs.readFileSync(destino);
  for (const s of ['7531.25', 'chat-privado-424242', 'ajustes.usuario', 'features.anulaciones']) assert.equal(bytes.includes(Buffer.from(s)), false, `«${s}» no está en el fichero exportado, ni borrado`);
  assert.match(r.stdout, /3 clave\(s\) privada\(s\) de meta fuera/, 'y el informe lo dice');
  // Se construye aparte y se renombra al final (revisión data-guardian): ningún temporal se queda.
  assert.deepEqual(fs.readdirSync(path.dirname(destino)), ['history.export.db'], 'ni temporales ni ficheros laterales');

  // La original no cambia: ni un byte del fichero (aún sin conexión aquí) ni su meta (la copia de
  // recuperación sigue).
  assert.equal(sha(historia), huellaAntes, 'ni un byte de la base original');
  assert.deepEqual(filasMeta(), metaAntes);

  // check-publishable: la original (con la copia de recuperación) no se publica; la exportada, sí.
  const original = correr('scripts/check-publishable.mjs', [historia], RAIZ);
  assert.equal(original.status, 1, original.stdout);
  assert.match(original.stdout, /\[privacidad\].*ajustes\.usuario/);
  assert.match(original.stdout, /\[privacidad\].*telegram:chat_id/);
  assert.doesNotMatch(original.stdout, /7531|chat-privado/, 'sin enseñar los valores');
  const exportada = correr('scripts/check-publishable.mjs', [destino], RAIZ);
  assert.equal(exportada.status, 0, exportada.stdout);
  assert.match(exportada.stdout, /Publicable/);
});

/** Una base de historia mínima que pasa los mínimos de check-publishable, con la meta que se le dé. */
function historiaSintetica(meta: Record<string, string>): string {
  const f = path.join(fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'publicable-')), 'history.db');
  const d = new DatabaseSync(f);
  d.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  for (const [t, n] of MINIMOS) {
    d.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY)`);
    d.exec(`INSERT INTO ${t} (id) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${n}) SELECT i FROM n`);
  }
  const ins = d.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(meta)) ins.run(k, v);
  d.close();
  return f;
}

test('check-publishable rechaza cualquier clave de meta del libro mayor (nombres y prefijos) sin enseñar su valor, y acepta la misma base sin ellas', () => {
  const limpia = correr('scripts/check-publishable.mjs', [historiaSintetica({ fb_updated_at: '2026-11-01' })], RAIZ);
  assert.equal(limpia.status, 0, limpia.stdout);
  for (const clave of ['ajustes.usuario', 'features.anulaciones', 'paper:startedAt', 'backup:last_at', 'policy:x', 'telegram:chat_id', 'scheduler:x', 'retention:x']) {
    const r = correr('scripts/check-publishable.mjs', [historiaSintetica({ fb_updated_at: '2026-11-01', [clave]: 'valor-secreto-123' })], RAIZ);
    assert.equal(r.status, 1, `${clave}: ${r.stdout}`);
    assert.match(r.stdout, new RegExp(`\\[privacidad\\][^\\n]*${clave.replace(/[.:]/g, '\\$&')}`), clave);
    assert.doesNotMatch(r.stdout, /valor-secreto-123/, `${clave}: sin el valor`);
  }
});

test('check-publishable rechaza un fichero con restos de una clave privada borrada sin VACUUM (la meta viva ya no la tiene, sus bytes sí)', () => {
  const f = historiaSintetica({ fb_updated_at: '2026-11-01', 'ajustes.usuario': '{"bancoPersonal":8642}' });
  const d = new DatabaseSync(f);
  d.exec('PRAGMA secure_delete = OFF');
  d.exec("DELETE FROM meta WHERE key = 'ajustes.usuario'");
  d.close();
  assert.ok(fs.readFileSync(f).includes(Buffer.from('ajustes.usuario')), 'el borrado sin VACUUM deja los bytes (lo que se quiere detectar)');
  const r = correr('scripts/check-publishable.mjs', [f], RAIZ);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /\[privacidad\][^\n]*restos[^\n]*ajustes\.usuario/);
  assert.doesNotMatch(r.stdout, /8642/);
});

test('el exportador no pisa la base viva, el libro mayor, sus laterales ni una base con tablas del libro mayor (revisión data-guardian)', () => {
  const { history, ledger: libroMayor } = ficherosDe();
  assert.ok(libroMayor, 'las pruebas corren con la base partida');
  const ledger = libroMayor!;
  // Sin conexión en este proceso mientras se miran los ficheros con fs (ver `sha`).
  cerrarDb();
  // El fichero y su WAL (el -shm es el índice compartido: cambia con cualquier lectura).
  const huellas = () => Object.fromEntries([history, ledger].flatMap((f) => ['', '-wal'].map((s) => f + s)).filter((f) => fs.existsSync(f)).map((f) => [f, sha(f)]));
  const ajena = path.join(fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'ajena-')), 'copia-ledger.db');
  const a = new DatabaseSync(ajena);
  a.exec('CREATE TABLE paper_bets (id INTEGER PRIMARY KEY); INSERT INTO paper_bets VALUES (1)');
  a.close();
  const texto = path.join(path.dirname(ajena), 'notas.txt');
  fs.writeFileSync(texto, 'no es una base');
  const antes = huellas();
  for (const destino of [ledger, history, `${ledger}-wal`, ajena, texto]) {
    const r = correr('src/scripts/dbExport.ts', [destino], SERVIDOR);
    assert.equal(r.status, 1, `${destino}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no se exporta encima/i);
  }
  assert.deepEqual(huellas(), antes, 'ni la historia ni el libro mayor cambian');
  assert.equal(fs.readFileSync(texto, 'utf8'), 'no es una base');
  const b = new DatabaseSync(ajena, { readOnly: true });
  assert.equal((b.prepare('SELECT COUNT(*) n FROM paper_bets').get() as { n: number }).n, 1);
  b.close();
  // Una exportación anterior sí se reemplaza.
  const previa = path.join(fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'previa-')), 'history.export.db');
  assert.equal(correr('src/scripts/dbExport.ts', [previa], SERVIDOR).status, 0);
  assert.equal(correr('src/scripts/dbExport.ts', [previa], SERVIDOR).status, 0, 'la segunda vez, encima de la primera');
});

test('si la exportación falla a medias, no queda ningún temporal con la meta privada (revisión security y data-guardian)', () => {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO main.meta (key, value) VALUES (?, ?)').run('ajustes.usuario', JSON.stringify({ bancoPersonal: 7531.25 }));
  // Un fallo después de copiar: el DELETE de la copia lo rechaza un trigger que viaja con ella.
  db.exec("CREATE TRIGGER main.prueba_falla BEFORE DELETE ON meta BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END");
  try {
    const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'falla-'));
    const r = correr('src/scripts/dbExport.ts', [path.join(dir, 'history.export.db')], SERVIDOR);
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /fallo simulado/, 'falla donde se quiere: al limpiar la copia');
    assert.deepEqual(fs.readdirSync(dir), [], 'ni .parcial ni .limpia ni el destino');
  } finally {
    db.exec('DROP TRIGGER main.prueba_falla');
  }
});

test('check-publishable rechaza una base con un -wal con cambios: se publica el fichero, no lo que se comprobó (revisión data-guardian)', () => {
  const f = historiaSintetica({ fb_updated_at: '2026-11-01' });
  const d = new DatabaseSync(f);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
  d.exec("INSERT INTO meta (key, value) VALUES ('fb_otra', 'x')");
  try {
    assert.ok(fs.statSync(`${f}-wal`).size > 0, 'cambios en el -wal, sin pasar al fichero');
    const r = correr('scripts/check-publishable.mjs', [f], RAIZ);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /\[integridad\][^\n]*-wal/);
  } finally {
    d.close();
  }
  // Cerrada (el checkpoint pasa todo al fichero y el -wal desaparece), se puede publicar.
  assert.equal(correr('scripts/check-publishable.mjs', [f], RAIZ).status, 0);
});

// ---- Auditoría del 5 de noviembre: el exportador borraba ficheros que no eran suyos ----
// Los temporales tenían nombre fijo (`<destino>.parcial`, `<destino>.limpia`) y se borraban, con sus
// laterales, al empezar y al terminar: una base ajena con ese nombre desaparecía sin aviso, y dos
// exportaciones a la vez compartían los mismos temporales.

/** Ficheros con los nombres de antes junto al destino: una base con una apuesta, su WAL y un texto. */
function senuelos(dir: string): Record<string, string> {
  const destino = path.join(dir, 'history.export.db');
  const parcial = `${destino}.parcial`;
  const d = new DatabaseSync(parcial);
  d.exec("CREATE TABLE paper_bets (id INTEGER PRIMARY KEY, nota TEXT); INSERT INTO paper_bets (nota) VALUES ('apuesta de otra base')");
  d.close();
  fs.writeFileSync(`${parcial}-wal`, 'wal ajeno');
  fs.writeFileSync(`${destino}.limpia`, 'notas de otra persona');
  fs.writeFileSync(`${destino}.limpia-journal`, 'diario ajeno');
  return Object.fromEntries([parcial, `${parcial}-wal`, `${destino}.limpia`, `${destino}.limpia-journal`].map((f) => [f, sha(f)]));
}
const siguenIgual = (huellas: Record<string, string>) => {
  for (const [f, h] of Object.entries(huellas)) {
    assert.ok(fs.existsSync(f), `${path.basename(f)} sigue ahí`);
    assert.equal(sha(f), h, `${path.basename(f)} sin cambiar`);
  }
};

test('los ficheros ajenos con los nombres de los temporales de antes sobreviven a una exportación que sale bien, y no queda ningún temporal propio', () => {
  const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'senuelos-ok-'));
  const huellas = senuelos(dir);
  const r = correr('src/scripts/dbExport.ts', [path.join(dir, 'history.export.db')], SERVIDOR);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  siguenIgual(huellas);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['history.export.db', ...Object.keys(huellas).map((f) => path.basename(f))].sort(), 'ni temporales ni restos propios');
  // (Después de listar: abrirla aquí crea su -shm, por el -wal de mentira que tiene al lado.)
  const b = new DatabaseSync(path.join(dir, 'history.export.db.parcial'), { readOnly: true });
  assert.equal((b.prepare('SELECT COUNT(*) n FROM paper_bets').get() as { n: number }).n, 1, 'la base ajena, con su apuesta');
  b.close();
});

test('y a una exportación que falla a medias: se borra solo lo que creó esa exportación', () => {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO main.meta (key, value) VALUES (?, ?)').run('ajustes.usuario', JSON.stringify({ bancoPersonal: 7531.25 }));
  db.exec("CREATE TRIGGER main.prueba_falla_senuelos BEFORE DELETE ON meta BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END");
  try {
    const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'senuelos-falla-'));
    const huellas = senuelos(dir);
    const r = correr('src/scripts/dbExport.ts', [path.join(dir, 'history.export.db')], SERVIDOR);
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /fallo simulado/);
    siguenIgual(huellas);
    assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(huellas).map((f) => path.basename(f)).sort(), 'ni destino ni temporales propios');
  } finally {
    db.exec('DROP TRIGGER main.prueba_falla_senuelos');
  }
});

function correrAsync(script: string, args: string[], cwd: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((ok, mal) => {
    const h = spawn(process.execPath, ['--import', 'tsx', script, ...args], { cwd, env: { ...process.env, NODE_OPTIONS }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    h.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    h.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    h.on('error', mal);
    h.on('close', (status) => ok({ status, stdout, stderr }));
  });
}

test('exportaciones a la vez (al mismo destino y a otro del mismo directorio): ninguna borra ni usa los temporales de otra; cada destino queda completo y limpio', async () => {
  // La base de origen ya existe y está migrada, como en cualquier exportación de verdad (abrirla por
  // primera vez desde cuatro procesos a la vez corre las migraciones a la vez: eso es de getDb, aparte).
  getDb();
  const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'a-la-vez-'));
  const huellas = senuelos(dir);
  const mismo = path.join(dir, 'history.export.db');
  const otro = path.join(dir, 'otra.export.db');
  const destinos = [mismo, mismo, otro, mismo];
  const rs = await Promise.all(destinos.map((d) => correrAsync('src/scripts/dbExport.ts', [d], SERVIDOR)));
  // Cada una sale bien o se niega limpia: lo que no puede pasar es que borre o use lo de otra. Al mismo
  // destino, la sonda de una puede ver un instante abierta la base que comprueba la otra, o SQLite
  // contestar «locked» al abrir (revisión data-guardian: ~1 de cada 90 rondas); las dos se niegan sin
  // dejar nada.
  for (const r of rs) if (r.status !== 0) assert.match(r.stderr, /abierta por otro proceso|database is locked/, r.stderr || r.stdout);
  for (const d of [mismo, otro]) assert.ok(rs.some((r, i) => destinos[i] === d && r.status === 0), `${path.basename(d)}: al menos una sale bien`);
  siguenIgual(huellas);
  for (const f of [mismo, otro]) {
    const e = new DatabaseSync(f, { readOnly: true });
    assert.equal((e.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok', path.basename(f));
    assert.deepEqual((e.prepare('SELECT key FROM meta').all() as { key: string }[]).map((x) => x.key).filter(claveEsLedger), [], `${path.basename(f)}: sin meta privada`);
    e.close();
    assert.equal(fs.readFileSync(f).includes(Buffer.from('ajustes.usuario')), false, `${path.basename(f)}: ni sus bytes`);
  }
  assert.deepEqual(fs.readdirSync(dir).sort(), ['history.export.db', 'otra.export.db', ...Object.keys(huellas).map((f) => path.basename(f))].sort(), 'ni temporales ni laterales');
});

// ---- Revisión data-guardian (5 de noviembre) del exportador ----

test('el destino se resuelve desde donde se llamó a npm (INIT_CWD), no desde server/', () => {
  const raizNpm = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'init-cwd-'));
  fs.mkdirSync(path.join(raizNpm, 'data'));
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/scripts/dbExport.ts', 'data/history.export.db'], { cwd: SERVIDOR, env: { ...process.env, NODE_OPTIONS, INIT_CWD: raizNpm }, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(fs.existsSync(path.join(raizNpm, 'data', 'history.export.db')), 'en <INIT_CWD>/data, como lo escribe el workflow');
  assert.equal(fs.existsSync(path.join(SERVIDOR, 'data', 'history.export.db')), false, 'no en server/data');
});

test('no exporta encima de un destino vacío o ausente con un -wal o -journal al lado, de una base abierta, de una con meta privada ni de una copia con fecha', () => {
  const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'destinos-raros-'));
  // Una copia de carpeta con el libro mayor a 0 bytes y sus apuestas solo en el -wal.
  const ledger0 = path.join(dir, 'ledger.db');
  fs.writeFileSync(ledger0, '');
  fs.writeFileSync(`${ledger0}-wal`, 'cinco apuestas en el WAL');
  const huerfano = path.join(dir, 'sin-fichero.db');
  fs.writeFileSync(`${huerfano}-journal`, 'diario de otra base');
  const conMeta = path.join(dir, 'con-meta.db');
  const c = new DatabaseSync(conMeta);
  c.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('ajustes.usuario', '{"bancoPersonal":1}')`);
  c.close();
  const copiaFecha = path.join(dir, 'history.db.backup-2026-11-05T10-00-00');
  const b = new DatabaseSync(copiaFecha);
  b.exec('CREATE TABLE fb_odds_history (id INTEGER PRIMARY KEY); INSERT INTO fb_odds_history VALUES (1)');
  b.close();
  const abierta = path.join(dir, 'abierta.export.db');
  const a = new DatabaseSync(abierta);
  // Abierta, con su -wal vacío (pasado al fichero): lo que la delata es la conexión, no el WAL.
  a.exec('PRAGMA journal_mode = WAL; CREATE TABLE x (y); INSERT INTO x VALUES (1); PRAGMA wal_checkpoint(TRUNCATE);');
  try {
    const casos: [string, RegExp][] = [
      [ledger0, /-wal|vac/],
      [huerfano, /-journal/],
      [conMeta, /meta privada/],
      [copiaFecha, /copia/],
      [abierta, /abierta por otro proceso/],
    ];
    const huellas = Object.fromEntries([ledger0, `${ledger0}-wal`, `${huerfano}-journal`, conMeta, copiaFecha].map((f) => [f, sha(f)]));
    for (const [destino, motivo] of casos) {
      const r = correr('src/scripts/dbExport.ts', [destino], SERVIDOR);
      assert.equal(r.status, 1, `${path.basename(destino)}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, motivo, path.basename(destino));
    }
    for (const [f, h] of Object.entries(huellas)) assert.equal(sha(f), h, `${path.basename(f)} sin cambiar`);
    assert.equal(fs.existsSync(huerfano), false);
  } finally {
    a.close();
  }
});

test('los restos de una exportación que murió en esta máquina (su proceso ya no existe) se borran; los de otra en marcha o sin dueño claro, no', () => {
  const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'restos-'));
  const destino = path.join(dir, 'history.export.db');
  const muerta = path.join(dir, 'history.export.db.tmp-muerta');
  fs.mkdirSync(muerta);
  fs.writeFileSync(path.join(muerta, 'parcial.db'), 'meta privada de una exportación interrumpida');
  // Un pid que no existe (el más alto posible no se reparte en la práctica), de hace más de una hora.
  fs.writeFileSync(path.join(muerta, 'propietario.json'), JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), inicio: '2026-11-05T10:00:00.000Z' }));
  const viva = path.join(dir, 'history.export.db.tmp-viva');
  fs.mkdirSync(viva);
  fs.writeFileSync(path.join(viva, 'propietario.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), inicio: new Date().toISOString() }));
  const otraMaquina = path.join(dir, 'history.export.db.tmp-otra');
  fs.mkdirSync(otraMaquina);
  fs.writeFileSync(path.join(otraMaquina, 'propietario.json'), JSON.stringify({ pid: 2 ** 22 + 12345, host: 'otra-maquina', inicio: '2026-11-05T10:00:00.000Z' }));
  const sinDueno = path.join(dir, 'history.export.db.tmp-sin-dueno');
  fs.mkdirSync(sinDueno);
  // De esta máquina y con el proceso muerto, pero de hace un momento: podría ser de otro contenedor.
  const reciente = path.join(dir, 'history.export.db.tmp-reciente');
  fs.mkdirSync(reciente);
  fs.writeFileSync(path.join(reciente, 'propietario.json'), JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), inicio: new Date().toISOString() }));
  const r = correr('src/scripts/dbExport.ts', [destino], SERVIDOR);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(fs.existsSync(muerta), false, 'la de un proceso muerto de esta máquina, borrada');
  for (const d of [viva, otraMaquina, sinDueno, reciente]) assert.ok(fs.existsSync(d), `${path.basename(d)}: no se toca`);
  assert.match(r.stdout + r.stderr, /tmp-viva|tmp-otra|tmp-sin-dueno/);
});
