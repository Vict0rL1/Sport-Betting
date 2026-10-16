// Dos ficheros, reescritura de esquemas, migraciones y la partición sin pérdida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import '../test/setup.ts';

const { ledgerize, masterDe } = await import('./ledgerize.ts');
const { TABLAS_LEDGER, esLedger, claveEsLedger } = await import('./tables.ts');
const { migrar, estadoPorVersion, MigracionFallida } = await import('./migrations.ts');
const { partirBase, hayQuePartir, legadoSinPartir, apartarParaPartir, filasDelLegadoQueFaltan } = await import('./split.ts');
const { getDb, setMeta, getMeta, esquemaCompleto, addMissingColumns, MIGRACIONES } = await import('../db.ts');
const { PAPER_TRIGGERS } = await import('../paper/schema.ts');
const { LAYOUT, LEDGER_SCHEMA, HISTORY_DB_PATH, LEDGER_DB_PATH, apartarConLaterales } = await import('./layout.ts');

test('ledgerize: las tablas del libro mayor, sus índices y sus triggers llevan el prefijo; las demás no; en single es la identidad', () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS fb_matches (id INTEGER);
    CREATE INDEX IF NOT EXISTS idx_fb ON fb_matches (id);
    CREATE TABLE IF NOT EXISTS paper_bets (id INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pb ON paper_bets (id);
    CREATE TRIGGER IF NOT EXISTS paper_bets_no_delete
      BEFORE DELETE ON paper_bets
      BEGIN SELECT RAISE(ABORT, 'no'); END;
    CREATE TRIGGER IF NOT EXISTS fb_algo BEFORE UPDATE ON fb_matches BEGIN SELECT 1; END;`;
  const r = ledgerize(sql, 'ledger');
  assert.match(r, /CREATE TABLE IF NOT EXISTS fb_matches /);
  assert.match(r, /CREATE INDEX IF NOT EXISTS idx_fb ON fb_matches/);
  assert.match(r, /CREATE TABLE IF NOT EXISTS ledger\.paper_bets /);
  assert.match(r, /CREATE UNIQUE INDEX IF NOT EXISTS ledger\.idx_pb ON paper_bets/);
  assert.match(r, /CREATE TRIGGER IF NOT EXISTS ledger\.paper_bets_no_delete\s+BEFORE DELETE ON paper_bets/);
  assert.match(r, /CREATE TRIGGER IF NOT EXISTS fb_algo BEFORE UPDATE ON fb_matches/);
  assert.equal(ledgerize(sql, 'main'), sql);
  assert.equal(ledgerize(r, 'ledger'), r, 'idempotente: no dobla el prefijo');
  assert.equal(masterDe('paper_bets', 'ledger'), 'ledger.sqlite_master');
  assert.equal(masterDe('fb_matches', 'ledger'), 'sqlite_master');
  assert.equal(masterDe('paper_bets', 'main'), 'sqlite_master');
});

test('la app de los tests corre en split: las tablas del libro mayor están en ledger.db y las demás en history.db', () => {
  assert.equal(LAYOUT, 'split');
  const db = getDb();
  const enLedger = new Set((db.prepare("SELECT name FROM ledger.sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  const enMain = new Set((db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  for (const t of ['paper_bets', 'odds_snapshots', 'prediction_log', 'fb_prediction_log', 'bets', 'alerts', 'sessions', 'error_log', 'settings', 'ingestion_runs', 'schema_version']) {
    assert.ok(enLedger.has(t), `${t} en ledger`);
  }
  for (const t of ['fb_matches', 'matches', 'bb_games', 'naf_games', 'meta', 'fb_upcoming', 'schema_version']) assert.ok(enMain.has(t), `${t} en history`);
  for (const t of TABLAS_LEDGER) assert.ok(!enMain.has(t), `${t} NO puede estar también en history (la sombra ganaría)`);
  // Los triggers del libro mayor viven con su tabla.
  const trg = (db.prepare("SELECT name FROM ledger.sqlite_master WHERE type = 'trigger'").all() as { name: string }[]).map((r) => r.name);
  assert.ok(trg.includes('paper_bets_no_delete') && trg.includes('odds_snapshots_no_update') && trg.includes('fb_prediction_log_congelada'));
  assert.ok(fs.existsSync(HISTORY_DB_PATH) && fs.existsSync(LEDGER_DB_PATH));
  // WAL en los dos.
  assert.equal((db.prepare('PRAGMA main.journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
  assert.equal((db.prepare('PRAGMA ledger.journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
});

test('las migraciones quedan registradas en cada fichero, y una fallida impide seguir hasta reintentar', () => {
  const db = getDb();
  const h = estadoPorVersion(db, 'main');
  const l = estadoPorVersion(db, 'ledger');
  for (const m of MIGRACIONES) {
    if (m.destino !== 'ledger') assert.equal(h.get(m.version)?.estado, 'ok', `v${m.version} en history`);
    if (m.destino !== 'history') assert.equal(l.get(m.version)?.estado, 'ok', `v${m.version} en ledger`);
  }
  // Una base aparte, con una migración que explota.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const d = new DatabaseSync(path.join(dir, 'x.db'));
  const lista = [
    { version: 1, nombre: 'ok', destino: 'ambos' as const, up: (x: DatabaseSync) => x.exec('CREATE TABLE a (n)') },
    { version: 2, nombre: 'rota', destino: 'ambos' as const, up: (x: DatabaseSync) => x.exec('INSERT INTO a VALUES (1); CREATE TABLE a (n)') },
    { version: 3, nombre: 'despues', destino: 'ambos' as const, up: (x: DatabaseSync) => x.exec('CREATE TABLE c (n)') },
  ];
  const ctx = { ledger: 'main', fichero: 'history' as const };
  assert.throws(() => migrar(d, 'main', 'history', lista, ctx), MigracionFallida);
  const e = estadoPorVersion(d, 'main');
  assert.equal(e.get(1)?.estado, 'ok');
  assert.equal(e.get(2)?.estado, 'failed');
  assert.equal(e.get(3), undefined, 'la 3 no se intenta');
  assert.equal((d.prepare('SELECT COUNT(*) AS n FROM a').get() as { n: number }).n, 0, 'la 2 se deshizo entera (rollback)');
  // Sin reintentar, vuelve a negarse aunque la causa esté arreglada.
  lista[1].up = (x) => x.exec('INSERT INTO a VALUES (1)');
  assert.throws(() => migrar(d, 'main', 'history', lista, ctx), /falló en history/);
  assert.deepEqual(migrar(d, 'main', 'history', lista, ctx, { reintentar: true }), [2, 3]);
  assert.equal(estadoPorVersion(d, 'main').get(2)?.estado, 'ok');
  d.close();
});

test('meta: las claves de estado van a ledger.settings y las de procedencia a meta', () => {
  assert.equal(claveEsLedger('paper:startedAt'), true);
  assert.equal(claveEsLedger('backup:last_at'), true);
  assert.equal(claveEsLedger('fb_updated_at'), false);
  setMeta('paper:startedAt', '2026-10-01T00:00:00Z');
  setMeta('fb_updated_at', '2026-10-02T00:00:00Z');
  const db = getDb();
  assert.equal((db.prepare("SELECT value FROM ledger.settings WHERE key = 'paper:startedAt'").get() as { value: string }).value, '2026-10-01T00:00:00Z');
  assert.equal(db.prepare("SELECT value FROM main.meta WHERE key = 'paper:startedAt'").get(), undefined);
  assert.equal((db.prepare("SELECT value FROM main.meta WHERE key = 'fb_updated_at'").get() as { value: string }).value, '2026-10-02T00:00:00Z');
  assert.equal(getMeta('paper:startedAt'), '2026-10-01T00:00:00Z');
  assert.equal(getMeta('fb_updated_at'), '2026-10-02T00:00:00Z');
  setMeta('paper:startedAt', 'otra');
  assert.equal(getMeta('paper:startedAt'), 'otra');
});

// LA PARTICIÓN: una base antigua con filas en las dos mitades, partida, no pierde ni una.
test('partirBase: dos copias físicas, cada una con lo suyo, el original apartado, y las claves de estado copiadas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-'));
  const original = path.join(dir, 'tennis.db');
  const old = new DatabaseSync(original);
  old.exec(esquemaCompleto('main')); // el esquema completo, como estaba antes de la fase: todo en main
  addMissingColumns(old);
  old.exec(PAPER_TRIGGERS); // los triggers del banco de papel se crean tras migrar columnas, como en db.ts
  old.exec("INSERT INTO fb_teams (id, league, name) VALUES ('x', 'epl', 'X FC'), ('y', 'epl', 'Y FC')");
  old.exec("INSERT INTO fb_matches (league, season, match_date, home_id, away_id, home_goals, away_goals, result) VALUES ('epl', 2026, '20260901', 'x', 'y', 1, 0, 'H')");
  old.exec("INSERT INTO alerts (created_at, type, severity, title, body) VALUES ('2026-10-01T00:00:00Z', 'x', 'info', 't', 'b'), ('2026-10-02T00:00:00Z', 'y', 'aviso', 't2', 'b2')");
  old.exec("INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status) VALUES ('2026-10-01T00:00:00Z', '2026-10-01', 'tennis', 'A vs B', 'moneyline', 'A', 1.9, 10, 'pending')");
  old.exec("INSERT INTO meta (key, value) VALUES ('paper:startedAt', '2026-09-01T00:00:00Z'), ('fb_updated_at', '2026-10-01T00:00:00Z')");
  old.close();
  const history = path.join(dir, 'history.db');
  const ledger = path.join(dir, 'ledger.db');
  assert.equal(hayQuePartir(original, history, ledger), true);
  const r = partirBase(original, history, ledger, new Date('2026-10-07T00:00:00Z'));
  assert.ok(!fs.existsSync(original), 'el original ya no está con ese nombre');
  assert.ok(fs.existsSync(r.original) && r.original.includes('pre-split-2026-10-07'));
  assert.equal(hayQuePartir(original, history, ledger), false);
  const h = new DatabaseSync(history);
  const l = new DatabaseSync(ledger);
  const tablas = (d: DatabaseSync) => new Set((d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((x) => x.name));
  const th = tablas(h);
  const tl = tablas(l);
  for (const t of TABLAS_LEDGER) {
    assert.ok(!th.has(t), `${t} fuera de history`);
  }
  assert.ok(th.has('fb_matches') && th.has('meta') && !tl.has('fb_matches') && !tl.has('meta'));
  assert.ok(tl.has('alerts') && tl.has('bets') && tl.has('settings'));
  assert.equal((h.prepare('SELECT COUNT(*) AS n FROM fb_matches').get() as { n: number }).n, 1);
  assert.equal((h.prepare('SELECT COUNT(*) AS n FROM fb_teams').get() as { n: number }).n, 2);
  assert.equal((l.prepare('SELECT COUNT(*) AS n FROM alerts').get() as { n: number }).n, 2);
  assert.equal((l.prepare('SELECT COUNT(*) AS n FROM bets').get() as { n: number }).n, 1);
  // Los triggers del libro mayor viajan con sus tablas; los de historia no se cuelan.
  const trgL = (l.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]).map((x) => x.name);
  assert.ok(trgL.includes('alerts_no_delete') && trgL.includes('paper_bets_no_delete'));
  assert.throws(() => l.exec('DELETE FROM alerts'), /no se borra/);
  // Las claves de estado están en settings; la de procedencia se quedó en meta.
  assert.equal((l.prepare("SELECT value FROM settings WHERE key = 'paper:startedAt'").get() as { value: string }).value, '2026-09-01T00:00:00Z');
  assert.equal(l.prepare("SELECT value FROM settings WHERE key = 'fb_updated_at'").get(), undefined);
  assert.equal((h.prepare("SELECT value FROM meta WHERE key = 'fb_updated_at'").get() as { value: string }).value, '2026-10-01T00:00:00Z');
  assert.equal(r.settingsCopiadas, 1);
  // Y el original sigue entero, por si acaso.
  const o = new DatabaseSync(r.original);
  assert.equal((o.prepare('SELECT COUNT(*) AS n FROM alerts').get() as { n: number }).n, 2);
  h.close();
  l.close();
  o.close();
  assert.ok(esLedger('alerts') && !esLedger('fb_matches'));
  assert.equal(LEDGER_SCHEMA, 'ledger');
});

// Revisión de data-guardian a 8522ca1 (C): un tennis.db sin partir JUNTO a history.db o ledger.db
// (una partición que se cortó a medias, o un «LEDGER_NUEVO=si» que empezó otro libro mayor) no lo
// partía nadie y el doctor callaba, porque solo lo miraba sin ninguno de los dos.
test('legadoSinPartir: solo, junto a la base partida, o nada (sin él o con 0 bytes)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legado-'));
  const [original, history, ledger] = ['tennis.db', 'history.db', 'ledger.db'].map((f) => path.join(dir, f));
  assert.equal(legadoSinPartir(original, history, ledger), null);
  fs.writeFileSync(original, '');
  assert.equal(legadoSinPartir(original, history, ledger), null, '0 bytes: nada que partir');
  fs.writeFileSync(original, 'todo dentro');
  assert.equal(legadoSinPartir(original, history, ledger), 'sin-partir');
  fs.writeFileSync(history, 'x');
  assert.equal(legadoSinPartir(original, history, ledger), 'junto');
  fs.writeFileSync(ledger, 'x');
  assert.equal(legadoSinPartir(original, history, ledger), 'junto');
  fs.rmSync(dir, { recursive: true });
});

// Tercera revisión de data-guardian (12 de octubre). Un tennis.db de verdad, con una apuesta.
function legadoConUnaApuesta(dir: string): string {
  const original = path.join(dir, 'tennis.db');
  const old = new DatabaseSync(original);
  old.exec(esquemaCompleto('main'));
  addMissingColumns(old);
  old.exec(PAPER_TRIGGERS);
  old.exec("INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status) VALUES ('2026-10-01T00:00:00Z', '2026-10-01', 'tennis', 'LEGADO', 'moneyline', 'A', 1.9, 10, 'pending')");
  old.close();
  return original;
}

/** El WAL de OTRA base que se cortó (con sus commits sin volcar), dejado en `destino`. */
function walAjeno(dir: string, destino: string): void {
  const f = path.join(dir, `ajena-${Math.random().toString(36).slice(2)}.db`);
  const d = new DatabaseSync(f);
  d.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
  d.exec("CREATE TABLE marca (v TEXT); INSERT INTO marca VALUES ('AJENA')");
  fs.writeFileSync(destino, fs.readFileSync(`${f}-wal`));
  d.close();
}

test('partirBase: un WAL huérfano junto a donde va ledger.db se aparta; SQLite no lo aplica encima del libro partido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'split-wal-'));
  const original = legadoConUnaApuesta(dir);
  const [history, ledger] = [path.join(dir, 'history.db'), path.join(dir, 'ledger.db')];
  walAjeno(dir, `${ledger}-wal`);
  walAjeno(dir, `${history}-wal`);
  partirBase(original, history, ledger);
  const l = new DatabaseSync(ledger, { readOnly: true });
  assert.equal((l.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  assert.equal((l.prepare("SELECT COUNT(*) AS n FROM bets WHERE event = 'LEGADO'").get() as { n: number }).n, 1, 'la apuesta del legado está');
  assert.equal(l.prepare("SELECT name FROM sqlite_master WHERE name = 'marca'").get(), undefined, 'nada de la base ajena');
  l.close();
  const apartados = fs.readdirSync(dir).filter((f) => /-wal\.huerfano-/.test(f)).sort();
  assert.deepEqual(apartados.map((f) => f.replace(/huerfano-.*/, 'huerfano')), ['history.db-wal.huerfano', 'ledger.db-wal.huerfano']);
  fs.rmSync(dir, { recursive: true });
});

test('apartarParaPartir: aparta history.db CON su WAL (emparejados) y un ledger.db vacío; después se puede partir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partir-legado-'));
  const original = legadoConUnaApuesta(dir);
  const [history, ledger] = [path.join(dir, 'history.db'), path.join(dir, 'ledger.db')];
  const h = new DatabaseSync(history);
  h.exec('PRAGMA journal_mode = WAL; CREATE TABLE fb_matches (id INTEGER)');
  h.close();
  fs.writeFileSync(ledger, '');
  walAjeno(dir, `${ledger}-wal`);
  const ahora = new Date('2026-10-12T10:00:00Z');
  const apartados = apartarParaPartir(original, history, ledger, ahora);
  assert.equal(fs.existsSync(history) || fs.existsSync(ledger) || fs.existsSync(`${ledger}-wal`), false);
  assert.ok(apartados.some((f) => f.endsWith('history.db.aparte-2026-10-12T10-00-00')), apartados.join(', '));
  assert.ok(apartados.some((f) => /ledger\.db\.vacio-/.test(f)) && apartados.some((f) => /ledger\.db-wal\.huerfano-/.test(f)));
  assert.equal(hayQuePartir(original, history, ledger), true);
  partirBase(original, history, ledger);
  const l = new DatabaseSync(ledger, { readOnly: true });
  assert.equal((l.prepare("SELECT COUNT(*) AS n FROM bets WHERE event = 'LEGADO'").get() as { n: number }).n, 1);
  l.close();
  fs.rmSync(dir, { recursive: true });
});

test('apartarParaPartir se niega: sin tennis.db con datos, con un ledger.db con datos, o con history.db abierto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partir-no-'));
  const [original, history, ledger] = ['tennis.db', 'history.db', 'ledger.db'].map((f) => path.join(dir, f));
  assert.throws(() => apartarParaPartir(original, history, ledger), /tennis\.db/);
  legadoConUnaApuesta(dir);
  fs.writeFileSync(ledger, 'apuestas');
  assert.throws(() => apartarParaPartir(original, history, ledger), /ledger\.db.*datos/);
  assert.equal(fs.readFileSync(ledger, 'utf8'), 'apuestas', 'no se ha movido');
  fs.rmSync(ledger);
  const abierta = new DatabaseSync(history);
  abierta.exec('PRAGMA journal_mode = WAL; CREATE TABLE x (n)'); // como la app: en WAL, una conexión ociosa también se ve
  try {
    assert.throws(() => apartarParaPartir(original, history, ledger), /abiert/);
    assert.equal(fs.existsSync(history), true, 'no se ha movido');
  } finally {
    abierta.close();
  }
  fs.rmSync(dir, { recursive: true });
});

test('filasDelLegadoQueFaltan: 0 si ledger.db salió de ese tennis.db; las que solo están en tennis.db, si no', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comparar-'));
  const original = legadoConUnaApuesta(dir);
  const [history, ledger] = [path.join(dir, 'history.db'), path.join(dir, 'ledger.db')];
  const r = partirBase(original, history, ledger);
  fs.copyFileSync(r.original, original); // la partición se cortó antes de apartar el original
  const faltan = (t: string) => filasDelLegadoQueFaltan(original, ledger).find((x) => x.tabla === t)?.faltan;
  assert.equal(faltan('bets'), 0);
  assert.equal(faltan('paper_bets'), 0);
  const o = new DatabaseSync(original);
  o.exec("INSERT INTO bets (created_at, placed_on, sport, event, market, selection, odds, stake, status) VALUES ('2026-10-02T00:00:00Z', '2026-10-02', 'tennis', 'SOLO EN EL LEGADO', 'moneyline', 'B', 2.1, 5, 'pending')");
  o.close();
  assert.equal(faltan('bets'), 1);
  // Lo que no se puede leer no es 0: es DESCONOCIDO.
  assert.equal(filasDelLegadoQueFaltan(path.join(dir, 'no-existe.db'), ledger).every((x) => x.faltan === null), true);
  fs.rmSync(dir, { recursive: true });
});

test('hayQuePartir: un tennis.db de 0 bytes no se parte solo (abrirlo le borraría el WAL, si tiene)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partir-vacio-'));
  const [original, history, ledger] = ['tennis.db', 'history.db', 'ledger.db'].map((f) => path.join(dir, f));
  fs.writeFileSync(original, '');
  fs.writeFileSync(`${original}-wal`, 'commits sin volcar');
  assert.equal(hayQuePartir(original, history, ledger), false);
  fs.rmSync(dir, { recursive: true });
});

// Cuarta revisión de data-guardian: «ledger.db ya tiene todo» miraba 3 tablas de ~30. Un tennis.db
// con solo un registro de fútbol o un precio observado pasaba por vacío, y el doctor acababa
// diciendo que se podía borrar.
test('filasDelLegadoQueFaltan mira todas las tablas del libro mayor, también las que ledger.db no tiene', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comparar-todo-'));
  const original = legadoConUnaApuesta(dir);
  const [history, ledger] = [path.join(dir, 'history.db'), path.join(dir, 'ledger.db')];
  const r = partirBase(original, history, ledger);
  fs.copyFileSync(r.original, original);
  const o = new DatabaseSync(original);
  o.exec("INSERT INTO alerts (created_at, type, severity, title, body) VALUES ('2026-10-02T00:00:00Z', 'x', 'info', 'SOLO EN EL LEGADO', 'b')");
  o.close();
  const faltan = (t: string) => filasDelLegadoQueFaltan(original, ledger).find((x) => x.tabla === t)?.faltan;
  assert.equal(faltan('alerts'), 1, 'una alerta que solo está en tennis.db');
  assert.equal(faltan('bets'), 0);
  // Una tabla que ledger.db no tiene: todas sus filas faltan (no «no se sabe», no 0).
  const l = new DatabaseSync(ledger);
  l.exec('DROP TABLE alerts');
  l.close();
  assert.equal(faltan('alerts'), 1);
  // Las de operación (sesiones, errores, ejecuciones) no son el libro mayor de nadie.
  assert.equal(filasDelLegadoQueFaltan(original, ledger).some((x) => ['sessions', 'error_log', 'ingestion_runs', 'scheduler_jobs', 'notification_log'].includes(x.tabla)), false);
  fs.rmSync(dir, { recursive: true });
});

test('filasDelLegadoQueFaltan no abre un ledger.db de 0 bytes (SQLite le borraría el WAL): DESCONOCIDO', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comparar-vacio-'));
  const original = legadoConUnaApuesta(dir);
  const ledger = path.join(dir, 'ledger.db');
  fs.writeFileSync(ledger, '');
  fs.writeFileSync(`${ledger}-wal`, 'commits sin volcar');
  const r = filasDelLegadoQueFaltan(original, ledger);
  assert.ok(r.length > 0 && r.every((x) => x.faltan === null));
  assert.equal(fs.readFileSync(`${ledger}-wal`, 'utf8'), 'commits sin volcar');
  fs.rmSync(dir, { recursive: true });
});

test('apartarParaPartir no mueve nada si tennis.db no es una base íntegra', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'partir-roto-'));
  const [original, history, ledger] = ['tennis.db', 'history.db', 'ledger.db'].map((f) => path.join(dir, f));
  fs.writeFileSync(original, 'no soy una base');
  const h = new DatabaseSync(history);
  h.exec('CREATE TABLE fb_matches (id INTEGER)');
  h.close();
  assert.throws(() => apartarParaPartir(original, history, ledger), /tennis\.db/);
  assert.equal(fs.existsSync(history), true, 'history.db sigue en su sitio');
  fs.rmSync(dir, { recursive: true });
});

test('apartarConLaterales: el WAL y el SHM van con su base, con el mismo nombre nuevo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aparte-'));
  const f = path.join(dir, 'history.db');
  fs.writeFileSync(f, 'base');
  fs.writeFileSync(`${f}-wal`, 'wal');
  fs.writeFileSync(`${f}-shm`, 'shm');
  const r = apartarConLaterales(f, 'aparte', new Date('2026-10-12T10:00:00Z'));
  const base = 'history.db.aparte-2026-10-12T10-00-00';
  assert.deepEqual(r.map((x) => path.basename(x)), [base, `${base}-wal`, `${base}-shm`]);
  assert.deepEqual(r.map((x) => fs.readFileSync(x, 'utf8')), ['base', 'wal', 'shm']);
  assert.equal([f, `${f}-wal`, `${f}-shm`].some((x) => fs.existsSync(x)), false);
  fs.rmSync(dir, { recursive: true });
});

// Revisión de data-guardian al lote H: la migración 22 no tenía prueba del camino ALTER (las bases
// de los tests nacen ya con la columna).
test('migración 22: añade sessions.huella a una tabla de antes, en main y en un ledger adjunto, sin tocar filas; dos veces no hace nada', () => {
  const m = MIGRACIONES.find((x) => x.version === 22)!;
  const vieja = (esquema: string) =>
    `CREATE TABLE ${esquema}sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, user_agent TEXT, ip TEXT);
     INSERT INTO ${esquema}sessions (token_hash, created_at, last_seen_at, expires_at) VALUES ('h', 'a', 'b', 'c');`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migracion-22-'));
  const comprobar = (d: DatabaseSync, esquema: string) => {
    const cols = (d.prepare(`PRAGMA ${esquema}table_info(sessions)`).all() as { name: string }[]).map((c) => c.name);
    assert.ok(cols.includes('huella'), cols.join(','));
    assert.deepEqual(d.prepare(`SELECT token_hash, huella FROM ${esquema}sessions`).all().map((r) => ({ ...r })), [{ token_hash: 'h', huella: null }]);
  };
  const single = new DatabaseSync(path.join(dir, 'tennis.db'));
  single.exec(vieja(''));
  for (let i = 0; i < 2; i++) m.up(single, { ledger: 'main', fichero: 'ledger' } as Parameters<typeof m.up>[1]);
  comprobar(single, '');
  single.close();
  const split = new DatabaseSync(path.join(dir, 'history.db'));
  split.exec(`ATTACH '${path.join(dir, 'ledger.db')}' AS ledger`);
  split.exec(vieja('ledger.'));
  for (let i = 0; i < 2; i++) m.up(split, { ledger: 'ledger', fichero: 'ledger' } as Parameters<typeof m.up>[1]);
  comprobar(split, 'ledger.');
  assert.equal(split.prepare("SELECT name FROM main.sqlite_master WHERE name = 'sessions'").get(), undefined, 'nada en history.db');
  split.close();
  fs.rmSync(dir, { recursive: true });
});
