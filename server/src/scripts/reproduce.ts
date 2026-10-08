// npm run reproduce -- <id>  ·  ver audit/reproduce.ts. Imprime lo guardado; no recalcula.
import { reproducir } from '../audit/reproduce.ts';

const id = process.argv[2];
if (!id) {
  console.log('Uso: npm run reproduce -- apuesta:<id> | senal:<id> | evaluacion:<id> | <deporte>:<clave del partido>');
  process.exit(1);
}
const r = reproducir(id);
for (const [k, val] of r.campos) console.log(`${k.padEnd(22)} ${val}`);
for (const a of r.avisos) console.log(`⚠ ${a}`);
if (!r.encontrado) process.exitCode = 1;
