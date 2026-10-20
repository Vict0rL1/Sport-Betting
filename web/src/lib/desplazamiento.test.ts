// L7 (lote L): «atrás» vuelve a la altura a la que se dejó la pantalla.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volverA, type EnlaceTocado, type EntornoDesplazamiento } from './desplazamiento.ts';

/**
 * Un entorno de mentira: los fotogramas y los relojes avanzan a mano. `enlace`: dónde está en la
 * página el enlace que se tocó en cada fotograma (null si aún no está).
 */
function entorno(altos: number[], enlace: (number | null)[] = []) {
  let i = 0;
  const fotogramas: (() => void)[] = [];
  const relojes = new Map<number, { ms: number; f: () => void }>();
  let siguiente = 1;
  let interaccion: (() => void) | null = null;
  const posiciones: number[] = [];
  const anclaje: boolean[] = [];
  const e: EntornoDesplazamiento = {
    maximo: () => altos[Math.min(i, altos.length - 1)],
    ir: (y) => posiciones.push(Math.min(y, altos[Math.min(i, altos.length - 1)])),
    actual: () => posiciones.at(-1) ?? 0,
    posicionDe: () => {
      const en = enlace[Math.min(i, enlace.length - 1)];
      return en == null ? null : en - (posiciones.at(-1) ?? 0);
    },
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
    /** La mueve otro: la barra de desplazamiento, la propia página. */
    desplazar: (y: number) => posiciones.push(y),
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

/** El enlace que se tocó: estaba a 413 px de lo alto de la pantalla, con la página a `y`. */
const tocado = (y: number): EnlaceTocado => ({ href: '/glosario#brier', indice: 0, total: 1, top: 413, y });

test('N15: con el enlace tocado, lo deja donde estaba en la pantalla aunque lo de encima no haya llegado', () => {
  // Al irse: página a 3.209 y el enlace 413 px más abajo (en 3.622). Al volver, lo de encima aún no
  // ha llegado y el enlace está en 2.209: hay que ir a 1.796, no a 3.209. Luego llegan 1.209 px
  // encima y el enlace baja a 3.418: la página baja con él, antes de pintarse.
  const x = entorno([6000, 6000, 6000, 7209], [2209, 2209, 2209, 3418]);
  volverA(3209, x.e, { ancla: tocado(3209) });
  for (let k = 0; k < 5; k++) x.fotograma();
  assert.deepEqual(x.posiciones, [1796, 3005]);
  assert.equal(x.anclado(), false, 'lo de encima lo compensa esto, no el navegador');
  assert.equal(x.escuchando(), true);
  x.vencer(10_000);
  assert.equal(x.anclado(), true);
  assert.equal(x.escuchando(), false);
  assert.equal(x.pendientes(), 0);
});

test('N15: mientras el enlace no está (la lista carga), se acerca con la altura guardada', () => {
  const x = entorno([300, 300, 6000], [null, null, 3622]);
  volverA(3209, x.e, { ancla: tocado(3209) });
  for (let k = 0; k < 5; k++) x.fotograma();
  assert.deepEqual(x.posiciones, [300, 300, 3209]);
});

test('N15: si el enlace no aparece, se queda en la altura guardada, como sin él', () => {
  const x = entorno([6000], [null]);
  volverA(3209, x.e, { ancla: tocado(3209) });
  x.fotograma();
  x.vencer(3000);
  assert.deepEqual(x.posiciones, [3209]);
  assert.equal(x.anclado(), false);
  x.vencer(10_000);
  assert.equal(x.anclado(), true);
  assert.equal(x.escuchando(), false);
  assert.equal(x.pendientes(), 0);
});

test('N15: si otro mueve la página mientras se sostiene (la barra de desplazamiento), se deja', () => {
  const x = entorno([6000], [2209]);
  volverA(3209, x.e, { ancla: tocado(3209) });
  x.fotograma();
  x.desplazar(2600);
  x.fotograma();
  x.fotograma();
  assert.deepEqual(x.posiciones, [1796, 2600], 'no se le pelea');
  assert.equal(x.anclado(), true);
  assert.equal(x.escuchando(), false);
});

test('N15: avisa una vez cuando acaba, por lo que sea', () => {
  let avisos = 0;
  const x = entorno([6000], [2209]);
  const parar = volverA(3209, x.e, { ancla: tocado(3209), alAcabar: () => avisos++ });
  x.fotograma();
  assert.equal(avisos, 0, 'mientras se sostiene, no');
  x.tocar();
  parar();
  x.vencer(10_000);
  assert.equal(avisos, 1);
});

