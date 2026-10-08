// ingestion_runs: cada trabajo deja fila; el error se guarda y se relanza; las ejecuciones
// huérfanas se marcan al arrancar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { conRegistro, ultimasEjecuciones, ejecuciones, marcarMuertas, empezarEjecucion, MUERTA_TRAS_MIN } = await import('./runs.ts');

test('conRegistro: ok con recuentos, error con mensaje y relanzado, y la última por fuente', async () => {
  const r = await conRegistro('test:ok', async () => ({ rowsAdded: 3, rowsUpdated: 1, detail: 'tres nuevas' }));
  assert.deepEqual(r, { rowsAdded: 3, rowsUpdated: 1, detail: 'tres nuevas' });
  await assert.rejects(conRegistro('test:mal', () => Promise.reject(new Error('la fuente no responde'))), /no responde/);
  await conRegistro('test:vacio', () => {});
  const ultimas = Object.fromEntries(ultimasEjecuciones().map((e) => [e.source, e]));
  assert.equal(ultimas['test:ok'].status, 'ok');
  assert.equal(ultimas['test:ok'].rows_added, 3);
  assert.equal(ultimas['test:ok'].detail, 'tres nuevas');
  assert.ok(ultimas['test:ok'].finished_at);
  assert.equal(ultimas['test:mal'].status, 'error');
  assert.equal(ultimas['test:mal'].error, 'la fuente no responde');
  assert.equal(ultimas['test:vacio'].status, 'ok');
  assert.equal(ultimas['test:vacio'].rows_added, null);
  // Historial filtrado y acotado.
  await conRegistro('test:ok', () => ({ rowsAdded: 0 }));
  assert.equal(ejecuciones({ source: 'test:ok' }).length, 2);
  assert.equal(ejecuciones({ source: 'test:ok', limite: 1 }).length, 1);
  assert.equal(ultimasEjecuciones().find((e) => e.source === 'test:ok')!.rows_added, 0, 'la última, no la primera');
});

test('marcarMuertas: una ejecución running de hace horas pasa a error; una reciente se respeta', () => {
  const ahora = new Date('2026-10-07T12:00:00Z');
  const vieja = empezarEjecucion('test:colgada', new Date(ahora.getTime() - (MUERTA_TRAS_MIN + 5) * 60_000));
  const nueva = empezarEjecucion('test:en-marcha', new Date(ahora.getTime() - 5 * 60_000));
  assert.equal(marcarMuertas(ahora), 1);
  const porId = Object.fromEntries(ejecuciones({ limite: 50 }).map((e) => [e.id, e]));
  assert.equal(porId[vieja].status, 'error');
  assert.match(porId[vieja].error ?? '', /no terminó/);
  assert.equal(porId[nueva].status, 'running');
  assert.equal(marcarMuertas(ahora), 0, 'idempotente');
});
