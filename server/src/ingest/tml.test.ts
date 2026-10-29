// Auditoría del 17 de octubre, punto 4: el archivo de TML trae filas cortadas y partidos repetidos,
// y se metían tal cual. Y punto 3: la temporada en curso se bajaba una vez y no se volvía a pedir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simularFetch } from '../test/setup.ts';

const { leerTml } = await import('./tmlLectura.ts');
const { getDb } = await import('../db.ts');
const { ingestTour, tourConfigs, silenciarProgreso } = await import('./sackmann.ts');
silenciarProgreso();

const CAB = 'tourney_id,tourney_name,surface,draw_size,tourney_level,indoor,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,winner_rank,winner_rank_points,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,loser_rank,loser_rank_points,score,best_of,round,minutes,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_SvGms,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_SvGms,l_bpSaved,l_bpFaced';
const N = CAB.split(',').length;

/** Una fila de 50 campos: el torneo, el número de partido, los dos, el marcador, la ronda y las estadísticas. */
function fila(o: { t?: string; num: string; w: string; l: string; score?: string; ronda?: string; wSvpt?: number; lSvpt?: number; fecha?: string }): string {
  const w = [7, 1, o.wSvpt ?? 48, 38, 27, 6, 9, 1, 2];
  const l = [3, 2, o.lSvpt ?? 52, 30, 20, 10, 9, 4, 7];
  return [
    o.t ?? '2025-495', 'Torneo', 'Hard', 32, 'A', 'O', o.fecha ?? '20250210', o.num,
    o.w, '', '', `Jugador ${o.w}`, 'R', 185, 'ESP', 25.1, 20, 1500,
    o.l, '', '', `Jugador ${o.l}`, 'R', 183, 'FRA', 27.3, 40, 900,
    o.score ?? '6-3 6-4', 3, o.ronda ?? 'R32', 80, ...w, ...l,
  ].join(',');
}

test('4: una fila con campos de menos: si el resultado está entero se guarda sin estadísticas; si no, fuera', () => {
  const corta = fila({ num: '15', w: 'T0HA', l: 'B0PG', score: '4-3(4) 4-2 4-1', ronda: 'F' }).split(',').slice(0, 37).join(',').replace(/27$/, '2');
  const cortadisima = fila({ num: '16', w: 'AAAA', l: 'BBBB' }).split(',').slice(0, 25).join(',');
  const larga = fila({ num: '17', w: 'CCCC', l: 'DDDD' }) + ',x,y';
  const r = leerTml([CAB, fila({ num: '1', w: 'P001', l: 'P002' }), corta, cortadisima, larga].join('\n'), '2025.csv');

  assert.equal(r.filas.length, 2);
  const rec = r.filas[1];
  assert.deepEqual([rec.winner_id, rec.loser_id, rec.score, rec.round, rec.winner_rank], ['T0HA', 'B0PG', '4-3(4) 4-2 4-1', 'F', '20']);
  for (const c of CAB.split(',').filter((x) => /^[wl]_/.test(x))) assert.equal(rec[c], null, `${c}: DESCONOCIDO, ni el trozo que llegó`);
  assert.deepEqual(
    r.anomalias.map((a) => [a.linea, a.tipo, a.accion, a.idFuente]),
    [
      [3, 'campos_de_menos', 'recuperada', '15'],
      [4, 'campos_de_menos', 'descartada', '16'],
      [5, 'campos_de_mas', 'descartada', '17'],
    ],
  );
  assert.match(r.anomalias[0].detalle, new RegExp(`37 de ${N} campos.*w_1stWon='2'`));
});

test('4: un partido repetido con otro número de partido se guarda una vez; con estadísticas distintas, sin ellas', () => {
  const r = leerTml(
    [
      CAB,
      fila({ t: '2021-416', num: '14', w: 'FUC', l: 'NIS', score: '6-0 6-2', ronda: 'R64' }),
      fila({ t: '2021-416', num: '15', w: 'OTRO', l: 'MAS' }),
      fila({ t: '2021-416', num: '25', w: 'FUC', l: 'NIS', score: '6-0 6-2', ronda: 'R64' }),
      // El mismo partido (torneo, ronda, los dos y el marcador) con otras estadísticas del ganador.
      fila({ num: '75', w: 'N0BG', l: 'F724', score: '1-6 6-2 6-3', wSvpt: 111 }),
      fila({ num: '111', w: 'N0BG', l: 'F724', score: '1-6 6-2 6-3', wSvpt: 75 }),
      // Los mismos dos en la misma ronda con OTRO marcador: puede ser un round robin. Se quedan los dos.
      fila({ t: '2017-DC', num: '1', w: 'TC61', l: 'SM25', score: '6-3 6-4', ronda: 'RR' }),
      fila({ t: '2017-DC', num: '5', w: 'TC61', l: 'SM25', score: '7-5 6-1', ronda: 'RR' }),
    ].join('\n'),
    '2021.csv',
  );
  assert.deepEqual(
    r.filas.map((f) => `${f.tourney_id}#${f.match_num}`),
    ['2021-416#14', '2021-416#15', '2025-495#75', '2017-DC#1', '2017-DC#5'],
  );
  const conflicto = r.filas[2];
  assert.equal(conflicto.w_svpt, null, 'no se sabe cuál de las dos es la buena');
  assert.equal(conflicto.w_ace, null, 'el lado entero, como en serveStats');
  assert.equal(conflicto.l_svpt, '52', 'el perdedor coincide en las dos: se queda');
  assert.deepEqual(
    r.anomalias.map((a) => [a.linea, a.tipo, a.accion, a.idFuente]),
    [
      [4, 'duplicado_exacto', 'descartada', '25'],
      [5, 'duplicado_con_otros_datos', 'recuperada', '75'],
      [6, 'duplicado_con_otros_datos', 'descartada', '111'],
      [8, 'clave_repetida', 'conservada', '5'],
    ],
  );
  assert.match(r.anomalias[0].detalle, /igual que la línea 2 \(partido 14\)/);
});

test('4: sin un dato que identifica el partido, fuera; y un repetido con otra fecha, fuera los dos (no se inventa una)', () => {
  const sinFecha = fila({ num: '3', w: 'Q1', l: 'Q2' }).replace(',20250210,', ',,');
  const sinGanador = fila({ num: '4', w: '', l: 'Q2' });
  const r = leerTml(
    [CAB, fila({ num: '1', w: 'P1', l: 'P2' }), sinFecha, sinGanador, fila({ num: '5', w: 'R1', l: 'R2', fecha: '20250210' }), fila({ num: '6', w: 'R1', l: 'R2', fecha: '20250217' })].join('\n'),
    '2025.csv',
  );
  assert.deepEqual(r.filas.map((f) => f.match_num), ['1']);
  assert.deepEqual(
    r.anomalias.map((a) => [a.linea, a.tipo, a.accion]),
    [
      [3, 'faltan_datos', 'descartada'],
      [4, 'faltan_datos', 'descartada'],
      [5, 'duplicado_con_otros_datos', 'descartada'],
      [6, 'duplicado_con_otros_datos', 'descartada'],
    ],
  );
  assert.match(r.anomalias[0].detalle, /sin tourney_date/);
  assert.match(r.anomalias[2].detalle, /otra tourney_date/);
});

// ---------------------------------------------------------------------------
// De punta a punta: lo que se guarda, y que la temporada en curso se vuelve a pedir.
// ---------------------------------------------------------------------------
const anio = new Date().getUTCFullYear();
let servidas: Record<string, string> = {};
let red = true;
const pedidas: string[] = [];
simularFetch((url) => {
  pedidas.push(url);
  if (!red) throw new Error('sin red');
  const f = url.split('/').at(-1)!;
  return f in servidas ? new Response(servidas[f]) : new Response('no', { status: 404 });
});
const atp = tourConfigs().find((t) => t.id === 'atp')!;
const db = getDb();
const contar = () => (db.prepare("SELECT COUNT(*) AS n FROM matches WHERE tour = 'atp'").get() as { n: number }).n;

test('4: la ingesta guarda las anomalías con su fichero, su línea y su número de partido, y no las repite', async () => {
  servidas = {
    [`${anio - 2}.csv`]: [CAB, fila({ num: '1', w: 'P1', l: 'P2', fecha: `${anio - 2}0110` })].join('\n'),
    [`${anio - 1}.csv`]: [CAB, fila({ num: '1', w: 'P1', l: 'P3', fecha: `${anio - 1}0110` }), fila({ num: '2', w: 'P1', l: 'P3', fecha: `${anio - 1}0110` })].join('\n'),
    [`${anio}.csv`]: [CAB, fila({ num: '1', w: 'P2', l: 'P3', fecha: `${anio}0110` })].join('\n'),
  };
  const r = await ingestTour(atp, { fromYear: anio - 2, toYear: anio });
  assert.equal(r.matches, 3, 'el repetido de la temporada pasada no entra');
  const an = db.prepare("SELECT fuente, fichero, linea, tipo, accion, id_fuente FROM ingest_anomalias WHERE fuente = 'tml:atp'").all();
  assert.deepEqual(an.map((x) => ({ ...x })), [{ fuente: 'tml:atp', fichero: `${anio - 1}.csv`, linea: 3, tipo: 'duplicado_exacto', accion: 'descartada', id_fuente: '2' }]);
});

test('3: la temporada en curso (y la anterior) se vuelven a pedir; las cerradas salen de la copia', async () => {
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  servidas[`${anio}.csv`] += '\n' + fila({ num: '2', w: 'P3', l: 'P1', fecha: `${anio}0301` });
  servidas[`${anio - 2}.csv`] += '\n' + fila({ num: '2', w: 'P9', l: 'P8', fecha: `${anio - 2}0301` });
  pedidas.length = 0;
  const r = await ingestTour(atp, { fromYear: anio - 2, toYear: anio });
  assert.equal(r.matches, 4, 'la temporada en curso trae su partido nuevo; la cerrada, la copia de antes');
  assert.ok(pedidas.some((u) => u.endsWith(`/${anio}.csv`)) && pedidas.some((u) => u.endsWith(`/${anio - 1}.csv`)));
  assert.ok(!pedidas.some((u) => u.endsWith(`/${anio - 2}.csv`)));

  // Sin red, la última copia de la temporada en curso: mejor vieja que ninguna, y se dice.
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  red = false;
  const sinRed = await ingestTour(atp, { fromYear: anio - 2, toYear: anio });
  assert.equal(sinRed.matches, 4);
  red = true;
  assert.equal(contar(), 4);
});

test('3: con copia, ni un cuerpo cortado, ni un 404, ni una descarga que no se parece a la copia la sustituyen', async () => {
  const { olvidarPrecargadas } = await import('./sackmann.ts');
  olvidarPrecargadas();
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  const buena = servidas[`${anio}.csv`];
  // Cuerpo que se corta a media lectura.
  simularFetch((url) => {
    const f = url.split('/').at(-1)!;
    // Una respuesta 200 cuyo cuerpo falla al leerlo (la conexión se corta a media descarga).
    if (f === `${anio}.csv`) return { ok: true, status: 200, text: async () => Promise.reject(new Error('conexión cortada')) } as unknown as Response;
    return f in servidas ? new Response(servidas[f]) : new Response('no', { status: 404 });
  });
  assert.equal((await ingestTour(atp, { fromYear: anio, toYear: anio })).matches, 2, 'la copia, no una excepción');
  // Un 404 de algo que se tenía.
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  simularFetch((url) => (url.endsWith(`/${anio}.csv`) ? new Response('no', { status: 404 }) : new Response(servidas[url.split('/').at(-1)!] ?? 'no', { status: 200 })));
  assert.equal((await ingestTour(atp, { fromYear: anio, toYear: anio })).matches, 2);
  // Otra cabecera (una página de error con 200, por ejemplo).
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  simularFetch(() => new Response('<html>mantenimiento</html>'));
  assert.equal((await ingestTour(atp, { fromYear: anio, toYear: anio })).matches, 2);
  servidas[`${anio}.csv`] = buena;
});

test('3/7: las temporadas vivas se bajan y se comprueban antes de vaciar nada; un fichero casi entero descartado no se usa', async () => {
  const { precargarTemporadasVivas, olvidarPrecargadas } = await import('./sackmann.ts');
  olvidarPrecargadas();
  // Sin copia y con todas las filas cortadas: para, sin tocar la base.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  fs.rmSync(path.join(RAW_DIR, `${anio}.csv`), { force: true });
  const rota = [CAB, ...[1, 2, 3].map((n) => fila({ num: String(n), w: `S${n}`, l: 'T' }).split(',').slice(0, 20).join(','))].join('\n');
  simularFetch((url) => (url.endsWith(`/${anio}.csv`) ? new Response(rota) : new Response(servidas[url.split('/').at(-1)!] ?? 'no', { status: servidas[url.split('/').at(-1)!] ? 200 : 404 })));
  await assert.rejects(precargarTemporadasVivas(atp, anio), /se descartarían 3 de 3 filas.*No se ha borrado nada/);
  olvidarPrecargadas();
  red = true;
});

test('7: un fichero roto que se parece a la copia no la sustituye: se comprueba ANTES de guardarlo (revisión data-guardian)', async () => {
  const { precargarTemporadasVivas, olvidarPrecargadas } = await import('./sackmann.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  olvidarPrecargadas();
  // Una copia buena de la temporada anterior…
  const buena = [CAB, ...[1, 2, 3, 4].map((n) => fila({ num: String(n), w: `G${n}`, l: 'H', fecha: `${anio - 1}0210` }))].join('\n');
  fs.writeFileSync(path.join(RAW_DIR, `${anio - 1}.csv`), buena);
  // …y la fuente sirve la misma cabecera y las mismas líneas, cada fila con un campo de más.
  const rota = [CAB, ...[1, 2, 3, 4].map((n) => fila({ num: String(n), w: `G${n}`, l: 'H', fecha: `${anio - 1}0210` }) + ',x')].join('\n');
  simularFetch((url) => (url.endsWith(`/${anio - 1}.csv`) ? new Response(rota) : new Response(servidas[url.split('/').at(-1)!] ?? 'no', { status: servidas[url.split('/').at(-1)!] ? 200 : 404 })));
  await precargarTemporadasVivas(atp, anio);
  assert.equal(fs.readFileSync(path.join(RAW_DIR, `${anio - 1}.csv`), 'utf8'), buena, 'la copia buena sigue ahí');
  olvidarPrecargadas();
  red = true;
});

test('4: si algo falla a mitad de una temporada, la transacción se deshace y la base no se queda bloqueada (revisión data-guardian)', async () => {
  const { olvidarPrecargadas } = await import('./sackmann.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  olvidarPrecargadas();
  fs.rmSync(path.join(RAW_DIR, `${anio - 1}.csv`), { force: true });
  simularFetch((url) => new Response(servidas[url.split('/').at(-1)!] ?? 'no', { status: servidas[url.split('/').at(-1)!] ? 200 : 404 }));
  db.exec("CREATE TEMP TRIGGER rompe_anomalias BEFORE INSERT ON ingest_anomalias BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END;");
  try {
    // La temporada anterior trae un repetido: apuntarlo falla.
    await assert.rejects(ingestTour(atp, { fromYear: anio - 1, toYear: anio - 1 }), /fallo simulado/);
  } finally {
    db.exec('DROP TRIGGER rompe_anomalias');
  }
  // Con una transacción abierta, BEGIN fallaría («cannot start a transaction within a transaction»)
  // y la reserva de tennis-data.co.uk no podría escribir.
  assert.doesNotThrow(() => {
    db.exec('BEGIN');
    db.exec('ROLLBACK');
  });
});

test('7: una descarga que ni se deja leer (comillas sin cerrar) no pisa la copia buena (revisión data-guardian, tercera vuelta)', async () => {
  const { precargarTemporadasVivas, olvidarPrecargadas } = await import('./sackmann.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  olvidarPrecargadas();
  const copia = path.join(RAW_DIR, `${anio}.csv`);
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const buena = [CAB, ...[1, 2, 3, 4].map((n) => fila({ num: String(n), w: `Q${n}`, l: 'R', fecha: `${anio}0210` }))].join('\n');
  fs.writeFileSync(copia, buena);
  // Misma cabecera, mismas líneas, y una comilla que no se cierra: el lector de CSV lanza.
  const rota = buena.replace(`Jugador Q2`, `Jugador "Q2`);
  simularFetch((url) => (url.endsWith(`/${anio}.csv`) ? new Response(rota) : new Response(servidas[url.split('/').at(-1)!] ?? 'no', { status: servidas[url.split('/').at(-1)!] ? 200 : 404 })));
  await precargarTemporadasVivas(atp, anio);
  assert.equal(fs.readFileSync(copia, 'utf8'), buena, 'la precarga deja la copia');
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  const r = await ingestTour(atp, { fromYear: anio, toYear: anio });
  assert.equal(r.matches, 4, 'se ingiere la copia');
  assert.equal(fs.readFileSync(copia, 'utf8'), buena, 'y la ingesta tampoco la pisa');
  // Sin copia: para antes de vaciar nada.
  olvidarPrecargadas();
  fs.rmSync(copia);
  await assert.rejects(precargarTemporadasVivas(atp, anio), /no se puede leer.*No se ha borrado nada/);
  assert.ok(!fs.existsSync(copia), 'y no se guarda');
  olvidarPrecargadas();
  servidas[`${anio}.csv`] ??= buena;
});

test('4: si una temporada falla después de otras, no queda medio circuito para que la reserva lo duplique (revisión data-guardian, tercera vuelta)', async () => {
  const { olvidarPrecargadas } = await import('./sackmann.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  olvidarPrecargadas();
  for (const y of [anio - 2, anio - 1, anio]) fs.rmSync(path.join(RAW_DIR, `${y}.csv`), { force: true });
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  servidas = {
    [`${anio - 2}.csv`]: [CAB, fila({ num: '1', w: 'P1', l: 'P2', fecha: `${anio - 2}0110` })].join('\n'),
    [`${anio - 1}.csv`]: [CAB, fila({ num: '1', w: 'P1', l: 'P3', fecha: `${anio - 1}0110` }), fila({ num: '2', w: 'P1', l: 'P3', fecha: `${anio - 1}0110` })].join('\n'),
  };
  simularFetch((url) => new Response(servidas[url.split('/').at(-1)!] ?? 'no', { status: servidas[url.split('/').at(-1)!] ? 200 : 404 }));
  // La primera temporada entra; la segunda trae un repetido y apuntarlo falla.
  db.exec("CREATE TEMP TRIGGER rompe_anomalias BEFORE INSERT ON ingest_anomalias BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END;");
  try {
    await assert.rejects(ingestTour(atp, { fromYear: anio - 2, toYear: anio - 1 }), /fallo simulado/);
  } finally {
    db.exec('DROP TRIGGER rompe_anomalias');
  }
  const quedan = (t: string, w: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${w}`).get() as { n: number }).n;
  assert.equal(contar(), 0, 'ni un partido del circuito');
  assert.equal(quedan('players', "tour = 'atp'"), 0);
  assert.equal(quedan('player_rankings', "tour = 'atp'"), 0);
  assert.equal(quedan('ingest_anomalias', "fuente = 'tml:atp'"), 0);
});

test('4: si SQLite ya deshizo la transacción, se ve el error de verdad y no «no transaction is active» (revisión data-guardian, tercera vuelta)', async () => {
  const { olvidarPrecargadas } = await import('./sackmann.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  olvidarPrecargadas();
  fs.rmSync(path.join(RAW_DIR, `${anio - 1}.csv`), { force: true });
  servidas[`${anio - 1}.csv`] = [CAB, fila({ num: '1', w: 'P1', l: 'P3', fecha: `${anio - 1}0110` }), fila({ num: '2', w: 'P1', l: 'P3', fecha: `${anio - 1}0110` })].join('\n');
  simularFetch((url) => new Response(servidas[url.split('/').at(-1)!] ?? 'no', { status: servidas[url.split('/').at(-1)!] ? 200 : 404 }));
  // RAISE(ROLLBACK) deshace la transacción entera, como un disco lleno: el ROLLBACK de después ya no tiene qué deshacer.
  db.exec("CREATE TEMP TRIGGER deshace_anomalias BEFORE INSERT ON ingest_anomalias BEGIN SELECT RAISE(ROLLBACK, 'fallo con rollback'); END;");
  try {
    await assert.rejects(ingestTour(atp, { fromYear: anio - 1, toYear: anio - 1 }), /fallo con rollback/);
  } finally {
    db.exec('DROP TRIGGER deshace_anomalias');
  }
});

test('7: la ingesta comprueba por su cuenta lo que vuelve a pedir: sin precarga, una descarga ilegible no pisa la copia (revisión data-guardian, tercera vuelta)', async () => {
  const { olvidarPrecargadas } = await import('./sackmann.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  olvidarPrecargadas();
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const copia = path.join(RAW_DIR, `${anio}.csv`);
  const buena = [CAB, ...[1, 2, 3, 4].map((n) => fila({ num: String(n), w: `U${n}`, l: 'V', fecha: `${anio}0210` }))].join('\n');
  fs.writeFileSync(copia, buena);
  simularFetch((url) => (url.endsWith(`/${anio}.csv`) ? new Response(buena.replace('Jugador U2', 'Jugador "U2')) : new Response('no', { status: 404 })));
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  assert.equal((await ingestTour(atp, { fromYear: anio, toYear: anio })).matches, 4, 'la copia');
  assert.equal(fs.readFileSync(copia, 'utf8'), buena, 'intacta');
});

test('7: el preflight tampoco guarda una temporada sin comprobar: sin copia, la parada salta antes de vaciar nada (revisión data-guardian, tercera vuelta)', async () => {
  const { preflight, precargarTemporadasVivas, olvidarPrecargadas, DescargaRechazada } = await import('./sackmann.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  olvidarPrecargadas();
  const copia = path.join(RAW_DIR, `${anio}.csv`);
  for (const y of [anio - 1, anio]) fs.rmSync(path.join(RAW_DIR, `${y}.csv`), { force: true });
  const rota = [CAB, ...[1, 2, 3].map((n) => fila({ num: String(n), w: `S${n}`, l: 'T' }).split(',').slice(0, 20).join(','))].join('\n');
  simularFetch((url) => (url.endsWith(`/${anio}.csv`) ? new Response(rota) : new Response('no', { status: 404 })));
  // El orden de update-data: preflight, precarga, y solo entonces resetData.
  await assert.rejects(preflight(atp), (e: Error) => e instanceof DescargaRechazada && /se descartarían 3 de 3 filas/.test(e.message));
  assert.ok(!fs.existsSync(copia), 'el preflight no la guarda');
  await assert.rejects(precargarTemporadasVivas(atp, anio), /se descartarían 3 de 3 filas.*No se ha borrado nada/);
  assert.ok(!fs.existsSync(copia));
  olvidarPrecargadas();
});

test('4: si el borrado del circuito también falla, se ve el error de verdad y la reserva sabe que quedan partidos (revisión data-guardian, tercera vuelta)', async () => {
  const { olvidarPrecargadas, partidosQueQuedan, sinLimpiar } = await import('./sackmann.ts');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { RAW_DIR } = await import('../config.ts');
  olvidarPrecargadas();
  for (const y of [anio - 2, anio - 1]) fs.rmSync(path.join(RAW_DIR, `${y}.csv`), { force: true });
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  servidas = {
    [`${anio - 2}.csv`]: [CAB, fila({ num: '1', w: 'P1', l: 'P2', fecha: `${anio - 2}0110` })].join('\n'),
    [`${anio - 1}.csv`]: [CAB, fila({ num: '1', w: 'P1', l: 'P3', fecha: `${anio - 1}0110` }), fila({ num: '2', w: 'P1', l: 'P3', fecha: `${anio - 1}0110` })].join('\n'),
  };
  simularFetch((url) => new Response(servidas[url.split('/').at(-1)!] ?? 'no', { status: servidas[url.split('/').at(-1)!] ? 200 : 404 }));
  db.exec("CREATE TEMP TRIGGER rompe_anomalias BEFORE INSERT ON ingest_anomalias BEGIN SELECT RAISE(ABORT, 'fallo simulado'); END;");
  db.exec("CREATE TEMP TRIGGER rompe_borrado BEFORE DELETE ON matches BEGIN SELECT RAISE(ABORT, 'database is locked (simulado)'); END;");
  let fallo: unknown = null;
  try {
    await assert.rejects(ingestTour(atp, { fromYear: anio - 2, toYear: anio - 1 }), (e: Error) => {
      fallo = e;
      return /fallo simulado/.test(e.message) && /database is locked/.test(String((e.cause as Error)?.message));
    });
  } finally {
    db.exec('DROP TRIGGER rompe_anomalias');
    db.exec('DROP TRIGGER rompe_borrado');
  }
  assert.equal(partidosQueQuedan('atp'), 1, 'la temporada que entró sigue ahí: la reserva no puede meter el circuito otra vez');
  // update-data no lo puede contar como un fallo de red: dice los dos errores (revisión data-guardian, N3).
  const motivo = sinLimpiar('atp', fallo);
  assert.match(motivo ?? '', /atp.*fallo simulado.*1 partido.*database is locked \(simulado\)/);
  assert.doesNotMatch(motivo ?? '', /red/);
  db.exec("DELETE FROM matches WHERE tour = 'atp'");
  assert.equal(sinLimpiar('atp', fallo), null, 'sin partidos que queden, la reserva puede probarse');
});
