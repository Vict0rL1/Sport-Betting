// `npm run study -- <nombre>` (y `--list`): los estudios del proyecto bajo un solo comando.
// Los `npm run study:<nombre>` de siempre siguen funcionando como alias.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ESTUDIOS: Record<string, { fichero: string; descripcion: string }> = {
  ablation: { fichero: '_ablation.ts', descripcion: 'Tenis: ¿se gana el sitio cada pieza del modelo?' },
  baselines: { fichero: '_baselines.ts', descripcion: 'Baselines sencillos contra el modelo, por deporte' },
  calibration: { fichero: '_calibration.ts', descripcion: 'Calibración por bandas y recalibración' },
  correlation: { fichero: '_corr.ts', descripcion: 'Apuestas simultáneas: correlación, Kelly de cartera y topes' },
  dc: { fichero: '_dc.ts', descripcion: 'Fútbol: hiperparámetros del Dixon-Coles con reajuste periódico' },
  devig: { fichero: '_devig.ts', descripcion: 'Quitar el margen: multiplicativo vs Shin vs potencia' },
  features: { fichero: '_features.ts', descripcion: 'Qué señales aportan fuera de muestra' },
  'home-bb': { fichero: '_homeBb.ts', descripcion: 'Baloncesto: ventaja de campo medida' },
  'home-elo': { fichero: '_homeElo.ts', descripcion: 'Ventaja de campo en el Elo, por deporte' },
  ht: { fichero: '_ht.ts', descripcion: 'Fútbol: las dos mitades' },
  'ht-val': { fichero: '_htval.ts', descripcion: 'Fútbol: validación de los mercados de mitades' },
  live: { fichero: '_live.ts', descripcion: 'Tenis: el motor en vivo punto a punto' },
  'nfl-spread': { fichero: '_nflSpread.ts', descripcion: 'NFL: hándicap y total contra el mercado' },
  'params-bb': { fichero: '_paramsBb.ts', descripcion: 'Baloncesto: parámetros del modelo' },
  'params-bsb': { fichero: '_paramsBsb.ts', descripcion: 'Béisbol: parámetros del modelo' },
  points: { fichero: '_points.ts', descripcion: 'Tenis: el modelo jerárquico de puntos' },
  postprocess: { fichero: '_postprocess.ts', descripcion: 'La capa entre el modelo y la pantalla' },
  sigma: { fichero: '_sigma.ts', descripcion: 'Dispersión de los márgenes' },
  thin: { fichero: '_thin.ts', descripcion: 'Mercados de menos liquidez' },
};

const args = process.argv.slice(2);
const nombre = args.find((a) => !a.startsWith('--'));
if (!nombre || args.includes('--list')) {
  console.log('Estudios (npm run study -- <nombre> [argumentos del estudio]):\n');
  for (const [k, v] of Object.entries(ESTUDIOS)) console.log(`  ${k.padEnd(12)} ${v.descripcion}`);
  process.exit(nombre ? 0 : args.includes('--list') ? 0 : 1);
}
const e = ESTUDIOS[nombre];
if (!e) {
  console.error(`Estudio desconocido: ${nombre}. Lista: npm run study -- --list`);
  process.exit(1);
}
const aqui = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(aqui, e.fichero), ...args.filter((a) => a !== nombre)], { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--experimental-sqlite --disable-warning=ExperimentalWarning' } });
process.exit(r.status ?? 1);
