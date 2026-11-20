// B3 (revisión del PR 17): un estado de datos remotos que no miente. «No guardado» y «no se pudo
// saber» son cosas distintas; un refresco que falla no borra lo último bueno.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REMOTO_INICIAL, alPedir, alRecibir, alFallar, datosDe, estaGuardada } from './remoto.ts';

test('B3: cargando → listo → refresco fallido conserva lo último bueno y lo dice', () => {
  let e = alPedir(REMOTO_INICIAL<number[]>());
  assert.equal(e.fase, 'cargando');
  assert.equal(datosDe(e), null);
  e = alRecibir(e, [1, 2], 1000);
  assert.deepEqual(e, { fase: 'listo', datos: [1, 2], actualizadoEn: 1000 });
  e = alPedir(e);
  assert.equal(e.fase, 'actualizando');
  assert.deepEqual(datosDe(e), [1, 2], 'mientras se refresca se siguen viendo los datos');
  e = alFallar(e, 500);
  assert.equal(e.fase, 'error-refresco');
  assert.deepEqual(datosDe(e), [1, 2]);
  assert.equal(e.fase === 'error-refresco' && e.actualizadoEn, 1000, 'de cuándo son');
});

test('B3: un fallo de la primera carga no es una lista vacía', () => {
  const e = alFallar(alPedir(REMOTO_INICIAL<number[]>()), 0);
  assert.equal(e.fase, 'error');
  assert.equal(datosDe(e), null, 'no hay datos: ni vacíos ni inventados');
});

test('B3: un 404 es la función apagada, no un error', () => {
  assert.equal(alFallar(alPedir(REMOTO_INICIAL<number[]>()), 404).fase, 'apagado');
});

test('B3: guardada sí / no / no se sabe', () => {
  const g = [{ id: 4, sport: 'nhl', snapshot_id: 9 }];
  assert.equal(estaGuardada(alRecibir(REMOTO_INICIAL(), g, 1), 'nhl', 9), 4);
  assert.equal(estaGuardada(alRecibir(REMOTO_INICIAL(), g, 1), 'nhl', 10), null, 'cargado y no está: no guardada');
  assert.equal(estaGuardada(alFallar(alPedir(REMOTO_INICIAL()), 500), 'nhl', 9), undefined, 'no se pudo saber');
  assert.equal(estaGuardada(alPedir(REMOTO_INICIAL()), 'nhl', 9), undefined, 'todavía no se sabe');
  assert.equal(estaGuardada(alFallar(alRecibir(REMOTO_INICIAL(), g, 1), 500), 'nhl', 9), 4, 'tras un refresco fallido vale lo último bueno');
});

test('C: pedirJson rechaza un 500 aunque traiga JSON, y una forma inesperada (no la da por vacía)', async () => {
  const { pedirJson, ErrorDeCarga } = await import('./remoto.ts');
  const antes = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'caído' }), { status: 500 })) as typeof fetch;
  await assert.rejects(pedirJson('/x', (j) => (j as { features: object }).features), (e: unknown) => e instanceof ErrorDeCarga && e.status === 500);
  globalThis.fetch = (async () => new Response(JSON.stringify({ otra: 1 }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    pedirJson('/x', (j) => {
      const f = (j as { features?: object }).features;
      if (!f) throw new Error('forma');
      return f;
    }),
    (e: unknown) => e instanceof ErrorDeCarga && e.status === -1,
  );
  globalThis.fetch = (async () => new Response(JSON.stringify({ features: { a: 1 } }), { status: 200 })) as typeof fetch;
  assert.deepEqual(await pedirJson('/x', (j) => (j as { features: object }).features), { a: 1 });
  globalThis.fetch = antes;
});
