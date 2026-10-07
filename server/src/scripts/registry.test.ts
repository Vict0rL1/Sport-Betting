// Cada script de package.json (raíz) tiene su línea en scripts/registry.mjs, y el registro no
// inventa scripts que no existen. `npm run help` se genera de ahí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { SCRIPTS, GRUPOS } = (await import(path.join(ROOT, 'scripts', 'registry.mjs'))) as { SCRIPTS: Record<string, { grupo: string; ayuda: string }>; GRUPOS: Record<string, string> };

test('todos los scripts de package.json están en el registro, y viceversa, con grupo válido', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const enPkg = Object.keys(pkg.scripts).sort();
  const enRegistro = Object.keys(SCRIPTS).sort();
  assert.deepEqual(enPkg.filter((k) => !SCRIPTS[k]), [], 'scripts sin línea de ayuda en scripts/registry.mjs');
  assert.deepEqual(enRegistro.filter((k) => !pkg.scripts[k]), [], 'scripts en el registro que no existen en package.json');
  for (const [k, v] of Object.entries(SCRIPTS)) {
    assert.ok(GRUPOS[v.grupo], `${k}: grupo desconocido ${v.grupo}`);
    assert.ok(v.ayuda.length > 5, `${k}: sin ayuda`);
  }
});
