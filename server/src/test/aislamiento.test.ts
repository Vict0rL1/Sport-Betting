// Revisión de data-guardian (12 de octubre): BACKUP_DIR es una ruta global, no de un DATA_DIR. Con
// el BACKUP_DIR de tu .env, los tests veían tus copias reales como «huellas» de un libro mayor
// perdido (161 de 434 fallaban), un test escribía en esa carpeta y, con BACKUP_S3_*, una copia de
// demostración podía subir a tu bucket. Los tests usan la carpeta de copias de su propio DATA_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVIDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('con BACKUP_DIR y BACKUP_S3_* en el entorno, los tests usan la carpeta de su DATA_DIR y ningún bucket', () => {
  const salida = execFileSync(
    process.execPath,
    ['--import', 'tsx', '--import', './src/test/setup.ts', '-e', 'const e = process.env; console.log(JSON.stringify({ datos: e.DATA_DIR, copias: e.BACKUP_DIR, bucket: e.BACKUP_S3_BUCKET ?? "", clave: e.BACKUP_S3_ACCESS_KEY ?? "", secreto: e.BACKUP_S3_SECRET_KEY ?? "" }))'],
    { cwd: SERVIDOR, encoding: 'utf8', env: { ...process.env, BACKUP_DIR: '/tmp/mis-copias-reales', BACKUP_S3_BUCKET: 'mi-bucket', BACKUP_S3_ACCESS_KEY: 'clave', BACKUP_S3_SECRET_KEY: 'secreto' } },
  );
  const e = JSON.parse(salida.trim().split('\n').pop()!) as Record<string, string>;
  assert.equal(e.copias, path.join(e.datos, 'backups'));
  assert.deepEqual([e.bucket, e.clave, e.secreto], ['', '', '']);
});

// Lote I: cada proceso de test creaba un DATA_DIR temporal y no lo borraba nunca (más de 8.000
// carpetas con sus bases en /tmp). Ahora el proceso que lo crea lo borra al salir.
const datosDeUnProceso = (entorno: NodeJS.ProcessEnv = {}) => {
  const salida = execFileSync(process.execPath, ['--import', 'tsx', '--import', './src/test/setup.ts', '-e', 'require("node:fs").writeFileSync(require("node:path").join(process.env.DATA_DIR, "x.db"), "x"); console.log(process.env.DATA_DIR)'], {
    cwd: SERVIDOR,
    encoding: 'utf8',
    env: { ...process.env, ...entorno },
  });
  return salida.trim().split('\n').pop()!;
};

test('el DATA_DIR temporal de un proceso de test se borra al salir, con lo que tenga dentro', () => {
  const dir = datosDeUnProceso();
  assert.match(path.basename(dir), /^predicciones-test-/);
  assert.equal(fs.existsSync(dir), false, `${dir} sigue ahí`);
});

test('con CONSERVAR_DATOS_TEST=1 se queda, para mirarlo después', () => {
  const dir = datosDeUnProceso({ CONSERVAR_DATOS_TEST: '1' });
  assert.equal(fs.existsSync(path.join(dir, 'x.db')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
