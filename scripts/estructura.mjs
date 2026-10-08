// `node scripts/estructura.mjs` — el árbol del proyecto, generado del repo real (no escrito a
// mano), para docs/ARQUITECTURA.md. Dos niveles bajo server/src y web/src; ficheros de test
// contados, no listados.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ficheros = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
const arbol = new Map();
for (const f of ficheros) {
  const partes = f.split('/');
  const nivel = partes[0] === 'server' || partes[0] === 'web' ? 3 : 2;
  const clave = partes.slice(0, Math.min(nivel, partes.length - 1)).join('/') || '.';
  const e = arbol.get(clave) ?? { ficheros: 0, tests: 0 };
  if (/\.test\.(ts|tsx|mjs)$/.test(f)) e.tests++;
  else e.ficheros++;
  arbol.set(clave, e);
}
const lineas = [...arbol.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k.padEnd(40)} ${String(v.ficheros).padStart(4)} ficheros${v.tests ? `  ${v.tests} tests` : ''}`);
process.stdout.write(lineas.join('\n') + '\n');
