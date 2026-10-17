import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuandoOciosa, precargar, type EntornoOcioso } from './precarga.ts';

function entorno(cambios: Partial<EntornoOcioso> = {}): EntornoOcioso & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    llamadas,
    ahorro: false,
    enLinea: true,
    temporizador: (f, ms) => {
      llamadas.push(`temporizador ${ms}`);
      f();
      return 7;
    },
    cancelarTemporizador: (id) => llamadas.push(`cancela temporizador ${id}`),
    ...cambios,
  };
}

test('K5: con requestIdleCallback, la tarea va en reposo con la espera como tope', () => {
  let hecha = 0;
  const e = entorno({
    enReposo: (f, o) => {
      e.llamadas.push(`reposo ${o.timeout}`);
      f();
      return 3;
    },
    cancelarReposo: (id) => e.llamadas.push(`cancela reposo ${id}`),
  });
  const cancelar = cuandoOciosa(() => hecha++, e, 1500);
  cancelar();
  assert.equal(hecha, 1);
  assert.deepEqual(e.llamadas, ['reposo 1500', 'cancela reposo 3']);
});

test('K5: sin requestIdleCallback (Safari), un temporizador', () => {
  let hecha = 0;
  const e = entorno();
  cuandoOciosa(() => hecha++, e)();
  assert.equal(hecha, 1);
  assert.deepEqual(e.llamadas, ['temporizador 2000', 'cancela temporizador 7']);
});

test('K5: con «ahorro de datos» o sin red no se precarga nada', () => {
  for (const cambios of [{ ahorro: true }, { enLinea: false }]) {
    let hecha = 0;
    const e = entorno(cambios);
    cuandoOciosa(() => hecha++, e)();
    assert.equal(hecha, 0, JSON.stringify(cambios));
    assert.deepEqual(e.llamadas, []);
  }
});

test('K5: un trozo que no llega no rompe los demás ni deja un rechazo sin recoger', async () => {
  const pedidos: string[] = [];
  let sinRecoger = 0;
  const contar = () => sinRecoger++;
  process.on('unhandledRejection', contar);
  precargar([
    () => (pedidos.push('a'), Promise.reject(new Error('sin red'))),
    () => (pedidos.push('b'), Promise.resolve()),
  ]);
  await new Promise((r) => setTimeout(r, 10));
  process.off('unhandledRejection', contar);
  assert.deepEqual(pedidos, ['a', 'b']);
  assert.equal(sinRecoger, 0);
});
