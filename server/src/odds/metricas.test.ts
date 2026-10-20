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
