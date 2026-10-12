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
  try {
    quitarLibro();
    fs.writeFileSync(`${LEDGER_DB_PATH}-wal`, 'commits sin volcar');
    restaurarCopia(copia.fichero);
    assert.equal(fs.existsSync(LEDGER_DB_PATH), true, 'restaurado');
    const h = huerfanos();
    assert.equal(h.length, 1, 'el WAL huérfano queda apartado');
    assert.equal(fs.readFileSync(path.join(path.dirname(LEDGER_DB_PATH), h[0]), 'utf8'), 'commits sin volcar');
    for (const f of h) fs.rmSync(path.join(path.dirname(LEDGER_DB_PATH), f));
  } finally {
    // La copia es una huella: si se queda, la prueba siguiente se negaría por ella y no por lo que mira.
    fs.rmSync(copia.fichero, { force: true });
  }
});

// Más huellas (misma revisión): un tennis.db antiguo sin partir junto a un history.db, los restos
// de una partición o de una restauración, un ledger.db de 0 bytes (existe, pero no es un libro
// mayor) y una carpeta de copias que no se deja leer (no es lo mismo que «no hay copias»).
test('otras huellas: cada una por sí sola niega el arranque y el aviso la nombra', async () => {
  const { LEGACY_DB_PATH } = await import('./layout.ts');
  const dir = path.dirname(LEDGER_DB_PATH);
  abrirBase().close(); // history.db existe: tennis.db no se partiría, es una huella
  fs.rmSync(directorioCopias(), { recursive: true, force: true }); // ninguna copia que tape lo que se mira
  const casos: [string, RegExp, () => () => void][] = [
    ['tennis.db sin partir', /\(tennis\.db\)/, () => (fs.writeFileSync(LEGACY_DB_PATH, 'todo dentro'), () => fs.rmSync(LEGACY_DB_PATH))],
    ['resto de una partición', /tennis\.db\.pre-split-/, () => { const f = `${LEGACY_DB_PATH}.pre-split-2026-10-01`; fs.writeFileSync(f, 'x'); return () => fs.rmSync(f); }],
    ['restauración a medias', /ledger\.db\.restaurando/, () => { const f = `${LEDGER_DB_PATH}.restaurando`; fs.writeFileSync(f, 'x'); return () => fs.rmSync(f); }],
    ['ledger.db de 0 bytes con la marca', /ledger\.db\.existe/, () => { fs.writeFileSync(LEDGER_DB_PATH, ''); fs.writeFileSync(LEDGER_MARCA_PATH, 'x'); return () => fs.rmSync(LEDGER_MARCA_PATH); }],
    ['carpeta de copias ilegible', /no se pudo leer/, () => {
      const antes = process.env.BACKUP_DIR;
      const fichero = path.join(dir, 'no-es-una-carpeta');
      fs.writeFileSync(fichero, 'x');
      process.env.BACKUP_DIR = fichero;
      return () => { process.env.BACKUP_DIR = antes; fs.rmSync(fichero); };
    }],
  ];
  for (const [nombre, huella, preparar] of casos) {
    quitarLibro();
    fs.rmSync(LEDGER_MARCA_PATH, { force: true });
    const limpiar = preparar();
    try {
      assert.throws(() => abrirBase(), huella, nombre);
    } finally {
      limpiar();
    }
  }
});

// Revisión de data-guardian a 8522ca1. Si la huella es un tennis.db sin partir, el libro mayor
// sigue DENTRO de él: «LEDGER_NUEVO=si» lo dejaba allí varado y empezaba uno vacío. El aviso dice
// cómo partirlo, con un comando de la app (tercera revisión: un `mv` a mano dejaba atrás los WAL
// y no comprobaba si el servidor seguía en marcha).
const sinNada = () => {
  abrirBase().close(); // history.db existe: tennis.db no se partiría solo
  fs.rmSync(directorioCopias(), { recursive: true, force: true });
  quitarLibro();
  fs.rmSync(LEDGER_MARCA_PATH, { force: true });
};

test('con un tennis.db sin partir como única huella, el aviso da el comando para partirlo y no propone empezar de cero', async () => {
  const { LEGACY_DB_PATH } = await import('./layout.ts');
  sinNada();
  fs.writeFileSync(LEGACY_DB_PATH, 'todo dentro');
  try {
    assert.throws(
      () => abrirBase(),
      (e: Error) => /npm run db:migrate -- --partir-legado/.test(e.message) && !/LEDGER_NUEVO/.test(e.message) && !/\bmv\b/.test(e.message),
    );
  } finally {
    fs.rmSync(LEGACY_DB_PATH);
  }
});

// Tercera revisión: con más huellas que tennis.db (una copia, la marca que dejó la app), pudo haber
// un libro mayor MÁS NUEVO que el de tennis.db. Primero se ofrece restaurar.
test('con tennis.db y además una copia y la marca, primero restaurar; partir tennis.db, después y avisado', async () => {
  const { LEGACY_DB_PATH } = await import('./layout.ts');
  sinNada();
  fs.writeFileSync(LEGACY_DB_PATH, 'todo dentro');
  fs.writeFileSync(LEDGER_MARCA_PATH, 'libro mayor creado por la app');
  const copias = directorioCopias();
  fs.mkdirSync(copias, { recursive: true });
  const copia = path.join(copias, 'ledger-2026-10-11T03-00-00.db');
  fs.writeFileSync(copia, 'copia');
  try {
    assert.throws(() => abrirBase(), (e: Error) => {
      const restaurar = e.message.indexOf('npm run restore');
      const partir = e.message.indexOf('--partir-legado');
      return restaurar >= 0 && partir > restaurar && !/LEDGER_NUEVO/.test(e.message) && /DENTRO/.test(e.message) === false;
    });
  } finally {
    fs.rmSync(LEGACY_DB_PATH);
    fs.rmSync(copia);
    fs.rmSync(LEDGER_MARCA_PATH);
  }
});

test('LEDGER_NUEVO=si no se acepta con un tennis.db con datos al lado', async () => {
  const { LEGACY_DB_PATH } = await import('./layout.ts');
  sinNada();
  fs.writeFileSync(LEGACY_DB_PATH, 'todo dentro');
  process.env.LEDGER_NUEVO = 'si';
  try {
    assert.throws(() => abrirBase(), /--partir-legado/);
    assert.equal(fs.existsSync(LEDGER_DB_PATH), false, 'no empezó uno vacío');
  } finally {
    delete process.env.LEDGER_NUEVO;
    fs.rmSync(LEGACY_DB_PATH);
  }
});

test('un tennis.db de 0 bytes con su WAL sí es una huella (los commits pueden estar en el WAL)', async () => {
  const { LEGACY_DB_PATH } = await import('./layout.ts');
  sinNada();
  fs.writeFileSync(LEGACY_DB_PATH, '');
  fs.writeFileSync(`${LEGACY_DB_PATH}-wal`, 'commits sin volcar');
  try {
    assert.throws(() => abrirBase(), /tennis\.db-wal/);
  } finally {
    fs.rmSync(LEGACY_DB_PATH);
    fs.rmSync(`${LEGACY_DB_PATH}-wal`);
  }
});

test('un WAL apartado (ledger.db-wal.huerfano-*) con algo dentro es una huella', () => {
  sinNada();
  const f = `${LEDGER_DB_PATH}-wal.huerfano-2026-10-12T10-00-00`;
  fs.writeFileSync(f, 'commits sin volcar');
  try {
    assert.throws(() => abrirBase(), /ledger\.db-wal\.huerfano-/);
  } finally {
    fs.rmSync(f);
  }
});

test('un tennis.db de 0 bytes no es una huella (no hay nada que proteger)', async () => {
  const { LEGACY_DB_PATH } = await import('./layout.ts');
  quitarLibro();
  fs.rmSync(LEDGER_MARCA_PATH, { force: true });
  fs.writeFileSync(LEGACY_DB_PATH, '');
  try {
    abrirBase().close();
    assert.equal(fs.existsSync(LEDGER_DB_PATH), true);
  } finally {
    fs.rmSync(LEGACY_DB_PATH);
  }
});

test('restaurar sobre un ledger.db de 0 bytes aparta su WAL (y el fichero vacío) antes de abrir nada', async () => {
  const { hacerCopia, restaurarCopia } = await import('./backup.ts');
  const { cerrarDb } = await import('../db.ts');
  abrirBase().close();
  const copia = await hacerCopia({ subir: false });
  cerrarDb();
  try {
    quitarLibro();
    fs.writeFileSync(LEDGER_DB_PATH, '');
    fs.writeFileSync(`${LEDGER_DB_PATH}-wal`, 'commits sin volcar');
    const r = restaurarCopia(copia.fichero);
    const h = huerfanos();
    assert.equal(h.length, 1, 'el WAL queda apartado');
    assert.equal(fs.readFileSync(path.join(path.dirname(LEDGER_DB_PATH), h[0]), 'utf8'), 'commits sin volcar');
    assert.match(r.aviso ?? '', /huerfano/);
    for (const f of h) fs.rmSync(path.join(path.dirname(LEDGER_DB_PATH), f));
  } finally {
    fs.rmSync(copia.fichero, { force: true });
  }
});

test('apartar dos veces en el mismo segundo no pisa el primer apartado', async () => {
  const { apartarLateralesHuerfanos } = await import('./layout.ts');
  const f = path.join(path.dirname(LEDGER_DB_PATH), 'otro.db');
  const ahora = new Date('2026-10-12T10:00:00Z');
  fs.writeFileSync(`${f}-wal`, 'primero');
  const [a] = apartarLateralesHuerfanos(f, ahora);
  fs.writeFileSync(`${f}-wal`, 'segundo');
  const [b] = apartarLateralesHuerfanos(f, ahora);
  assert.notEqual(a, b);
  assert.deepEqual([fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8')], ['primero', 'segundo']);
});

// Cuarta revisión: cualquier lectura de una base en WAL deja un -wal de 0 bytes; eso no son commits.
test('un WAL de 0 bytes (de tennis.db o de ledger.db) no es una huella', async () => {
  const { LEGACY_DB_PATH } = await import('./layout.ts');
  sinNada();
  fs.writeFileSync(`${LEGACY_DB_PATH}-wal`, '');
  fs.writeFileSync(`${LEDGER_DB_PATH}-wal`, '');
  try {
    abrirBase().close();
    assert.equal(fs.existsSync(LEDGER_DB_PATH), true);
  } finally {
    fs.rmSync(`${LEGACY_DB_PATH}-wal`, { force: true });
  }
});
