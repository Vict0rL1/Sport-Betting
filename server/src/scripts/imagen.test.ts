// A4: la imagen de Fly ejecutaba `npx tsx` con tsx en devDependencies (instalada con
// --omit=dev): npx la descargaba sin fijar en cada arranque frío, como root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const leer = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('A4: tsx es dependencia del servidor, fijada a una versión exacta', () => {
  const pkg = JSON.parse(leer('server/package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.match(pkg.dependencies.tsx ?? '', /^\d+\.\d+\.\d+$/, `dependencies.tsx = ${pkg.dependencies.tsx}`);
  assert.equal(pkg.devDependencies.tsx, undefined, 'no en las dos listas');
  // Y el lockfile no la marca como de desarrollo: `npm ci --omit=dev` la tiene que instalar.
  const lock = JSON.parse(leer('package-lock.json')) as { packages: Record<string, { version: string; dev?: boolean }> };
  const entrada = lock.packages['node_modules/tsx'];
  assert.ok(entrada, 'tsx en package-lock.json');
  assert.equal(entrada.version, pkg.dependencies.tsx);
  assert.notEqual(entrada.dev, true, 'tsx no es de desarrollo en el lockfile');
});

test('A4: el arranque de la imagen usa el tsx instalado, no npx, y suelta los privilegios', () => {
  const sh = leer('scripts/docker-start.sh');
  // Lo que se ejecuta (los comentarios cuentan la historia, y pueden decir «npx»).
  const comandos = sh.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(comandos, /\bnpx\b/, 'sin npx: nada se descarga al arrancar');
  assert.match(sh, /node_modules\/\.bin\/tsx/);
  assert.match(sh, /setpriv|runuser/, 'el servidor corre como node, no como root');
  assert.match(sh, /chown/, 'el disco de Fly se monta de root: hay que cedérselo a node');
});
