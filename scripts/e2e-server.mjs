// Arranca el servidor para los tests de Playwright: base de demostración en un directorio
// temporal (nunca la tuya), sin clave de cuotas, sin contraseña, sirviendo web/dist en el
// puerto 7390. `npm run build` tiene que haber corrido antes.
//
// Y un SEGUNDO servidor en el 7391 con la puerta activa (APP_AUTH=on, la contraseña de abajo)
// sobre una copia de la misma base: es el que prueba web/e2e/auth.spec.ts. Antes del lote A
// los e2e solo corrían sin contraseña, y así no se vio que en producción la web entera
// quedaba detrás de la puerta (A1).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'predictor-e2e-'));
// Las copias del libro mayor, en la carpeta de cada DATA_DIR y sin S3: con el BACKUP_DIR de tu
// .env, la copia programada a los 2 minutos metía libros de demostración entre tus copias reales
// (y la rotación borraba las más viejas de verdad) o los subía a tu bucket.
const SIN_S3 = { BACKUP_S3_BUCKET: '', BACKUP_S3_ACCESS_KEY: '', BACKUP_S3_SECRET_KEY: '', BACKUP_S3_ENDPOINT: '' };
// Y sin canales de aviso ni clave de Anthropic (lote K, K11): dotenv rellena con el .env de quien
// corre los tests lo que aquí falta, y «Generar el de hoy» avisa por todos los canales
// configurados. En una máquina con Telegram en el .env, cada pasada de los e2e mandaba un resumen
// de demostración al Telegram de verdad. Vacías y no ausentes: dotenv no pisa una que ya existe.
const SIN_AVISOS = Object.fromEntries(
  [
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ASISTENTE_CHATS', 'WEBHOOK_URL',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_TO',
    'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  ].map((k) => [k, '']),
);
const env = {
  ...process.env,
  ...SIN_S3,
  ...SIN_AVISOS,
  DATA_DIR,
  BACKUP_DIR: path.join(DATA_DIR, 'backups'),
  PORT: '7390',
  APP_AUTH: 'off',
  ODDS_API_KEY: '',
  THE_ODDS_API_KEY: '',
  AUTO_REFRESH_MINUTES: '0',
  // Sin el trabajo «resultados» (lote K, K9): a los 5 minutos bajaba resultados de internet, y la
  // batería dura más; lo que llegaba cambiaba los datos debajo de las pruebas. Los tests nunca
  // usan la red.
  RESULTS_REFRESH_HOURS: '0',
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
// La copia para el servidor con contraseña, ANTES de arrancar ninguno: dos servidores sobre el
// mismo fichero migrarían a la vez.
const DATA_DIR_AUTH = fs.mkdtempSync(path.join(os.tmpdir(), 'predictor-e2e-auth-'));
fs.cpSync(DATA_DIR, DATA_DIR_AUTH, { recursive: true });
const envAuth = { ...env, DATA_DIR: DATA_DIR_AUTH, BACKUP_DIR: path.join(DATA_DIR_AUTH, 'backups'), PORT: '7391', APP_AUTH: 'on', APP_PASSWORD: 'contrasena-de-pruebas-e2e' };

const arranca = (e) => spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server', 'src', 'index.ts')], { cwd: ROOT, env: e, stdio: 'inherit' });
const hijos = [arranca(env), arranca(envAuth)];
const para = (senal) => hijos.forEach((h) => h.kill(senal));
for (const h of hijos) {
  h.on('exit', (code) => {
    para('SIGTERM');
    process.exit(code ?? 0);
  });
}
process.on('SIGTERM', () => para('SIGTERM'));
process.on('SIGINT', () => para('SIGINT'));
