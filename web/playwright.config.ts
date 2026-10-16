import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

// Chromium: el que diga PLAYWRIGHT_CHROMIUM, o el preinstalado del contenedor si existe, o el
// que `playwright install` haya bajado (CI).
const chromium = process.env.PLAYWRIGHT_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// Humo de punta a punta: el servidor construido sirviendo web/dist con la base de
// demostración (scripts/e2e-server.mjs la prepara). Chromium viene instalado en la máquina
// de CI y en el contenedor de desarrollo; no se descarga nada.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  // Lote I: un e2e que falla de vez en cuando («tenis punto a punto», 12 de octubre) no dejaba nada
  // que mirar. Con la traza (red, consola, DOM y capturas de cada paso) en web/test-results, el
  // siguiente fallo trae su causa; en CI se sube como artefacto.
  use: { baseURL: process.env.E2E_URL ?? 'http://localhost:7390', locale: 'es-ES', trace: 'retain-on-failure', launchOptions: chromium ? { executablePath: chromium } : {} },
  webServer: {
    command: 'node ../scripts/e2e-server.mjs',
    url: 'http://localhost:7390/healthz',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  reporter: process.env.CI ? 'github' : 'list',
});
