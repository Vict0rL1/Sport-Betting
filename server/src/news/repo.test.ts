// matchPlayer: una noticia se empareja con un jugador real o con nadie. El nocturno «Datos» fallaba en
// `verify:data` («un apellido ambiguo no se resuelve a ciegas — «timber» lo llevan 2 jugadores»): con los
// datos de FPL de 2026-27 hay un «J.Timber» en el Arsenal y un «Timber» en el Crystal Palace, y
// matchPlayer('timber') devolvía el del Palace. Jugadores sintéticos, con los mismos nombres de la fuente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { matchPlayer } = await import('./repo.ts');

function jugadores(league: string, filas: [id: string, team: string, name: string][]): void {
  const ins = getDb().prepare("INSERT INTO fb_players (id, league, team_id, name, position) VALUES (?, ?, ?, ?, 'MID')");
  for (const [id, team, name] of filas) ins.run(id, league, team, name);
}

test('dos jugadores con el mismo apellido («J.Timber» y «Timber»): el apellido solo no empareja a nadie', () => {
  jugadores('t_timber', [
    ['5', 'arsenal', 'J.Timber'],
    ['644', 'crystal-palace', 'Timber'],
    ['7', 'arsenal', 'Saka'],
  ]);
  assert.equal(matchPlayer('t_timber' as never, 'timber'), null, 'un empate se resuelve NO eligiendo');
  assert.equal(matchPlayer('t_timber' as never, 'Timber'), null, 'tampoco con la grafía exacta de uno de los dos');
  // Con el equipo, ya no es un empate.
  assert.equal(matchPlayer('t_timber' as never, 'Timber', 'arsenal')?.id, '5');
  assert.equal(matchPlayer('t_timber' as never, 'Timber', 'crystal-palace')?.id, '644');
  // El nombre completo de uno, tal cual, sí lo identifica.
  assert.equal(matchPlayer('t_timber' as never, 'J.Timber')?.id, '5');
  assert.equal(matchPlayer('t_timber' as never, 'Saka')?.id, '7');
});

test('«J.Timber» se empareja por el apellido: la inicial con punto no se pega al apellido', () => {
  jugadores('t_inicial', [
    ['5', 'arsenal', 'J.Timber'],
    ['9', 'arsenal', 'B.White'],
  ]);
  assert.equal(matchPlayer('t_inicial' as never, 'Jurriën Timber')?.id, '5');
  assert.equal(matchPlayer('t_inicial' as never, 'Timber')?.id, '5');
  assert.equal(matchPlayer('t_inicial' as never, 'Ben White')?.id, '9');
});

test('lo que ya funcionaba sigue igual: nombre exacto, apellido único, inventado, apellido corto', () => {
  jugadores('t_base', [
    ['1', 'liverpool', 'Salah'],
    ['2', 'liverpool', 'Alexander-Arnold'],
    ['3', 'chelsea', 'Bruno G.'],
    ['4', 'chelsea', 'Silva Junior'],
    ['5', 'chelsea', 'Thiago Silva'],
  ]);
  assert.equal(matchPlayer('t_base' as never, 'Mohamed Salah')?.id, '1');
  assert.equal(matchPlayer('t_base' as never, 'Alexander-Arnold')?.id, '2');
  assert.equal(matchPlayer('t_base' as never, 'Thiago Silva')?.id, '5');
  assert.equal(matchPlayer('t_base' as never, 'Jugador Que No Existe'), null);
  assert.equal(matchPlayer('t_base' as never, 'Li'), null, 'un apellido de menos de 3 letras no empareja');
  assert.equal(matchPlayer('t_base' as never, ''), null);
});
