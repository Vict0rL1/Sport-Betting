// `npm run policy -- show` | `npm run policy -- set staking.minEdge=0.03 [recortes.deriva=0.4] --nota "..."`
// La política de apuestas versionada: enseñar la vigente y el historial, o crear una versión
// nueva (nunca se reescribe una). Ver staking/policyStore.ts.

import { getDb } from '../db.ts';
import { historial, nuevaVersion, politicaVigente, type CambiosPolitica } from '../staking/policyStore.ts';

const C = { bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', off: '\x1b[0m' };
const args = process.argv.slice(2);
const orden = args[0] ?? 'show';
getDb();

if (orden === 'show') {
  const v = politicaVigente();
  console.log(`${C.bold}Política vigente${C.off} v${v.id} ${C.dim}(${v.created_at}, ${v.origen}${v.nota ? `: ${v.nota}` : ''})${C.off}`);
  for (const [grupo, valores] of Object.entries(v.config)) {
    console.log(`  ${C.bold}${grupo}${C.off}`);
    for (const [k, x] of Object.entries(valores as Record<string, number>)) console.log(`    ${k.padEnd(24)} ${x}`);
  }
  const h = historial(10);
  if (h.length > 1) console.log(`\n${C.bold}Historial${C.off}\n${h.map((x) => `  v${x.id}  ${x.created_at.slice(0, 16).replace('T', ' ')}  ${x.origen}${x.nota ? `  ${x.nota}` : ''}`).join('\n')}`);
  console.log(`\n${C.dim}Cambiar:  npm run policy -- set staking.minEdge=0.03 --nota "por qué"${C.off}`);
} else if (orden === 'set') {
  const cambios: CambiosPolitica = {};
  let nota: string | null = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--nota') {
      nota = args[++i] ?? null;
      continue;
    }
    const m = args[i].match(/^([a-z]+)\.([A-Za-z]+)=(-?[\d.]+)$/);
    if (!m) {
      console.error(`${C.red}✗ No entiendo «${args[i]}». Formato: grupo.clave=valor (p. ej. staking.minEdge=0.03)${C.off}`);
      process.exit(1);
    }
    const g = cambios as unknown as Record<string, Record<string, number>>;
    (g[m[1]] ??= {})[m[2]] = Number(m[3]);
  }
  try {
    const v = nuevaVersion(cambios, nota, 'cli');
    console.log(`${C.green}✓${C.off} Versión v${v.id} creada (a partir de v${v.parent_id}). Las apuestas y señales nuevas la referencian.`);
  } catch (e) {
    console.error(`${C.red}✗ ${(e as Error).message}${C.off}`);
    process.exit(1);
  }
} else {
  console.error(`${C.red}✗ Orden desconocida: ${orden} (show | set)${C.off}`);
  process.exit(1);
}
