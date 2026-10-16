// `npm run doctor -- --probar` de verdad, en un proceso aparte, con The Odds API simulada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('doctor --probar: secciones, cupo, sondeo y resultado', () => {
  const r = spawnSync(
    process.execPath,
    ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', '--import', 'tsx', '--import', './src/test/fakeOddsApi.ts', 'src/scripts/doctor.ts', '--probar'],
    {
      cwd: serverDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        ODDS_API_KEY: '0123456789abcdef0123456789abcdef', // secret-scan:ignore (clave falsa de test)
        DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-e2e-')),
        PORT: '65531',
      },
      timeout: 60_000,
    },
  );
  // Sin los códigos de color de la terminal (ESC[…m).
  const out = (r.stdout + r.stderr).replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
  for (const s of ['CONFIGURACIÓN', 'THE ODDS API', 'DEPORTES', 'BASE DE DATOS', 'OPERACIÓN', 'SERVIDOR Y PANTALLA', 'RESULTADO']) {
    assert.match(out, new RegExp(s), `falta la sección ${s}\n${out}`);
  }
  assert.match(out, /✓ API key válida/);
  assert.match(out, /Créditos restantes: 463 · usados este mes: 37/);
  assert.match(out, /sondeo basketball_nba: 1 eventos, 1 con cuotas · mercados: h2h · casas \(1\): pinnacle/);
  assert.match(out, /No existe la base de datos/);
  assert.match(out, /El backend no responde/);
  assert.ok(!out.includes('0123456789abcdef0123456789abcdef'), 'la clave completa no puede imprimirse');
  assert.equal(r.status, 1, 'sin base de datos hay error, y el código de salida lo dice');
});

// Lote I: cuando la base se niega a abrir (falta el libro mayor y hay huellas de que lo hubo), el
// doctor lo dice como un hallazgo con su remedio, en vez de morir con una traza.
test('doctor: si la base se niega a abrir, lo dice como hallazgo con el remedio, sin traza, y no crea nada', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-sin-libro-'));
  fs.writeFileSync(path.join(dataDir, 'ledger.db.existe'), 'libro mayor creado por la app\n');
  const r = spawnSync(process.execPath, ['--experimental-sqlite', '--disable-warning=ExperimentalWarning', '--import', 'tsx', 'src/scripts/doctor.ts', '--sin-red'], {
    cwd: serverDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      ODDS_API_KEY: '',
      THE_ODDS_API_KEY: '',
      DATA_DIR: dataDir,
      BACKUP_DIR: path.join(dataDir, 'backups'),
      BACKUP_S3_BUCKET: '',
      LEDGER_NUEVO: '',
      PORT: '65532',
    },
    timeout: 60_000,
  });
  const out = (r.stdout + r.stderr).replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
  assert.match(out, /DATOS Y COPIAS/, out);
  assert.match(out, /La base no se abre/, out);
  assert.match(out, /npm run restore/, out);
  assert.match(out, /RESULTADO/, out);
  assert.doesNotMatch(out, /^\s+at .+\(.+:\d+:\d+\)$/m, 'sin traza de pila');
  assert.equal(r.status, 1);
  assert.equal(fs.existsSync(path.join(dataDir, 'ledger.db')), false, 'no crea un libro mayor vacío');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
