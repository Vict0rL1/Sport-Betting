// L7 (lote L): «atrás» vuelve a la altura a la que se dejó la pantalla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volverA, type EntornoDesplazamiento } from './desplazamiento.ts';

/** Un entorno de mentira: los fotogramas y el reloj avanzan a mano. */
function entorno(altos: number[]) {
  let i = 0;
  const fotogramas: (() => void)[] = [];
  const relojes: (() => void)[] = [];
  let interaccion: (() => void) | null = null;
  const posiciones: number[] = [];
  const e: EntornoDesplazamiento = {
    maximo: () => altos[Math.min(i, altos.length - 1)],
    ir: (y) => posiciones.push(y),
    fotograma: (f) => fotogramas.push(f),
    cancelarFotograma: () => fotogramas.splice(0),
    temporizador: (f) => relojes.push(f),
    cancelarTemporizador: () => relojes.splice(0),
    alInteractuar: (f) => {
      interaccion = f;
      return () => (interaccion = null);
    },
  };
  return {
    e,
    posiciones,
    /** Un fotograma: la página ha crecido al alto siguiente. */
    fotograma: () => {
      const f = fotogramas.shift();
      if (f) f();
      i++;
    },
    pendientes: () => fotogramas.length,
    escuchando: () => interaccion != null,
    tocar: () => interaccion?.(),
    vencer: () => relojes.shift()?.(),
  };
}

test('L7: con alto de sobra, llega en el primer fotograma y deja de escuchar', () => {
  const x = entorno([5000]);
  volverA(1200, x.e);
  x.fotograma();
  assert.deepEqual(x.posiciones, [1200]);
  assert.equal(x.pendientes(), 0);
  assert.equal(x.escuchando(), false);
});

test('L7: mientras la lista carga, reintenta hasta que la página mide lo bastante', () => {
  // Al volver, la página mide 300; luego llegan los datos y crece.
  const x = entorno([300, 300, 900, 6700]);
  volverA(6695, x.e);
  for (let k = 0; k < 4; k++) x.fotograma();
  assert.deepEqual(x.posiciones, [300, 300, 900, 6695]);
  assert.equal(x.pendientes(), 0);
});

test('L7: si la persona toca o desplaza, se deja de intentar', () => {
  const x = entorno([300, 300, 6700]);
  volverA(6695, x.e);
  x.fotograma();
  x.tocar();
  x.fotograma();
  x.fotograma();
  assert.deepEqual(x.posiciones, [300]);
  assert.equal(x.escuchando(), false);
});

test('L7: pasado el límite sin alto suficiente, se queda donde llegó', () => {
  const x = entorno([300]);
  volverA(6695, x.e);
  x.fotograma();
  x.vencer();
  x.fotograma();
  assert.deepEqual(x.posiciones, [300]);
  assert.equal(x.pendientes(), 0);
  assert.equal(x.escuchando(), false);
});
