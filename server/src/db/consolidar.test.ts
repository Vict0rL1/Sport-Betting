// Copias de carpeta con WAL (auditoría del 17 de octubre, punto 1): restaurar solo ledger.db
// perdía 133 filas que vivían en ledger.db-wal. Aquí, la misma situación en pequeño.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import '../test/setup.ts';

const { consolidarCopia, sha256DeFichero } = await import('./consolidar.ts');
const { manifiestoDeFichero, compararManifiestos } = await import('./manifiesto.ts');
const { verificarRestauracion } = await import('./backup.ts');

/**
 * Una carpeta como la que deja copiar `data/` con la app en marcha: 5 predicciones ya volcadas al
 * fichero principal y 3 más que solo están en el -wal. Se copia con el escritor aún abierto: al
 * cerrarse, SQLite volcaría el -wal y lo borraría.
 */
function copiaEnCaliente(): string {
  const vivo = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'vivo-'));
  const copia = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'copia-carpeta-'));
  const db = new DatabaseSync(path.join(vivo, 'ledger.db'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE prediction_log (match_key TEXT PRIMARY KEY, prob1 REAL NOT NULL);
    CREATE TABLE paper_bets (id INTEGER PRIMARY KEY, stake REAL NOT NULL);`);
  const ins = db.prepare('INSERT INTO prediction_log VALUES (?, ?)');
  for (let i = 0; i < 5; i++) ins.run(`k${i}`, 0.5);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for (let i = 5; i < 8; i++) ins.run(`k${i}`, 0.6);
  db.prepare('INSERT INTO paper_bets (stake) VALUES (10)').run();
  for (const f of ['ledger.db', 'ledger.db-wal']) fs.copyFileSync(path.join(vivo, f), path.join(copia, f));
  db.close();
  return copia;
}

test('1: solo el fichero principal pierde lo del -wal; la copia consolidada lo tiene todo y el original no se toca', () => {
  const copia = copiaEnCaliente();
  const antes = Object.fromEntries(fs.readdirSync(copia).map((f) => [f, sha256DeFichero(path.join(copia, f))]));
  const salida = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'consolidada-'));
  const r = consolidarCopia(copia, salida, path.join(salida, 'trabajo'));

  assert.equal(r.origenIntacto, true);
  assert.deepEqual(Object.fromEntries(fs.readdirSync(copia).map((f) => [f, sha256DeFichero(path.join(copia, f))])), antes, 'ni un byte del original');
  const [b] = r.bases;
  assert.ok(b.wal && b.wal.marcos > 0, 'el -wal llevaba marcos');
  assert.deepEqual(b.diferencias, [
    { tabla: 'paper_bets', soloBase: 0, conWal: 1 },
    { tabla: 'prediction_log', soloBase: 5, conWal: 8 },
  ]);
  assert.equal(b.integridad, 'ok');
  assert.deepEqual(b.verificacion, [], 'la copia escrita es la vista con -wal');
  const out = new DatabaseSync(b.salida, { readOnly: true });
  assert.equal((out.prepare('SELECT COUNT(*) AS n FROM prediction_log').get() as { n: number }).n, 8);
  out.close();
  assert.equal(fs.existsSync(b.salida + '-wal'), false, 'autónoma: sin laterales');
  assert.ok(fs.existsSync(b.salida + '.manifiesto.json'));
});

test('1: no escribe dentro de la copia original', () => {
  const copia = copiaEnCaliente();
  assert.throws(() => consolidarCopia(copia, path.join(copia, 'salida'), path.join(copia, 'trabajo')), /dentro de la copia original/);
});

test('1: la restauración de prueba reproduce la copia consolidada, tabla a tabla', () => {
  const copia = copiaEnCaliente();
  const salida = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'consolidada-'));
  const r = consolidarCopia(copia, salida, path.join(salida, 'trabajo'));
  const v = verificarRestauracion(r.bases[0].salida);
  assert.deepEqual(v.diferencias, []);
  assert.equal(v.filas, 9);
});

test('1: restaurar o simular la restauración de una copia con -wal no la toca (revisión data-guardian, hallazgo 1)', async () => {
  const { restaurarCopia } = await import('./backup.ts');
  // Una copia en caliente con las dos tablas que restaurarCopia exige a un libro mayor.
  const caliente = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'caliente-'));
  const vivo = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'vivo-'));
  const db = new DatabaseSync(path.join(vivo, 'ledger.db'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
    CREATE TABLE prediction_log (match_key TEXT PRIMARY KEY, prob1 REAL NOT NULL);
    CREATE TABLE paper_bets (id INTEGER PRIMARY KEY, stake REAL NOT NULL);`);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  for (let i = 0; i < 4; i++) db.prepare('INSERT INTO prediction_log VALUES (?, 0.5)').run(`k${i}`);
  for (const f of ['ledger.db', 'ledger.db-wal']) fs.copyFileSync(path.join(vivo, f), path.join(caliente, f));
  db.close();
  const de = () => Object.fromEntries(fs.readdirSync(caliente).sort().map((f) => [f, sha256DeFichero(path.join(caliente, f))]));
  const antes = de();
  assert.ok(antes['ledger.db-wal'], 'la copia lleva su -wal');

  const v = verificarRestauracion(path.join(caliente, 'ledger.db'));
  assert.deepEqual(v.diferencias, []);
  assert.equal(v.filas, 4, 'lo del -wal cuenta');
  assert.deepEqual(de(), antes, 'el simulacro no toca la copia: ni vuelca su -wal ni le crea un -shm');

  const destino = path.join(fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'destino-')), 'ledger.db');
  restaurarCopia(path.join(caliente, 'ledger.db'), { destino });
  assert.deepEqual(de(), antes, 'restaurar de verdad tampoco');
  const r = new DatabaseSync(destino, { readOnly: true });
  assert.equal((r.prepare('SELECT COUNT(*) AS n FROM prediction_log').get() as { n: number }).n, 4);
  r.close();
});

test('1: el manifiesto no depende del orden de las filas, y sí de su contenido', () => {
  const dir = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'manifiesto-'));
  const hacer = (nombre: string, filas: [string, number][]) => {
    const f = path.join(dir, nombre);
    const db = new DatabaseSync(f);
    db.exec('CREATE TABLE t (k TEXT, v REAL)');
    for (const [k, v] of filas) db.prepare('INSERT INTO t VALUES (?, ?)').run(k, v);
    db.close();
    return manifiestoDeFichero(f);
  };
  const a = hacer('a.db', [['x', 0.1], ['y', 0.2]]);
  const b = hacer('b.db', [['y', 0.2], ['x', 0.1]]);
  const c = hacer('c.db', [['x', 0.1], ['y', 0.25]]);
  assert.deepEqual(compararManifiestos(a, b), []);
  assert.deepEqual(compararManifiestos(a, c), [{ tabla: 't', a: 2, b: 2, contenidoDistinto: true }]);
});

test('1: cada npm run backup restaura su copia de prueba y deja constancia', async () => {
  const { hacerCopia, CLAVE_ULTIMA_VERIFICACION } = await import('./backup.ts');
  const { getDb, getMeta } = await import('../db.ts');
  getDb();
  const copia = await hacerCopia({ subir: false });
  assert.deepEqual(copia.verificacion.diferencias, []);
  assert.ok(copia.verificacion.tablas > 10, 'el libro mayor entero, no una tabla');
  const meta = JSON.parse(getMeta(CLAVE_ULTIMA_VERIFICACION) ?? '{}') as { fichero?: string; diferencias?: unknown[] };
  assert.equal(meta.fichero, copia.fichero);
  assert.deepEqual(meta.diferencias, []);
});

test('1: una copia cuya restauración de prueba no se puede hacer se aparta, no rota ni se sube, y queda dicho', async () => {
  const { hacerCopia, copiasLocales, CLAVE_ULTIMA_VERIFICACION } = await import('./backup.ts');
  const { getDb, getMeta } = await import('../db.ts');
  getDb();
  const antes = copiasLocales().map((c) => c.fichero);
  // El simulacro trabaja en os.tmpdir(): sin él no se puede hacer (como un disco lleno).
  const tmp = process.env.TMPDIR;
  process.env.TMPDIR = path.join(process.env.DATA_DIR!, 'no-existe', 'tmp');
  try {
    await assert.rejects(hacerCopia({ subir: false }), /no se pudo restaurar de prueba.*apartada como ledger-.*\.sin-verificar/);
  } finally {
    if (tmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = tmp;
  }
  assert.deepEqual(copiasLocales().map((c) => c.fichero), antes, 'la apartada no cuenta como copia ni hace rotar las buenas');
  const v = JSON.parse(getMeta(CLAVE_ULTIMA_VERIFICACION) ?? '{}') as { fichero: string; error?: string };
  assert.match(v.fichero, /\.sin-verificar$/);
  assert.ok(v.error);
  assert.ok(fs.existsSync(v.fichero), 'apartada, no borrada');
});
