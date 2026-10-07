// La ventana de «hoy» y la regla del audit: una fila solo «sobrevive a un refresco» si ya estaba
// fuera de la ventana cuando ese refresco se hizo. Fechas en hora LOCAL, como la ventana.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshSince, sobrevivioARefresco } from './freshness.ts';

const local = (dia: number, hora: number) => new Date(2026, 9, dia, hora, 0, 0).toISOString();

test('la ventana empieza en la medianoche local o seis horas antes, lo que sea antes', () => {
  assert.equal(freshSince(new Date(local(7, 1))), local(6, 19), 'a la 01:00, desde las 19:00 de ayer');
  assert.equal(freshSince(new Date(local(7, 22))), local(7, 0), 'a las 22:00, desde la medianoche');
});

test('un partido de anoche no «sobrevive» a un refresco de la madrugada que aún lo veía dentro', () => {
  // El caso real del audit: partido a las 21:00, último refresco a la 01:00, auditado a las 22:30.
  assert.equal(sobrevivioARefresco(local(6, 21), local(7, 1)), false);
});

test('sí sobrevive si ya estaba fuera cuando se refrescó: eso es un pruning roto', () => {
  assert.equal(sobrevivioARefresco(local(6, 21), local(7, 8)), true, 'a las 08:00 la ventana ya empezaba a medianoche');
  assert.equal(sobrevivioARefresco(local(5, 12), local(7, 1)), true);
});

test('sin filas o sin refresco no hay nada que reprochar', () => {
  assert.equal(sobrevivioARefresco(null, local(7, 1)), false);
  assert.equal(sobrevivioARefresco(local(5, 12), null), false);
  assert.equal(sobrevivioARefresco(local(5, 12), 'no-es-una-fecha'), false);
});
