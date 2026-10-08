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
const { partirBase, hayQuePartir } = await import('./split.ts');
const { getDb, setMeta, getMeta, esquemaCompleto, addMissingColumns, MIGRACIONES } = await import('../db.ts');
const { PAPER_TRIGGERS } = await import('../paper/schema.ts');
const { LAYOUT, LEDGER_SCHEMA, HISTORY_DB_PATH, LEDGER_DB_PATH } = await import('./layout.ts');

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
