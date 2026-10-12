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
  const copia = path.join(copias, 'ledger-2026-10-11T00-00-00.db');
  fs.writeFileSync(copia, 'copia');
  quitarLibro();
  fs.rmSync(LEDGER_MARCA_PATH, { force: true });
  assert.throws(() => abrirBase(), /npm run restore/);
  assert.equal(fs.existsSync(LEDGER_DB_PATH), false, 'y no deja uno vacío al pasar');
  fs.rmSync(copia);
});

test('sin ledger.db ni marca, pero con una restauración a medias: tampoco', () => {
  const apartado = `${LEDGER_DB_PATH}.antes-de-restaurar-2026-10-11T00-00-00`;
  fs.writeFileSync(apartado, 'libro anterior');
  quitarLibro();
  fs.rmSync(LEDGER_MARCA_PATH, { force: true });
  assert.throws(() => abrirBase(), /npm run restore/);
  fs.rmSync(apartado);
});

test('una instalación nueva de verdad (sin ninguna huella) crea su libro mayor y su marca', () => {
  quitarLibro();
  fs.rmSync(LEDGER_MARCA_PATH, { force: true });
  abrirBase().close();
  assert.equal(fs.existsSync(LEDGER_DB_PATH), true);
  assert.equal(fs.existsSync(LEDGER_MARCA_PATH), true);
});
