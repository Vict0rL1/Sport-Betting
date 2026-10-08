import { timingSafeEqual } from 'node:crypto';

/**
 * Compara sin filtrar por tiempo.
 *
 * `a === b` sale antes en cuanto encuentra una letra distinta, así que el tiempo de
 * respuesta dice cuántos caracteres del principio eran correctos. Contra un servidor en
 * internet eso es explotable, y la comparación constante cuesta lo mismo de escribir.
 *
 * Las longitudes se igualan antes porque `timingSafeEqual` LANZA si difieren, y ese
 * throw sería, otra vez, una filtración por el mismo canal.
 */
export function igual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    // Se compara igualmente contra sí mismo para gastar un tiempo parecido.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}
