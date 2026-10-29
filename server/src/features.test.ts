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

test('una lectura de anulaciones que falla no se queda para siempre: al abrir la base otra vez, se vuelve a leer (revisión data-guardian)', async () => {
  const { lectorPorDefecto } = await import('./features.ts');
  reiniciarFeatures({ 'x.c': { on: true, descripcion: 'c' } });
  let falla = true;
  conLectorDeAnulaciones(() => {
    if (falla) throw new Error('database is locked');
    return JSON.stringify({ 'x.c': false });
  });
  assert.equal(featureEncendida('x.c'), true, 'sin poder leer, manda el fichero');
  falla = false;
  // Lo que hace getDb() al abrir una conexión: no cambia el lector puesto, pero lo que falló se relee.
  lectorPorDefecto(() => null);
  assert.equal(featureEncendida('x.c'), false);
  reiniciarFeatures();
  conLectorDeAnulaciones(() => null);
});
