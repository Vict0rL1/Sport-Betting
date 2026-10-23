// Auditoría del 17 de octubre, punto 2: registros «pre-partido» escritos después del inicio.
//
// Las filas tardías que ya existen (las de la copia del 12 de octubre) se simulan quitando el
// trigger nuevo en la base de usar y tirar del test, metiéndolas y volviéndolo a poner: es como
// estaban antes de la migración 23.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { clasePrepartido, empezado, TRIGGERS_PREPARTIDO, REGISTROS } = await import('./tiempo.ts');
const { predicciones } = await import('../evaluation/live.ts');
const { getNhlTrackRecord } = await import('../nhl/trackRecord.ts');
const { freezeFinals } = await import('./snapshots.ts');
const { buscarEnArchivo } = await import('../archivo/index.ts');
const { ledgerize } = await import('../db/ledgerize.ts');
const { LEDGER_SCHEMA } = await import('../db/layout.ts');

const db = getDb();
const pref = LEDGER_SCHEMA === 'main' ? '' : `${LEDGER_SCHEMA}.`;

/** Una fila del registro de la NHL, ya con resultado (el local gana 3-2). */
const insertarNhl = (mk: string, commence: string, predicha: string, probLocal = 0.6) =>
  db
    .prepare(
      `INSERT INTO nhl_prediction_log (match_key, commence_time, home_id, away_id, home_name, away_name, prob_home, predicted_at, home_goals, away_goals, resolved_at)
       VALUES (?, ?, 'EDM', 'ANA', 'Edmonton Oilers', 'Anaheim Ducks', ?, ?, 3, 2, ?)`,
    )
    .run(mk, commence, probLocal, predicha, '2026-10-13T08:00:00.000Z');

test('2: «empezado» y la clase comparan instantes, no texto', () => {
  // Como texto, '…23:00:30.000Z' < '…23:00Z' (':' < 'Z'), aunque sea 30 s DESPUÉS del inicio.
  const [predicha, inicio] = ['2026-10-12T23:00:30.000Z', '2026-10-12T23:00Z'];
  assert.ok(predicha < inicio, 'el agujero de comparar texto');
  assert.equal(clasePrepartido('2026-10-12T23:00:30.000Z', '2026-10-12T23:00Z'), 'tardia');
  assert.equal(clasePrepartido('2026-10-12T22:59:59.999Z', '2026-10-12T23:00:00Z'), 'prepartido');
  assert.equal(clasePrepartido('2026-10-12T23:00:00.000Z', '2026-10-12T23:00:00Z'), 'tardia', 'en el inicio ya no es antes');
  assert.equal(clasePrepartido('2026-10-12T22:30:00.000Z', '2026-10-12T19:00:00-04:00'), 'prepartido', 'con desfase horario');
  assert.equal(clasePrepartido('2026-10-12T23:30:00.000Z', '2026-10-12T19:00:00-04:00'), 'tardia');
  assert.equal(clasePrepartido('2026-10-12T22:00:00.000Z', null), 'sin_hora');
  assert.equal(empezado('2026-10-12T23:00Z', new Date('2026-10-12T23:00:30Z')), true);
  assert.equal(empezado('no es una fecha'), null);
});

test('2: la base no guarda una predicción del registro escrita en o después del inicio (los siete registros)', () => {
  for (const t of REGISTROS) {
    const hay = db.prepare(`SELECT COUNT(*) AS n FROM ${pref}sqlite_master WHERE type = 'trigger' AND name = ?`).get(`${t}_prepartido`) as { n: number };
    assert.equal(hay.n, 1, `${t} tiene su trigger`);
  }
  insertarNhl('nhl|antes', '2026-10-12T23:00:00Z', '2026-10-12T20:00:00.000Z');
  insertarNhl('nhl|despues', '2026-10-12T23:00:00Z', '2026-10-12T23:10:00.000Z');
  insertarNhl('nhl|segundos', '2026-10-12T23:00Z', '2026-10-12T23:00:30.000Z');
  const guardadas = (db.prepare("SELECT match_key FROM nhl_prediction_log WHERE match_key LIKE 'nhl|%' ORDER BY match_key").all() as { match_key: string }[]).map((r) => r.match_key);
  assert.deepEqual(guardadas, ['nhl|antes'], 'las dos tardías se ignoran sin romper a quien escribe');
});

test('2: las tardías que ya había se quedan, con su procedencia, y la evaluación pre-partido no las cuenta', async () => {
  // Como antes de la migración 23.
  db.exec(`DROP TRIGGER ${pref}nhl_prediction_log_prepartido`);
  insertarNhl('nhl|legado-tarde', '2026-10-11T23:00:00Z', '2026-10-11T23:20:00.000Z', 0.9);
  insertarNhl('nhl|legado-segundos', '2026-10-11T23:00Z', '2026-10-11T23:00:30.000Z', 0.9);
  db.exec(ledgerize(TRIGGERS_PREPARTIDO, LEDGER_SCHEMA));

  const enVivo = predicciones('nhl');
  assert.equal(enVivo.length, 1, 'solo «nhl|antes»');
  assert.equal(enVivo[0].p[0], 0.6);
  assert.equal(getNhlTrackRecord().resolved, 1);

  // Siguen en el registro: no se borra ni se reescribe nada.
  const n = (db.prepare("SELECT COUNT(*) AS n FROM nhl_prediction_log WHERE match_key LIKE 'nhl|legado%'").get() as { n: number }).n;
  assert.equal(n, 2);

  // El archivo las enseña, marcadas, y no las cuenta en el resumen.
  const a = buscarEnArchivo({ sport: 'nhl' });
  const momento = Object.fromEntries(a.filas.map((f) => [f.matchKey, f.momento]));
  assert.equal(momento['nhl|antes'], 'prepartido');
  assert.equal(momento['nhl|legado-tarde'], 'tardia');
  assert.equal(momento['nhl|legado-segundos'], 'tardia', 'aunque como texto parezca anterior');
  assert.equal(a.resumen.resueltas, 1);
  assert.equal(a.resumen.noPrepartido, 2);

  // Revisión quant: tampoco cuentan como «en vivo» en la confianza del sistema ni en «¿Acertó?».
  const { confianzaDelSistema } = await import('../evaluation/system.ts');
  assert.equal(confianzaDelSistema().prediccionesEnVivo, 1);
  const { historialReciente } = await import('../today.ts');
  const h = historialReciente(new Date('2026-10-14T00:00:00Z'), 7);
  assert.equal(h.porOrigen['en vivo'].total, 1, 'las dos tardías no son predicciones en vivo');
});

test('2: la API del archivo entrega «momento» y «noPrepartido» (el esquema de respuesta no los quita)', async () => {
  const { buildApp } = await import('../app.ts');
  const { configAuth } = await import('../auth/mode.ts');
  const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  try {
    const res = await app.inject({ method: 'GET', url: '/api/archivo?sport=nhl' });
    assert.equal(res.statusCode, 200);
    const cuerpo = res.json() as { filas: { matchKey: string; momento: string }[]; resumen: { noPrepartido: number } };
    assert.equal(cuerpo.resumen.noPrepartido, 2);
    assert.equal(cuerpo.filas.find((f) => f.matchKey === 'nhl|legado-tarde')?.momento, 'tardia');
    assert.equal(cuerpo.filas.find((f) => f.matchKey === 'nhl|antes')?.momento, 'prepartido');
  } finally {
    await app.close();
  }
});

test('2: la final pre-partido no se congela desde una fila tardía (el caso EDM–ANA sin captura)', () => {
  const r = freezeFinals(new Date('2026-10-14T00:00:00Z'));
  const congeladas = (db.prepare("SELECT match_key, source FROM prematch_final WHERE sport = 'nhl' ORDER BY match_key").all() as { match_key: string; source: string }[]).map((x) => x.match_key);
  assert.deepEqual(congeladas, ['nhl|antes'], 'las tardías no tienen final pre-partido: no la tuvieron');
  assert.ok(r.congeladas >= 1);
});

test('2: una apuesta de papel no entra si se coloca en o después del inicio, aunque como texto parezca antes', () => {
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO paper_bets (placed_at, sport, match_key, event_id, label, selection, p_model, p_market, odds, stake, bankroll_at, commence_time)
           VALUES ('2026-10-12T23:00:30.000Z', 'nhl', 'k', 'ev-tarde', 'x', 'EDM', 0.6, 0.5, 2.1, 10, 1000, '2026-10-12T23:00Z')`,
        )
        .run(),
    /en o después del inicio/,
  );
});
