// Revisión de data-guardian al arreglo de la marca (12 de octubre). Con la marca fuera de git,
// una instalación que hace `git pull` la pierde y la recupera al abrir la base; y aunque la marca
// falte, quedan otras huellas de que aquí HUBO un libro mayor (las copias de data/backups, una
// restauración a medias): con cualquiera de ellas y sin ledger.db, tampoco se arranca uno vacío.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import '../test/setup.ts';

const { abrirBase } = await import('../db.ts');
const { LEDGER_DB_PATH, LEDGER_MARCA_PATH } = await import('./layout.ts');
const { directorioCopias } = await import('./backup.ts');

const quitarLibro = () => {
  for (const s of ['', '-wal', '-shm']) fs.rmSync(LEDGER_DB_PATH + s, { force: true });
};

test('con ledger.db y sin la marca (un git pull la borró), abrir la base la vuelve a escribir', () => {
  abrirBase().close();
  fs.rmSync(LEDGER_MARCA_PATH);
  abrirBase().close();
  assert.equal(fs.existsSync(LEDGER_MARCA_PATH), true);
});

test('sin ledger.db ni marca, pero con una copia en data/backups: no se arranca un libro mayor vacío', () => {
  const copias = directorioCopias();
  fs.mkdirSync(copias, { recursive: true });
  const copia = path.join(copias, `ledger-prueba-${process.pid}-${Date.now()}.db`);
  fs.writeFileSync(copia, 'copia');
  try {
    quitarLibro();
    fs.rmSync(LEDGER_MARCA_PATH, { force: true });
    assert.throws(() => abrirBase(), /npm run restore/);
    assert.equal(fs.existsSync(LEDGER_DB_PATH), false, 'y no deja uno vacío al pasar');
  } finally {
    fs.rmSync(copia, { force: true });
  }
});

test('sin ledger.db ni marca, pero con una restauración a medias: tampoco', () => {
  const apartado = `${LEDGER_DB_PATH}.antes-de-restaurar-prueba-${process.pid}`;
  fs.writeFileSync(apartado, 'libro anterior');
  try {
    quitarLibro();
    fs.rmSync(LEDGER_MARCA_PATH, { force: true });
    assert.throws(() => abrirBase(), /npm run restore/);
  } finally {
    fs.rmSync(apartado, { force: true });
  }
});

test('una instalación nueva de verdad (sin ninguna huella) crea su libro mayor y su marca', () => {
  quitarLibro();
  fs.rmSync(LEDGER_MARCA_PATH, { force: true });
  abrirBase().close();
  assert.equal(fs.existsSync(LEDGER_DB_PATH), true);
  assert.equal(fs.existsSync(LEDGER_MARCA_PATH), true);
});

// Un ledger.db-wal sin su ledger.db puede llevar los últimos commits (los que no se volcaron
// antes de que el fichero se moviera o se perdiera). Los dos remedios que da el aviso lo borraban
// sin decir nada: empezar uno nuevo (SQLite lo descarta al abrir uno vacío) y restaurar una copia.
// Se aparta como `ledger.db-wal.huerfano-<fecha>`, nunca se borra.
const huerfanos = () => fs.readdirSync(path.dirname(LEDGER_DB_PATH)).filter((f) => f.startsWith('ledger.db-wal.huerfano-'));

test('LEDGER_NUEVO=si con un WAL huérfano: se aparta (con su contenido), no se pierde', () => {
  quitarLibro();
  fs.rmSync(LEDGER_MARCA_PATH, { force: true });
  fs.writeFileSync(`${LEDGER_DB_PATH}-wal`, 'commits sin volcar');
  process.env.LEDGER_NUEVO = 'si';
  try {
    abrirBase().close();
  } finally {
    delete process.env.LEDGER_NUEVO;
  }
  const h = huerfanos();
  assert.equal(h.length, 1, 'el WAL huérfano queda apartado');
  assert.equal(fs.readFileSync(path.join(path.dirname(LEDGER_DB_PATH), h[0]), 'utf8'), 'commits sin volcar');
  for (const f of h) fs.rmSync(path.join(path.dirname(LEDGER_DB_PATH), f));
});

test('restaurar una copia sin ledger.db pero con un WAL huérfano: se aparta, no se borra', async () => {
  const { hacerCopia, restaurarCopia } = await import('./backup.ts');
  const { cerrarDb } = await import('../db.ts');
  const copia = await hacerCopia({ subir: false });
  cerrarDb();
  quitarLibro();
  fs.writeFileSync(`${LEDGER_DB_PATH}-wal`, 'commits sin volcar');
  restaurarCopia(copia.fichero);
  assert.equal(fs.existsSync(LEDGER_DB_PATH), true, 'restaurado');
  const h = huerfanos();
  assert.equal(h.length, 1, 'el WAL huérfano queda apartado');
  assert.equal(fs.readFileSync(path.join(path.dirname(LEDGER_DB_PATH), h[0]), 'utf8'), 'commits sin volcar');
});

// Más huellas (misma revisión): un tennis.db antiguo sin partir junto a un history.db, los restos
// de una partición o de una restauración, un ledger.db de 0 bytes (existe, pero no es un libro
// mayor) y una carpeta de copias que no se deja leer (no es lo mismo que «no hay copias»).
test('otras huellas: tennis.db sin partir, restos de partición o restauración, ledger.db vacío, copias ilegibles', async () => {
  const { LEGACY_DB_PATH } = await import('./layout.ts');
  const dir = path.dirname(LEDGER_DB_PATH);
  const casos: [string, () => () => void][] = [
    ['tennis.db sin partir', () => (fs.writeFileSync(LEGACY_DB_PATH, 'todo dentro'), () => fs.rmSync(LEGACY_DB_PATH))],
    ['resto de una partición', () => { const f = `${LEGACY_DB_PATH}.pre-split-2026-10-01`; fs.writeFileSync(f, 'x'); return () => fs.rmSync(f); }],
    ['restauración a medias', () => { const f = `${LEDGER_DB_PATH}.restaurando`; fs.writeFileSync(f, 'x'); return () => fs.rmSync(f); }],
    ['ledger.db de 0 bytes con la marca', () => { fs.writeFileSync(LEDGER_DB_PATH, ''); fs.writeFileSync(LEDGER_MARCA_PATH, 'x'); return () => fs.rmSync(LEDGER_MARCA_PATH); }],
    ['carpeta de copias ilegible', () => {
      const antes = process.env.BACKUP_DIR;
      const fichero = path.join(dir, 'no-es-una-carpeta');
      fs.writeFileSync(fichero, 'x');
      process.env.BACKUP_DIR = fichero;
      return () => { process.env.BACKUP_DIR = antes; fs.rmSync(fichero); };
    }],
  ];
  for (const [nombre, preparar] of casos) {
    quitarLibro();
    fs.rmSync(LEDGER_MARCA_PATH, { force: true });
    const limpiar = preparar();
    try {
      assert.throws(() => abrirBase(), /npm run restore/, nombre);
    } finally {
      limpiar();
    }
  }
});
