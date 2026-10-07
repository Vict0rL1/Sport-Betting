// `npm run help` — todos los comandos, por grupo, generados del registro (scripts/registry.mjs).
import { GRUPOS, SCRIPTS } from './registry.mjs';

const dim = '\x1b[2m', bold = '\x1b[1m', off = '\x1b[0m';
console.log(`${bold}Sports Predictor — comandos${off} ${dim}(npm run <comando>; los argumentos van tras «--»)${off}\n`);
for (const [g, titulo] of Object.entries(GRUPOS)) {
  const en = Object.entries(SCRIPTS).filter(([, v]) => v.grupo === g && !v.ayuda.startsWith('Alias de'));
  if (en.length === 0) continue;
  console.log(`${bold}${titulo}${off}`);
  for (const [k, v] of en) console.log(`  ${k.padEnd(20)} ${v.ayuda}`);
  console.log('');
}
console.log(`${dim}Los study:<nombre> siguen funcionando como alias de «npm run study -- <nombre>». Documentación: docs/${off}`);
