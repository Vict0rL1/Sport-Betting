// Búsqueda global: sin acentos, por subcadena, empieza-por primero, y ligas de la configuración.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { buscar, normalizar } = await import('./index.ts');
const { getDb } = await import('../db.ts');

test('normalizar quita acentos y mayúsculas', () => {
  assert.equal(normalizar('  Atlético MADRID '), 'atletico madrid');
});

test('buscar: equipos, jugadores, ligas y partidos próximos reales; nada con menos de 2 letras', () => {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO fb_teams (id, league, name) VALUES ('atletico-madrid', 'laliga', 'Club Atlético de Madrid')").run();
  db.prepare("INSERT OR IGNORE INTO fb_teams (id, league, name) VALUES ('madrid-cff', 'laliga', 'Madrid CFF')").run();
  db.prepare("INSERT OR IGNORE INTO players (id, tour, name, country) VALUES (999001, 'atp', 'Jannik Sinner', 'ITA')").run();
  assert.deepEqual(buscar('a'), []);
  const r = buscar('atletico');
  assert.ok(r.some((x) => x.tipo === 'equipo' && x.id === 'atletico-madrid' && x.ruta === '/equipo/football/laliga/atletico-madrid'));
  const m = buscar('madrid');
  assert.equal(m[0].etiqueta, 'Madrid CFF', 'los que empiezan por lo buscado van primero');
  const j = buscar('sinner');
  assert.ok(j.some((x) => x.tipo === 'jugador' && x.ruta === '/jugador/atp/999001'));
  const l = buscar('premier');
  assert.ok(l.some((x) => x.tipo === 'liga' && x.league === 'epl'));
});
