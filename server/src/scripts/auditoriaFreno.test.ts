// `npm run auditoria:copia` y el freno por fuente atrasada (auditoría del 22 de octubre, hallazgo 1):
// la copia del 12 de octubre salía con 12 competiciones «donde ya no se apostaría», ocho de ellas
// sin motivo, y con una política (v1) que ni siquiera tiene `abstencion.archivoAtrasadoHoras`: el
// freno estaba apagado. El informe tiene que decir la política y el umbral que de verdad se aplican,
// separar lo que frena de lo que frenaría si se encendiera, y no contar como freno lo que no tiene
// prueba suficiente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { politicaPorDefecto, nuevaVersion, olvidarPolitica } = await import('../staking/policyStore.ts');
const { sha256DeFichero } = await import('../db/consolidar.ts');
const { setMeta } = await import('../db.ts');
const { CLAVE_ANULACIONES } = await import('../features.ts');

const SERVIDOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = getDb();

/** Copia de carpeta de la base de este test, auditada: el informe, el resumen y las versiones de política de la copia de trabajo. */
function auditar(): { informe: Record<string, any>; resumen: string; versionesTrabajo: number } {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const copia = fs.mkdtempSync(path.join(process.env.DATA_DIR!, 'copia-'));
  for (const f of fs.readdirSync(process.env.DATA_DIR!)) {
    if (/^(ledger|history)\.db(-wal)?$/.test(f)) fs.copyFileSync(path.join(process.env.DATA_DIR!, f), path.join(copia, f));
  }
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
  const trabajo = new DatabaseSync(path.join(salida, 'app', 'ledger.db'), { readOnly: true });
  const versionesTrabajo = Number((trabajo.prepare('SELECT COUNT(*) AS n FROM policy_versions').get() as { n: number }).n);
  trabajo.close();
  return { informe: JSON.parse(fs.readFileSync(path.join(salida, 'informe.json'), 'utf8')), resumen: fs.readFileSync(path.join(salida, 'resumen.md'), 'utf8'), versionesTrabajo };
}

// La NHL: dos partidos de días distintos que la fuente no tiene (prueba suficiente). La Premier: uno
// solo (no basta: un aplazado no frena la liga). «Ahora» = lo último escrito, el 14 de octubre.
const nhl = db.prepare(
  `INSERT INTO nhl_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, predicted_at)
   VALUES (?, 'nhl', ?, 'EDM', ?, 'Edmonton Oilers', 'Rival', 0.6, ?)`,
);
nhl.run('nhl|2026-10-08|EDM|ANA', '2026-10-08T02:00:00Z', 'ANA', '2026-10-07T20:00:00.000Z');
nhl.run('nhl|2026-10-09|EDM|CGY', '2026-10-09T02:00:00Z', 'CGY', '2026-10-08T20:00:00.000Z');
db.prepare(
  `INSERT INTO fb_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, predicted_at)
   VALUES ('epl|ARS|CHE|20261009', 'epl', '2026-10-09T14:00:00Z', 'ARS', 'CHE', 'Arsenal', 'Chelsea', 0.5, 0.25, 0.25, '2026-10-08T20:00:00.000Z')`,
).run();
db.prepare("INSERT INTO ingestion_runs (source, started_at, status) VALUES ('marca', '2026-10-14T12:00:00.000Z', 'ok')").run();

test('con una política anterior al freno (sin archivoAtrasadoHoras) no hay restricciones activas: solo avisos, y nunca sin motivo', () => {
  // La v1 de la copia del 12 de octubre: guardada antes de que existiera la clave.
  const v1 = politicaPorDefecto() as unknown as { abstencion: Record<string, unknown> };
  delete v1.abstencion.archivoAtrasadoHoras;
  db.prepare("INSERT INTO policy_versions (created_at, parent_id, config, hash, nota, origen) VALUES ('2026-09-01T00:00:00.000Z', NULL, ?, 'v1-sin-freno', 'v1', 'seed')").run(JSON.stringify(v1));
  olvidarPolitica();

  const { informe, resumen, versionesTrabajo } = auditar();
  const f = informe.frenoFuenteAtrasada;
  assert.ok(f, 'el informe dice el estado del freno');
  assert.equal(f.politica.version, 1);
  assert.equal(f.politica.archivoAtrasadoHoras, null, 'la v1 no tiene la clave: DESCONOCIDO no, ausente');
  assert.equal(f.horasEfectivas, 0);
  assert.equal(f.activo, false);
  assert.deepEqual(f.restricciones, [], 'apagado: ninguna competición frenada');
  assert.deepEqual(f.avisos.competiciones.map((c: { competicion: string }) => c.competicion), ['nhl'], 'la NHL frenaría si se encendiera');
  assert.equal(f.avisos.horas, 48);
  for (const c of [...f.restricciones, ...f.avisos.competiciones]) assert.ok(c.motivo, `${c.competicion}: sin motivo no se lista como freno ni como aviso`);
  assert.deepEqual(f.sinPruebaSuficiente.map((c: { competicion: string }) => c.competicion), ['epl'], 'la Premier: fuente atrasada con un solo día de prueba');
  assert.equal(informe.competicionesFrenadas, undefined, 'el listado viejo, sin política ni motivo, ya no está');
  assert.match(resumen, /freno.*apagado/i);
  assert.doesNotMatch(resumen, /donde ya no se apostaría/);
  // La auditoría no crea versiones de política: la copia de trabajo sigue con la v1 sola.
  assert.equal(f.politica.versionesGuardadas, 1);
  assert.equal(versionesTrabajo, 1, 'después de auditar, la copia de trabajo sigue con una');
  assert.equal(f.politica.interruptorAnulado, null, 'sin anulación desde Ajustes');
});

test('con una versión que enciende el freno, la NHL sale como restricción activa con su umbral', () => {
  // La versión nueva se crea como la crearía el dueño (nuevaVersion: nunca reescribe la v1).
  const v2 = nuevaVersion({ abstencion: { archivoAtrasadoHoras: 48 } }, 'enciende el freno', 'cli', new Date('2026-10-13T00:00:00.000Z'));
  assert.equal(v2.id, 2);
  const { informe, resumen } = auditar();
  const f = informe.frenoFuenteAtrasada;
  assert.equal(f.politica.version, 2);
  assert.equal(f.politica.archivoAtrasadoHoras, 48);
  assert.equal(f.horasEfectivas, 48);
  assert.equal(f.activo, true);
  assert.deepEqual(f.restricciones.map((c: { competicion: string }) => c.competicion), ['nhl']);
  assert.match(f.restricciones[0].motivo, /más de 48 h/);
  assert.deepEqual(f.avisos.competiciones, [], 'encendido: lo que frena es restricción, no aviso');
  assert.deepEqual(f.sinPruebaSuficiente.map((c: { competicion: string }) => c.competicion), ['epl']);
  assert.match(resumen, /Restricciones activas.*nhl/);
  assert.equal(f.politica.versionesGuardadas, 2);
});

test('con el interruptor de la política versionada apagado desde Ajustes, manda lo de fábrica, como en el servidor (revisión data-guardian)', () => {
  // Una v3 que apaga el freno, y el dueño que apaga desde Ajustes la política versionada: el servidor
  // aplica entonces las constantes de fábrica (48 h) y frena; la auditoría tiene que decir lo mismo.
  nuevaVersion({ abstencion: { archivoAtrasadoHoras: 0 } }, 'apaga el freno', 'cli', new Date('2026-10-13T12:00:00.000Z'));
  // Primero sin anulación: la clave a 0 no se enciende sola con el valor de fábrica (revisión quant),
  // cada competición dice con qué horas se contó, y las vencidas de 48 h no llevan la marca del freno.
  const apagado = auditar();
  const fa = apagado.informe.frenoFuenteAtrasada;
  assert.equal(fa.activo, false);
  assert.equal(fa.politica.archivoAtrasadoHoras, 0);
  assert.match(fa.avisos.nota, /pide poner un valor/);
  assert.deepEqual(fa.avisos.competiciones.map((c: { competicion: string; horas: number }) => [c.competicion, c.horas]), [['nhl', 48]]);
  assert.deepEqual(fa.sinPruebaSuficiente.map((c: { competicion: string; horas: number }) => [c.competicion, c.horas]), [['epl', 48]]);
  assert.equal(apagado.informe.vencidas.freno, undefined);
  assert.match(apagado.resumen, /Fuente atrasada a más de 48 h sin prueba suficiente/);

  setMeta(CLAVE_ANULACIONES, JSON.stringify({ 'politica.versionada': false }));
  try {
    const { informe, resumen } = auditar();
    const f = informe.frenoFuenteAtrasada;
    assert.equal(f.politica.interruptorVersionada, false);
    assert.equal(f.politica.interruptorAnulado, false, 'apagado desde Ajustes, no en config/features.json');
    assert.equal(f.politica.version, null);
    assert.equal(f.horasEfectivas, 48);
    assert.equal(f.activo, true);
    assert.deepEqual(f.restricciones.map((c: { competicion: string }) => c.competicion), ['nhl']);
    assert.match(resumen, /sin versionar/);
  } finally {
    setMeta(CLAVE_ANULACIONES, '{}');
  }
});

test('si la política guardada no se puede leer, se dice, y se aplica lo de fábrica como en el servidor (revisión data-guardian)', () => {
  db.prepare("INSERT INTO policy_versions (created_at, parent_id, config, hash, nota, origen) VALUES ('2026-10-13T18:00:00.000Z', 3, 'esto no es JSON', 'roto', 'rota', 'cli')").run();
  olvidarPolitica();
  const { informe, resumen } = auditar();
  const f = informe.frenoFuenteAtrasada;
  assert.equal(f.politica.version, null);
  assert.equal(f.horasEfectivas, 48);
  assert.doesNotMatch(f.lectura, /vnull/);
  assert.match(f.lectura, /no se puede leer/i);
  assert.doesNotMatch(resumen, /vnull/);
});
