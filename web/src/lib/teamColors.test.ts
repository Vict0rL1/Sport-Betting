// Colores de club (Fase 5.23): las cuatro ligas nuevas y la NBA actual casan con los nombres
// tal como los guarda la base; lo desconocido sale neutro, nunca inventado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crestColors } from './teamColors';

test('las ligas nuevas casan por el nombre largo de la base', () => {
  assert.deepEqual(crestColors('laliga', 'Club Atlético de Madrid'), { primary: '#cb3524', secondary: '#272e61', known: true });
  assert.equal(crestColors('laliga', 'FC Barcelona').primary, '#a50044');
  assert.equal(crestColors('seriea', 'FC Internazionale Milano').known, true);
  assert.equal(crestColors('bundesliga', '1. FC Köln').known, true);
  assert.equal(crestColors('ligue1', 'Paris Saint-Germain FC').primary, '#004170');
});

test('NBA: las 30 franquicias actuales, también con los ids cortos de la base', () => {
  for (const id of ['sixers', 'trailblazers', 'thunder', 'spurs', 'charlotte-hornets']) assert.equal(crestColors('nba', id).known, true, id);
});

test('lo que no está sale neutro', () => {
  assert.equal(crestColors('championship', 'Equipo Inventado FC').known, false);
});
