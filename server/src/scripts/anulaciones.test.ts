// Revisión quant del 27 de octubre: el servidor aplica los interruptores apagados desde Ajustes
// (`features.anulaciones`) porque app.ts instala su lector al arrancar; los scripts no lo
// hacían. `npm run paper` colocaba apuestas con la política guardada y el laboratorio de
// estrategias aunque el dueño los hubiera apagado, y `npm run doctor` describía otro freno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../test/setup.ts';

const { getDb, setMeta } = await import('../db.ts');
const { politicaPorDefecto } = await import('../staking/policyStore.ts');
const { CLAVE_ANULACIONES } = await import('../features.ts');

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('un script que abre la base aplica los interruptores apagados desde Ajustes, como el servidor', () => {
  const db = getDb();
  // Una política guardada que apaga el freno, y el dueño que apaga desde Ajustes la política
  // versionada y el laboratorio. El servidor aplica entonces las constantes de fábrica (freno a 48 h).
  const v1 = politicaPorDefecto();
  v1.abstencion.archivoAtrasadoHoras = 0;
  db.prepare("INSERT INTO policy_versions (created_at, parent_id, config, hash, nota, origen) VALUES ('2026-10-01T00:00:00.000Z', NULL, ?, 'v1', 'v1', 'seed')").run(JSON.stringify(v1));
  setMeta(CLAVE_ANULACIONES, JSON.stringify({ 'politica.versionada': false, 'estrategias.laboratorio': false }));
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  // Otro proceso, como `npm run paper` o `npm run doctor`: abre la base y lee, sin app.ts.
  const guion = path.join(process.env.DATA_DIR!, 'script.mts');
  const de = (m: string) => JSON.stringify(pathToFileURL(path.join(SRC, m)).href);
  fs.writeFileSync(
    guion,
    // Sin red, como en los tests: el hijo no carga test/setup.ts (revisión data-guardian).
    `globalThis.fetch = async () => { throw new Error('sin red: proceso de prueba'); };
     const { getDb } = await import(${de('db.ts')});
     const { featureEncendida } = await import(${de('features.ts')});
     const { horasArchivoAtrasado } = await import(${de('trust/decision.ts')});
     const antes = featureEncendida('politica.versionada');
     getDb();
     console.log(JSON.stringify({ antes, versionada: featureEncendida('politica.versionada'), laboratorio: featureEncendida('estrategias.laboratorio'), horas: horasArchivoAtrasado() }));`,
  );
  const r = spawnSync(process.execPath, ['--import', 'tsx', guion], {
    cwd: path.join(SRC, '..'),
    env: { ...process.env, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  const visto = JSON.parse(r.stdout.trim().split('\n').at(-1)!);
  assert.equal(visto.antes, true, 'sin abrir la base no hay de dónde leerlas: manda config/features.json');
  assert.equal(visto.versionada, false, 'con la base abierta, la anulación de Ajustes');
  assert.equal(visto.laboratorio, false);
  assert.equal(visto.horas, 48, 'política sin versionar → constantes de fábrica, como el servidor');
});
