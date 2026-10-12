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

// Revisión de data-guardian (12 de octubre): la misma clase de accidente seguía abierta. Una
// restauración interrumpida deja `ledger.db.restaurando`, una copia ENTERA del libro mayor, y un
// `git add -A` la subía (secret-scan no mira los binarios). data/ es ahora una lista de lo que SÍ
// se versiona: solo data/raw/.gitkeep.
test('de data/ solo se versiona data/raw/.gitkeep: todo lo demás (copias, descargas, restos) queda fuera', { skip: !hayGit && 'sin .git (no es un checkout)' }, () => {
  assert.equal(git('ls-files', 'data/'), 'data/raw/.gitkeep');
  const restos = ['data/ledger.db.restaurando', 'data/ledger.db.partiendo', 'data/history.db.partiendo', 'data/history.db.sin-filas-2026-10-12', 'data/history.db.download', 'data/history.db.new', 'data/history.db.backup-2026-10-12', 'data/cualquier-cosa-nueva.db', 'data/raw/atp_matches_2026.csv'];
  const ignorados = execFileSync('git', ['check-ignore', ...restos], { cwd: RAIZ, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(ignorados, restos);
  assert.throws(() => git('check-ignore', 'data/raw/.gitkeep'), 'data/raw/.gitkeep se versiona');
});
