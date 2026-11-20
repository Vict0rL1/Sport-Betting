import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diaEn, diaSiguiente, filtrar, ordenar, agrupar, favorito, FILTROS_POR_DEFECTO, hayFiltros, contarPorDeporte, type FilaPartido } from './explorador';

function fila(over: Partial<FilaPartido> & { id: string }): FilaPartido {
  return {
    sport: 'football',
    matchKey: `k-${over.id}`,
    liga: { id: 'laliga', nombre: 'LaLiga' },
    torneo: null,
    cuando: '2026-11-20T18:00:00.000Z',
    empezado: false,
    local: { nombre: 'Real Betis', id: 'betis' },
    visitante: { nombre: 'Sevilla FC', id: 'sevilla' },
    sede: 'local',
    mercado: { id: 'resultado', resultados: ['local', 'empate', 'visitante'], excluyentes: true, prorroga: 'no' },
    prediccion: { probs: [0.5, 0.25, 0.25], capturadaEn: '2026-11-20T08:00:00.000Z', version: 'v1', fuente: 'instantanea' },
    sinPrediccion: null,
    cuotas: null,
    origen: 'real',
    ...over,
  };
}

test('T22: el día local depende de la zona; 22:30 UTC es el 20 en Madrid y el 21 en Tokio', () => {
  assert.equal(diaEn('2026-11-20T22:30:00Z', 'Europe/Madrid'), '2026-11-20');
  assert.equal(diaEn('2026-11-20T22:30:00Z', 'Asia/Tokyo'), '2026-11-21');
  assert.equal(diaEn('2026-11-20T07:30:00Z', 'America/Los_Angeles'), '2026-11-19');
  assert.equal(diaSiguiente('2026-12-31'), '2027-01-01');
});

test('el favorito es el resultado más probable del mercado ganador; sin predicción no hay', () => {
  assert.deepEqual(favorito(fila({ id: 'a', prediccion: { probs: [0.3, 0.25, 0.45], capturadaEn: 'x', version: null, fuente: 'registro' } })), { indice: 2, p: 0.45 });
  assert.equal(favorito(fila({ id: 'b', prediccion: null, sinPrediccion: 'sin-registro' })), null);
});

test('T21: por probabilidad del favorito, de mayor a menor, sin predicción al final y empates estables por hora e id', () => {
  const filas = [
    fila({ id: 'c', cuando: '2026-11-20T20:00:00Z', prediccion: { probs: [0.6, 0.4], capturadaEn: 'x', version: null, fuente: 'registro' }, mercado: { id: 'resultado', resultados: ['local', 'visitante'], excluyentes: true, prorroga: 'incluida' }, sport: 'nhl' }),
    fila({ id: 'a', cuando: '2026-11-20T19:00:00Z' }),
    fila({ id: 'z', prediccion: null, sinPrediccion: 'sin-registro' }),
    fila({ id: 'b', cuando: '2026-11-20T19:00:00Z' }),
    fila({ id: 'd', cuando: '2026-11-20T17:00:00Z', prediccion: { probs: [0.2, 0.25, 0.55], capturadaEn: 'x', version: null, fuente: 'registro' } }),
  ];
  assert.deepEqual(ordenar(filas, 'probabilidad').map((f) => f.id), ['c', 'd', 'a', 'b', 'z']);
  assert.deepEqual(ordenar(filas, 'hora').map((f) => f.id), ['d', 'z', 'a', 'b', 'c']);
  // No muta la entrada.
  assert.equal(filas[0].id, 'c');
});

test('T18: los filtros (deporte, liga, guardados, búsqueda sin acentos, umbral) y el recuento cuadran', () => {
  const filas = [
    fila({ id: '1' }),
    fila({ id: '2', liga: { id: 'epl', nombre: 'Premier League' }, local: { nombre: 'Atlético Madrid', id: 'atm' } }),
    fila({ id: '3', sport: 'nhl', liga: { id: 'nhl', nombre: 'NHL' }, prediccion: { probs: [0.7, 0.3], capturadaEn: 'x', version: null, fuente: 'registro' } }),
  ];
  const guardados = new Set(['nhl|k-3']);
  const base = { ...FILTROS_POR_DEFECTO };
  assert.equal(filtrar(filas, base, guardados).length, 3);
  assert.deepEqual(filtrar(filas, { ...base, deporte: 'football' }, guardados).map((f) => f.id), ['1', '2']);
  assert.deepEqual(filtrar(filas, { ...base, deporte: 'football', liga: 'epl' }, guardados).map((f) => f.id), ['2']);
  assert.deepEqual(filtrar(filas, { ...base, q: 'atletico' }, guardados).map((f) => f.id), ['2']);
  assert.deepEqual(filtrar(filas, { ...base, guardados: true }, guardados).map((f) => f.id), ['3']);
  assert.deepEqual(filtrar(filas, { ...base, minimo: 0.6 }, guardados).map((f) => f.id), ['3']);
  // Los recuentos por deporte se hacen con los MISMOS filtros salvo el deporte.
  assert.deepEqual(contarPorDeporte(filas, { ...base, deporte: 'nhl', q: 'atletico' }, guardados), { total: 1, football: 1 });
  assert.equal(hayFiltros(base), false);
  assert.equal(hayFiltros({ ...base, q: 'x' }), true);
});

test('agrupar por día local y competición, en orden de hora, sin perder ni repetir filas', () => {
  const filas = ordenar(
    [
      fila({ id: '1', cuando: '2026-11-20T18:00:00Z' }),
      fila({ id: '2', cuando: '2026-11-20T23:30:00Z', liga: { id: 'epl', nombre: 'Premier League' } }),
      fila({ id: '3', cuando: '2026-11-20T19:00:00Z' }),
    ],
    'hora',
  );
  const g = agrupar(filas, 'Europe/Madrid');
  assert.deepEqual(g.map((d) => d.dia), ['2026-11-20', '2026-11-21']);
  assert.deepEqual(g[0].grupos.map((x) => [x.titulo, x.filas.map((f) => f.id)]), [['LaLiga', ['1', '3']]]);
  assert.deepEqual(g[1].grupos.map((x) => x.titulo), ['Premier League']);
  assert.equal(g.flatMap((d) => d.grupos.flatMap((x) => x.filas)).length, 3);
});
