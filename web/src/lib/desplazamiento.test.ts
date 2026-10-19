// L7 (lote L): «atrás» vuelve a la altura a la que se dejó la pantalla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volverA, type EntornoDesplazamiento } from './desplazamiento.ts';

/** Un entorno de mentira: los fotogramas y los relojes avanzan a mano. */
function entorno(altos: number[]) {
  let i = 0;
  const fotogramas: (() => void)[] = [];
  const relojes = new Map<number, { ms: number; f: () => void }>();
  let siguiente = 1;
  let interaccion: (() => void) | null = null;
  const posiciones: number[] = [];
  const anclaje: boolean[] = [];
  const e: EntornoDesplazamiento = {
    maximo: () => altos[Math.min(i, altos.length - 1)],
    ir: (y) => posiciones.push(y),
    fotograma: (f) => fotogramas.push(f),
    cancelarFotograma: () => fotogramas.splice(0),
    temporizador: (f, ms) => {
      relojes.set(siguiente, { ms, f });
      return siguiente++;
    },
    cancelarTemporizador: (id) => relojes.delete(id),
    alInteractuar: (f) => {
      interaccion = f;
      return () => (interaccion = null);
    },
    anclar: (si) => anclaje.push(si),
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
    /** Lo último que se pidió al navegador: recolocar la página (true) o no (false). */
    anclado: () => anclaje.at(-1) ?? true,
    tocar: () => interaccion?.(),
    /** Vence el reloj de `ms` (el límite para llegar, o el tope para esperar), si sigue puesto. */
    vencer: (ms: number) => {
      for (const [id, r] of relojes) {
        if (r.ms !== ms) continue;
        relojes.delete(id);
        r.f();
      }
    },
  };
}

test('L7: con alto de sobra, llega en el primer fotograma y no vuelve a mover la página', () => {
  const x = entorno([5000]);
  volverA(1200, x.e);
  for (let k = 0; k < 5; k++) x.fotograma();
  assert.deepEqual(x.posiciones, [1200]);
});

test('L7: mientras la lista carga, reintenta hasta que la página mide lo bastante', () => {
  // Al volver, la página mide 300; luego llegan los datos y crece.
  const x = entorno([300, 300, 900, 6700]);
  volverA(6695, x.e);
  for (let k = 0; k < 6; k++) x.fotograma();
  assert.deepEqual(x.posiciones, [300, 300, 900, 6695]);
});

test('N10: alcanzada la altura, el navegador no recoloca la página hasta que la persona toca', () => {
  // Las secciones de encima siguen llegando después de alcanzar la altura, y con la red de un móvil
  // pueden tardar más de los 3 s que hay para llegar: con el anclaje del navegador, la página
  // bajaba lo que crecían (1.500 px en Confianza) y se perdía el sitio.
  const x = entorno([5000, 5000, 6200, 8100]);
  volverA(1200, x.e);
  assert.equal(x.anclado(), false);
  for (let k = 0; k < 4; k++) x.fotograma();
  assert.deepEqual(x.posiciones, [1200], 'alcanzada, no se vuelve a mover');
  x.vencer(3000);
  assert.equal(x.anclado(), false, 'el límite para llegar no corta la espera');
  assert.equal(x.escuchando(), true);
  x.tocar();
  assert.equal(x.anclado(), true);
  assert.equal(x.escuchando(), false);
});

test('N10: sin que nadie toque, el anclaje vuelve a los 10 s', () => {
  const x = entorno([5000]);
  volverA(1200, x.e);
  x.fotograma();
  x.vencer(10_000);
  assert.equal(x.anclado(), true);
  assert.equal(x.escuchando(), false);
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
  assert.equal(x.anclado(), true, 'en cuanto la persona toca, el navegador vuelve a recolocar');
});

test('L7: pasado el límite sin alto suficiente, se queda donde llegó', () => {
  const x = entorno([300]);
  volverA(6695, x.e);
  x.fotograma();
  x.vencer(3000);
  x.fotograma();
  assert.deepEqual(x.posiciones, [300]);
  assert.equal(x.pendientes(), 0);
  assert.equal(x.escuchando(), false);
  assert.equal(x.anclado(), true);
});
