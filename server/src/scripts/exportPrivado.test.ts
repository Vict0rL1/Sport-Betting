// Auditoría paralela del 3 de noviembre: la migración 27 lleva `ajustes.usuario` y
// `features.anulaciones` al libro mayor y deja su copia en `main.meta` para recuperarlas si se
// restaura un libro mayor de antes. El exportador real (`db:export-history`) copiaba esa meta tal
// cual y decía que la exportación estaba limpia, y `check-publishable` solo miraba tablas: el banco
// personal del dueño podía acabar en la release pública.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
