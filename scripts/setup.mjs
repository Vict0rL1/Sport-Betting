// `npm run setup` — la primera puesta en marcha, paso a paso: el .env, la base (partir y
// migrar), los datos (descargar, construir o demostración) y el doctor. Cada paso dice lo que
// va a hacer y pregunta; nada se hace a ciegas.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = { bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', amber: '\x1b[33m', off: '\x1b[0m' };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pregunta = async (texto, porDefecto = 's') => {
  const r = (await rl.question(`${texto} ${C.dim}[${porDefecto === 's' ? 'S/n' : 's/N'}]${C.off} `)).trim().toLowerCase();
  return r ? r.startsWith('s') : porDefecto === 's';
};
const corre = (args) => spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

console.log(`${C.bold}Sports Predictor — puesta en marcha${C.off}\n`);

// 1. Node
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.log(`${C.amber}⚠ Node ${process.versions.node}: hace falta 22.13 o superior (node:sqlite sin flag).${C.off}`);
}

// 2. .env
const env = path.join(ROOT, '.env');
if (!fs.existsSync(env)) {
  console.log('No hay .env. Sin él la app arranca en modo demostración (cuotas inventadas y etiquetadas).');
  if (await pregunta('¿Creo un .env a partir de .env.example para que rellenes tu clave de The Odds API?')) {
    fs.copyFileSync(path.join(ROOT, '.env.example'), env);
    console.log(`${C.green}✓${C.off} .env creado. Abre ${env} y pon ODDS_API_KEY (y APP_PASSWORD si va a salir de tu red).`);
  }
} else {
  console.log(`${C.green}✓${C.off} .env encontrado.`);
}

// 3. Base de datos: partir la antigua si la hay y migrar.
console.log('\nBase de datos: history.db (historia) + ledger.db (lo tuyo). Un tennis.db antiguo se parte sin perder nada.');
if (await pregunta('¿Aplico las migraciones ahora (npm run db:migrate)?')) corre(['run', 'db:migrate']);

// 4. Datos
const history = path.join(ROOT, 'data', 'history.db');
const hayDatos = fs.existsSync(history) && fs.statSync(history).size > 5 * 1048576;
if (hayDatos) {
  console.log(`\n${C.green}✓${C.off} Ya hay historia en data/history.db.`);
} else {
  console.log('\nDatos: hay tres caminos.');
  console.log('  1) Descargar la historia publicada (9 MB, recomendado)');
  console.log('  2) Construirla desde las fuentes (unos minutos, ~100 MB de descargas)');
  console.log('  3) Demostración sin internet (npm run seed)');
  const r = (await rl.question(`¿Cuál? ${C.dim}[1/2/3]${C.off} `)).trim();
  if (r === '2') corre(['run', 'update-all', '--', '--skip-odds']);
  else if (r === '3') corre(['run', 'seed']);
  else if (!corre(['run', 'fetch-data'])) {
    console.log(`${C.amber}⚠ La descarga no está disponible; se construye desde las fuentes.${C.off}`);
    corre(['run', 'update-all', '--', '--skip-odds']);
  }
}

// 5. Demostración
if (await pregunta('¿Quieres ver partidos de demostración cuando no haya cuotas reales? (DEMO_FIXTURES)', 'n')) corre(['run', 'demo', '--', '--on']);
else console.log(`${C.dim}Sin demostración: sin clave de cuotas, las pestañas enseñan solo partidos reales con calendario oficial.${C.off}`);

// 6. Doctor
console.log('');
if (await pregunta('¿Paso el doctor (gratis, no gasta cuota)?')) corre(['run', 'doctor', '--', '--sin-red']);

rl.close();
console.log(`\n${C.bold}Listo.${C.off} Arranca con  ${C.bold}npm run dev${C.off}  y abre http://localhost:7373. Todos los comandos: npm run help`);
