// La marca del libro mayor (`data/ledger.db.existe`, lote B) dice «en ESTA máquina hubo un
// libro mayor». Se coló en git con el lote B, así que cada clon nuevo la traía y se negaba a
// arrancar: «Falta ledger.db y ledger.db.existe dice que aquí hubo un libro mayor», en una
// instalación que nunca tuvo ninguno (le pasó al propietario el 12 de octubre). Es de cada
// máquina, como ledger.db: ni se versiona ni se puede versionar sin querer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const git = (...args: string[]) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const hayGit = fs.existsSync(path.join(RAIZ, '.git'));

test('la marca del libro mayor no está en git y el .gitignore la deja fuera', { skip: !hayGit && 'sin .git (no es un checkout)' }, () => {
  assert.equal(git('ls-files', 'data/ledger.db.existe'), '', 'un clon nuevo no puede traer la marca de otra máquina');
  assert.equal(git('check-ignore', 'data/ledger.db.existe'), 'data/ledger.db.existe');
});
