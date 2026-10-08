// Cuadro sintético: las probabilidades de ronda son coherentes y el favorito gana más; sin
// fuente de cuadros, la API lo dice en vez de inventar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { simularCuadro, nombresRondas, torneoTenis } = await import('./torneo.ts');

test('simularCuadro: ocho jugadores, favorito claro, determinista', () => {
  const jugadores = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const fuerza = new Map(jugadores.map((j, i) => [j, 8 - i]));
  const prob = (x: string, y: string) => (fuerza.get(x) as number) / ((fuerza.get(x) as number) + (fuerza.get(y) as number));
  const r1 = simularCuadro({ jugadores }, prob, 3, 5000);
  const r2 = simularCuadro({ jugadores }, prob, 3, 5000);
  assert.deepEqual(r1, r2);
  assert.equal(r1.length, 8);
  assert.ok(Math.abs(r1.reduce((s, j) => s + j.campeon, 0) - 1) < 1e-9, 'un campeón');
  const a = r1.find((j) => j.id === 'a') as (typeof r1)[number];
  assert.ok(a.campeon > 0.15 && a.campeon > (r1.find((j) => j.id === 'h') as (typeof r1)[number]).campeon);
  assert.ok(a.rondas[0] >= a.rondas[1] && a.rondas[1] >= a.rondas[2], 'alcanzar una ronda exige la anterior');
  assert.ok(Math.abs(a.rondas[0] - prob('a', 'b')) < 0.03, 'primera ronda = ganar al rival del cuadro');
  assert.deepEqual(nombresRondas(8), ['semifinal', 'final', 'campeón'], 'lo que se alcanza al ganar cada ronda');
  assert.deepEqual(nombresRondas(16), ['cuartos', 'semifinal', 'final', 'campeón']);
  assert.deepEqual(nombresRondas(2), ['campeón']);
  assert.throws(() => simularCuadro({ jugadores: ['a', 'b', 'c'] }, prob, 1, 10), /potencia de 2/);
  const bye = simularCuadro({ jugadores: ['a', null, 'c', 'd'] }, prob, 1, 100);
  assert.equal((bye.find((j) => j.id === 'a') as (typeof bye)[number]).rondas[0], 1, 'el bye pasa de ronda seguro');
});

test('torneoTenis: sin fuente de cuadros lo dice y no inventa un campeón', () => {
  const t = torneoTenis(new Date('2026-10-07T00:00:00Z'));
  assert.equal(t.cuadroDisponible, false);
  assert.match(t.motivo, /cuadro/);
  assert.ok(Array.isArray(t.siguientes));
});
