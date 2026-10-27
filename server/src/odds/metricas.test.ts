// Auditoría del 17 de octubre, punto 5: unas 16 h con 1.275 ejecuciones de cuotas «ok» y ningún
// snapshot nuevo. Con lo que guardaba ingestion_runs (status ok y el número de PRÓXIMOS) no se
// podía saber si las cuotas no cambiaron (se guarda solo lo que cambia), si la API no devolvió
// nada, si no se llegó a pedir, o si guardar falló (el error se escribía en stderr y nada más).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simularFetch } from '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { requestOdds } = await import('../oddsApi.ts');
const { registrarCuotas } = await import('./metricas.ts');

const db = getDb();
let cuota = 2.0;
let eventos = 1;
simularFetch(
  () =>
    new Response(
      JSON.stringify(
        Array.from({ length: eventos }, (_, i) => ({
          id: `ev${i}`,
          sport_key: 'soccer_epl',
          commence_time: '2026-10-25T14:00:00Z',
          home_team: 'Arsenal',
          away_team: 'Chelsea',
          bookmakers: [{ key: 'pinnacle', title: 'P', last_update: '2026-10-20T09:00:00Z', markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: cuota }, { name: 'Draw', price: 3.4 }, { name: 'Chelsea', price: 3.8 }] }] }],
        })),
      ),
      { status: 200, headers: { 'x-requests-remaining': '480', 'x-requests-used': '20' } },
    ),
);
const pedir = () => registrarCuotas('odds:prueba', async () => ({ count: 7, source: 'live', r: await requestOdds('soccer_epl', { manual: true }) }));
const ultima = () => db.prepare("SELECT status, rows_added, rows_updated, error, detail, metrics FROM ingestion_runs WHERE source = 'odds:prueba' ORDER BY id DESC LIMIT 1").get() as Record<string, string | number | null>;

test('5: la ejecución dice cuántas cuotas pidió, cuántas cambiaron y cuántas guardó', async () => {
  await pedir();
  let r = ultima();
  assert.equal(r.status, 'ok');
  assert.equal(r.rows_added, 3, 'añadidas = snapshots guardados, no próximos');
  const m = JSON.parse(String(r.metrics));
  assert.deepEqual(
    { peticiones: m.peticiones, eventos: m.eventos, cotizaciones: m.cotizaciones, cambiadas: m.cambiadas, snapshots: m.snapshots, observaciones: m.observaciones, fuenteMasNueva: m.fuenteMasNueva, proximos: m.proximos },
    { peticiones: 1, eventos: 1, cotizaciones: 3, cambiadas: 3, snapshots: 3, observaciones: 1, fuenteMasNueva: '2026-10-20T09:00:00Z', proximos: 7 },
  );

  // Lo mismo otra vez: pedida y vista, pero sin cambios. Eso es «ok, sin cambios», no «sin datos».
  await pedir();
  r = ultima();
  assert.equal(r.status, 'ok');
  assert.equal(r.rows_added, 0);
  assert.match(String(r.detail), /1 petición\(es\), 1 evento\(s\), 3 cuota\(s\) vistas, 0 cambiadas → 0 guardadas/);
  assert.match(String(r.detail), /sin cambios/);

  // La API contesta una lista vacía: ni eventos ni cuotas.
  eventos = 0;
  await pedir();
  assert.match(String(ultima().detail), /la API no devolvió ningún evento/);
  eventos = 1;
});

test('5: si guardar falla, la ejecución es un error aunque la descarga fuera bien', async () => {
  cuota = 2.2;
  db.exec(`CREATE TEMP TRIGGER romper BEFORE INSERT ON odds_event_observations BEGIN SELECT RAISE(ABORT, 'disco lleno (simulado)'); END;`);
  await assert.rejects(pedir(), /no se guardaron.*disco lleno/);
  db.exec('DROP TRIGGER romper');
  const r = ultima();
  assert.equal(r.status, 'error');
  assert.match(String(r.error), /disco lleno/);
  assert.equal(JSON.parse(String(r.metrics)).errorGuardando, 'disco lleno (simulado)');
});

test('5: sin ninguna petición (demostración, o el freno de presupuesto), se dice', async () => {
  await registrarCuotas('odds:prueba', async () => ({ count: 4, source: 'fixture' }));
  assert.match(String(ultima().detail), /fixture: 4 próximos · ninguna petición a la API/);
});

// ---------------------------------------------------------------------------
// Auditoría del 22 de octubre, hallazgo 3: una respuesta que no es JSON lanzaba sin anotar el fallo,
// y si el refresco la capturaba y caía a la demostración, la ejecución decía «0 fallidas, ninguna
// petición a la API». Y si el refresco lanzaba, lo ya recogido se perdía: metrics = NULL.
// ---------------------------------------------------------------------------
const NO_JSON = () => new Response('<html>502 Bad Gateway</html>', { status: 200, headers: { 'x-requests-remaining': '479', 'x-requests-used': '21' } });
const UN_EVENTO = () =>
  new Response(
    JSON.stringify([{ id: 'ev-bien', sport_key: 'soccer_epl', commence_time: '2026-10-25T14:00:00Z', home_team: 'Arsenal', away_team: 'Chelsea', bookmakers: [{ key: 'pinnacle', title: 'P', last_update: '2026-10-20T09:00:00Z', markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 2.05 }, { name: 'Draw', price: 3.4 }, { name: 'Chelsea', price: 3.8 }] }] }] }]),
    { status: 200 },
  );

test('22 oct, 3: una respuesta que no es JSON cuenta como fallida aunque el refresco caiga a la demostración', async () => {
  const { refreshOdds } = await import('../ingest/odds.ts');
  simularFetch((url) =>
    url.includes('/odds/') ? NO_JSON() : new Response(JSON.stringify([{ key: 'tennis_atp_paris', group: 'Tennis', title: 'ATP Paris Masters', active: true, has_outrights: false }])),
  );
  const r = await registrarCuotas('odds:prueba', () => refreshOdds(true));
  assert.equal(r.source, 'fixture', 'el refresco captura el fallo y sigue con la demostración');
  const fila = ultima();
  assert.equal(fila.status, 'ok');
  const m = JSON.parse(String(fila.metrics));
  assert.equal(m.fallidas, 1, 'la petición se hizo y falló');
  assert.match(String(m.ultimoFallo), /tennis_atp_paris: respuesta_invalida/);
  assert.doesNotMatch(String(fila.detail), /ninguna petición/);
  assert.match(String(fila.detail), /1 fallida\(s\) \(tennis_atp_paris: respuesta_invalida/);
});

test('22 oct, 3: si el refresco lanza, la ejecución guarda el error Y lo recogido hasta entonces', async () => {
  const { OddsApiError } = await import('../oddsApi.ts');
  // Una petición buena y luego una que no es JSON, sin capturar.
  let n = 0;
  simularFetch(() => (n++ === 0 ? UN_EVENTO() : NO_JSON()));
  await assert.rejects(
    registrarCuotas('odds:prueba', async () => {
      await requestOdds('soccer_epl', { manual: true });
      await requestOdds('soccer_spain_la_liga', { manual: true });
      return { count: 2, source: 'live' };
    }),
    (e: unknown) => e instanceof OddsApiError && e.kind === 'respuesta_invalida' && /soccer_spain_la_liga: la respuesta no es JSON/.test(e.message),
    'el error de siempre, con su tipo y su mensaje',
  );
  let fila = ultima();
  assert.equal(fila.status, 'error');
  assert.match(String(fila.error), /soccer_spain_la_liga: la respuesta no es JSON/);
  assert.ok(fila.metrics, 'metrics no se queda en NULL');
  let m = JSON.parse(String(fila.metrics));
  assert.deepEqual({ peticiones: m.peticiones, fallidas: m.fallidas, eventos: m.eventos, cotizaciones: m.cotizaciones }, { peticiones: 1, fallidas: 1, eventos: 1, cotizaciones: 3 });
  assert.match(String(m.ultimoFallo), /soccer_spain_la_liga: respuesta_invalida/);

  // Un fallo que no es de la API, después de una petición buena: tampoco se pierde lo recogido.
  simularFetch(UN_EVENTO);
  await assert.rejects(
    registrarCuotas('odds:prueba', async () => {
      await requestOdds('soccer_epl', { manual: true });
      throw new Error('el refresco se cayó al guardar los próximos');
    }),
    /el refresco se cayó al guardar los próximos/,
  );
  fila = ultima();
  assert.equal(fila.status, 'error');
  m = JSON.parse(String(fila.metrics));
  assert.equal(m.peticiones, 1);

  // Y algo lanzado que ni siquiera es un Error: su texto llega al registro.
  await assert.rejects(registrarCuotas('odds:prueba', async () => Promise.reject('cadena lanzada')), /cadena lanzada/);
  fila = ultima();
  assert.match(String(fila.error), /cadena lanzada/);
  assert.ok(fila.metrics);
});

test('22 oct, 3: si falla la lista de competiciones (/sports), también se anota, y el refresco cae igual a la demostración', async () => {
  const { refreshOdds } = await import('../ingest/odds.ts');
  const quota = (await import('../oddsQuota.ts')) as { olvidarListaDeportes?: () => void };
  quota.olvidarListaDeportes?.();
  for (const [respuesta, fallo] of [
    [NO_JSON, /\/sports: respuesta_invalida/],
    [() => new Response('{"message":"boom"}', { status: 500 }), /\/sports: /],
    [() => Promise.reject(new TypeError('fetch failed')), /\/sports: sin_red/],
  ] as [() => Response | Promise<Response>, RegExp][]) {
    quota.olvidarListaDeportes?.();
    simularFetch(respuesta);
    const r = await registrarCuotas('odds:prueba', () => refreshOdds(true));
    assert.equal(r.source, 'fixture');
    const fila = ultima();
    const m = JSON.parse(String(fila.metrics));
    assert.equal(m.fallidas, 1, String(fila.detail));
    assert.match(String(m.ultimoFallo), fallo);
    assert.doesNotMatch(String(fila.detail), /ninguna petición/);
  }
  quota.olvidarListaDeportes?.();
});

test('27 oct (data-guardian): /sports con JSON que no es una lista es un fallo, se anota y no se guarda en la caché', async () => {
  const { refreshOdds } = await import('../ingest/odds.ts');
  const { olvidarListaDeportes } = await import('../oddsQuota.ts');
  olvidarListaDeportes();
  let pedidasSports = 0;
  simularFetch((url) => {
    if (!url.includes('/odds/')) pedidasSports++;
    return new Response('{"message":"respuesta de un proxy"}', { status: 200 });
  });
  for (let i = 0; i < 2; i++) {
    await registrarCuotas('odds:prueba', () => refreshOdds(true));
    const m = JSON.parse(String(ultima().metrics));
    assert.equal(m.fallidas, 1);
    assert.match(String(m.ultimoFallo), /\/sports: respuesta_invalida/);
  }
  assert.equal(pedidasSports, 2, 'la segunda vez se vuelve a pedir: el fallo no quedó en la caché');
  olvidarListaDeportes();
});

test('27 oct (data-guardian): algo lanzado que ni se deja convertir en texto no tira las métricas', async () => {
  await assert.rejects(registrarCuotas('odds:prueba', async () => Promise.reject(Object.create(null))), Error);
  const fila = ultima();
  assert.equal(fila.status, 'error');
  assert.match(String(fila.error), /\[object Object\]/);
  assert.ok(fila.metrics, 'metrics no se queda en NULL');
});
