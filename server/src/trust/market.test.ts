import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { calidadMercado, MERCADO_UMBRALES } = await import('./market.ts');
const { recordOddsResponse } = await import('../odds/snapshots.ts');

const ahora = new Date();
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();
const INICIO = new Date(ahora.getTime() + 24 * 3_600_000).toISOString();

function evento(id: string, precios: number[], min: number) {
  recordOddsResponse('basketball_nba', 'h2h', {
    fetchedAt: hace(min),
    events: [
      {
        id, sport_key: 'basketball_nba', commence_time: INICIO, home_team: 'Lakers', away_team: 'Celtics',
        bookmakers: precios.map((p, i) => ({ key: `casa${i}`, title: `C${i}`, markets: [{ key: 'h2h', outcomes: [{ name: 'Lakers', price: p }, { name: 'Celtics', price: 2.0 }] }] })),
      },
    ],
  });
}

test('mercado profundo, de acuerdo y fresco: calidad ALTA, dispersión BAJA', () => {
  evento('ev-bueno', [1.9, 1.91, 1.9, 1.92, 1.9, 1.91, 1.9, 1.92, 1.91], 5);
  const m = calidadMercado('ev-bueno', ['Lakers', 'Celtics'], INICIO, ahora);
  assert.equal(m.calidad, 'ALTA');
  assert.equal(m.dispersion, 'BAJA');
  assert.equal(m.casas, 9);
  const l = m.lineas.find((x) => x.seleccion === 'Lakers')!;
  assert.equal(l.mejor, 1.92);
  assert.equal(l.peor, 1.9);
  assert.match(m.etiqueta, /no es liquidez real/);
});

test('pocas casas: calidad BAJA, y lo dice', () => {
  evento('ev-fino', [1.9, 1.95], 5);
  const m = calidadMercado('ev-fino', ['Lakers', 'Celtics'], INICIO, ahora);
  assert.equal(m.calidad, 'BAJA');
  assert.match(m.motivos.join(' '), /solo 2 casa/);
});

test('casas muy en desacuerdo: dispersión ALTA (la probabilidad «del mercado» informa menos)', () => {
  evento('ev-disperso', [1.7, 1.8, 1.9, 2.1, 2.2, 1.75, 1.85, 2.0], 5);
  const m = calidadMercado('ev-disperso', ['Lakers', 'Celtics'], INICIO, ahora);
  assert.equal(m.dispersion, 'ALTA');
  assert.ok(m.lineas[0].dispersionPp > MERCADO_UMBRALES.dispersionMedia);
  assert.notEqual(m.calidad, 'ALTA');
});

test('precio sin observar en horas: calidad BAJA', () => {
  evento('ev-viejo', [1.9, 1.91, 1.9, 1.92, 1.9, 1.91, 1.9, 1.92], 9 * 60);
  const m = calidadMercado('ev-viejo', ['Lakers', 'Celtics'], INICIO, ahora);
  assert.equal(m.calidad, 'BAJA');
  assert.match(m.motivos.join(' '), /no se ha observado en 9 h/);
});

test('sin snapshots: SIN DATOS, nunca una calidad inventada', () => {
  assert.equal(calidadMercado('no-existe', ['A', 'B'], INICIO, ahora).calidad, 'SIN DATOS');
  assert.equal(calidadMercado(null, null, INICIO, ahora).calidad, 'SIN DATOS');
});
