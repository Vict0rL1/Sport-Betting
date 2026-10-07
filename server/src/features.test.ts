// Interruptores: el fichero manda salvo anulación desde Ajustes, que se guarda y se quita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './test/setup.ts';

const { featureEncendida, fijarAnulacion, reiniciarFeatures, conLectorDeAnulaciones, estadoFeatures, CLAVE_ANULACIONES } = await import('./features.ts');

test('anulaciones: cambian el interruptor, se persisten por el guardador y null las quita', () => {
  reiniciarFeatures({ 'x.a': { on: true, descripcion: 'a' }, 'x.b': { on: false, descripcion: 'b' } }, {});
  assert.equal(featureEncendida('x.a'), true);
  assert.equal(featureEncendida('x.b'), false);
  let guardado: string | null = null;
  fijarAnulacion('x.a', false, (j) => (guardado = j));
  assert.equal(featureEncendida('x.a'), false);
  assert.deepEqual(JSON.parse(guardado as unknown as string), { 'x.a': false });
  assert.equal(estadoFeatures({} as NodeJS.ProcessEnv)['x.a'].anulada, true);
  fijarAnulacion('x.a', null, (j) => (guardado = j));
  assert.equal(featureEncendida('x.a'), true);
  assert.deepEqual(JSON.parse(guardado as unknown as string), {});
  // El lector carga lo guardado la primera vez que hace falta.
  conLectorDeAnulaciones((k) => (k === CLAVE_ANULACIONES ? JSON.stringify({ 'x.b': true }) : null));
  reiniciarFeatures({ 'x.b': { on: false, descripcion: 'b' } });
  assert.equal(featureEncendida('x.b'), true);
  reiniciarFeatures();
  conLectorDeAnulaciones(() => null);
});
