// `npm run auditoria:copia` de punta a punta: una copia de carpeta hecha con la app en marcha (con
// commits que solo están en el -wal), una predicción escrita tarde y una apuesta vencida. La
// auditoría tiene que contarlo todo y no tocar ni un byte de la copia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { TRIGGERS_PREPARTIDO } = await import('../prematch/tiempo.ts');
const { ledgerize } = await import('../db/ledgerize.ts');
const { LEDGER_SCHEMA } = await import('../db/layout.ts');
const { sha256DeFichero } = await import('../db/consolidar.ts');

const SERVIDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('la auditoría de una copia en caliente cuenta lo del -wal, lo tardío y lo vencido, y no toca la copia', () => {
  const db = getDb();
  const pref = LEDGER_SCHEMA === 'main' ? '' : `${LEDGER_SCHEMA}.`;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec(`PRAGMA ${LEDGER_SCHEMA}.wal_autocheckpoint = 0; PRAGMA wal_autocheckpoint = 0`);
  // Una fila tardía de antes de la migración 23 (sin el trigger) y una a tiempo, sin resultado.
  db.exec(`DROP TRIGGER ${pref}nhl_prediction_log_prepartido`);
  const nhl = db.prepare(
    `INSERT INTO nhl_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, predicted_at)
     VALUES (?, 'nhl', ?, 'EDM', 'ANA', 'Edmonton Oilers', 'Anaheim Ducks', 0.6, ?)`,
  );
  nhl.run('nhl|2026-10-10|EDM|ANA', '2026-10-10T02:00:00Z', '2026-10-10T02:20:00.000Z');
  nhl.run('nhl|2026-10-11|EDM|CGY', '2026-10-11T02:00:00Z', '2026-10-10T20:00:00.000Z');
  db.exec(ledgerize(TRIGGERS_PREPARTIDO, LEDGER_SCHEMA));
  db.prepare(
    `INSERT INTO paper_bets (placed_at, sport, match_key, event_id, label, selection, p_model, p_market, odds, stake, bankroll_at, commence_time)
     VALUES ('2026-10-10T20:00:00.000Z', 'nhl', 'nhl|2026-10-11|EDM|CGY', 'ev-a', 'EDM vs CGY', 'Edmonton Oilers', 0.6, 0.5, 2.0, 10, 1000, '2026-10-11T02:00:00Z')`,
  ).run();
  db.prepare("INSERT INTO ingestion_runs (source, started_at, status) VALUES ('marca', '2026-10-14T12:00:00.000Z', 'ok')").run();

  // La copia de carpeta, con la base aún abierta: lo último está en los -wal.
  const copia = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'copia-12oct-'));
  for (const f of fs.readdirSync(process.env.DATA_DIR!)) {
    if (/^(ledger|history)\.db(-wal)?$/.test(f)) fs.copyFileSync(path.join(process.env.DATA_DIR!, f), path.join(copia, f));
  }
  assert.ok(fs.existsSync(path.join(copia, 'ledger.db-wal')), 'la copia lleva su -wal');
  const huellas = () => Object.fromEntries(fs.readdirSync(copia).map((f) => [f, sha256DeFichero(path.join(copia, f))]));
  const antes = huellas();

  const salida = path.join(fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'auditoria-')), 'informe');
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/scripts/auditoriaCopia.ts', copia, '--salida', salida], {
    cwd: SERVIDOR,
    env: { ...process.env, INIT_CWD: SERVIDOR, NODE_OPTIONS: '--experimental-sqlite --disable-warning=ExperimentalWarning' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.deepEqual(huellas(), antes, 'ni un byte de la copia');

  const informe = JSON.parse(fs.readFileSync(path.join(salida, 'informe.json'), 'utf8'));
  assert.equal(informe.ahora, '2026-10-14T12:00:00.000Z', '«ahora» es lo último que escribió la app');
  const ledger = informe.consolidacion.find((b: { base: string }) => b.base === 'ledger.db');
  assert.ok(ledger.diferencias.some((d: { tabla: string; soloBase: number; conWal: number }) => d.tabla === 'nhl_prediction_log' && d.conWal - d.soloBase === 2), 'las dos filas solo estaban en el -wal');
  assert.deepEqual(ledger.verificacion, []);
  assert.deepEqual(informe.prepartido.tardias.map((t: { match_key: string }) => t.match_key), ['nhl|2026-10-10|EDM|ANA']);
  assert.match(informe.prepartido.sinFinal.find((s: { match_key: string }) => s.match_key === 'nhl|2026-10-10|EDM|ANA').porque, /en o después del inicio/);
  assert.deepEqual(informe.apuestasVencidas.map((a: { match_key: string }) => a.match_key), ['nhl|2026-10-11|EDM|CGY']);
  assert.equal(informe.vencidas.total.predicciones, 2);
  assert.match(fs.readFileSync(path.join(salida, 'resumen.md'), 'utf8'), /Filas del registro escritas en o después del inicio: 1/);
  // Sin ninguna versión de política en la copia: la de fábrica se siembra en la copia de trabajo,
  // como haría la app al arrancar, y el informe lo dice (revisión data-guardian).
  assert.equal(informe.frenoFuenteAtrasada.politica.versionesGuardadas, 0);
  assert.equal(informe.frenoFuenteAtrasada.politica.sembradaEnLaCopiaDeTrabajo, true);
  assert.ok(informe.tablasVacias.some((t: { tabla: string }) => t.tabla === 'policy_versions'), 'policy_versions estaba vacía en la copia');
  assert.match(fs.readFileSync(path.join(salida, 'resumen.md'), 'utf8'), /se sembró en la copia de trabajo/);
});
