// Arranca el servidor para los tests de Playwright: base de demostración en un directorio
// temporal (nunca la tuya), sin clave de cuotas, sin contraseña, sirviendo web/dist en el
// puerto 7390. `npm run build` tiene que haber corrido antes.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'predictor-e2e-'));
const env = {
  ...process.env,
  DATA_DIR,
  PORT: '7390',
  APP_AUTH: 'off',
  ODDS_API_KEY: '',
  THE_ODDS_API_KEY: '',
  AUTO_REFRESH_MINUTES: '0',
  DEMO_FIXTURES: 'on',
  NODE_ENV: 'test',
  NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning',
};
if (!fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
  console.error('No hay web/dist: corre npm run build antes de los tests de punta a punta.');
  process.exit(1);
}
const seed = spawnSync('npm', ['run', 'seed', '--workspace', 'server'], { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const hijo = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server', 'src', 'index.ts')], { cwd: ROOT, env, stdio: 'inherit' });
hijo.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGTERM', () => hijo.kill('SIGTERM'));
process.on('SIGINT', () => hijo.kill('SIGINT'));
