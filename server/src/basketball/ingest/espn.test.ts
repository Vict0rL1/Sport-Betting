// Un forfait no es un partido. ESPN lo da por «completed» con 2–0 (NCAA femenina: USC 2–0 Northwestern
// el 16/1/2025, UCLA 2–0 Northwestern el 12/1/2025…), y se guardaba como un partido jugado: el nocturno
// «Datos» fallaba con «13 partidos fuera de rango (15–200)», y cada uno entraba en los ratings como una
// victoria por 2 (docs/plans/nocturno-datos.md, fallo 7). Ningún equipo acaba un partido jugado con 0
// puntos. Payload sintético con la forma del calendario de ESPN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../test/setup.ts';

const { parseSchedule } = await import('./espn.ts');

const evento = (date: string, home: [string, string], away: [string, string]) => ({
  date,
  seasonType: { type: 2, name: 'Regular Season' },
  competitions: [
    {
      date,
      neutralSite: false,
      status: { type: { completed: true } },
      competitors: [
        { homeAway: 'home', team: { displayName: home[0] }, score: { value: Number(home[1]), displayValue: home[1] } },
        { homeAway: 'away', team: { displayName: away[0] }, score: home[1] === 'x' ? undefined : away[1] },
      ],
    },
  ],
});

test('un forfait (un equipo con 0 puntos) no se guarda como partido, y se dice', () => {
  const forfaits = new Set<string>();
  const games = parseSchedule(
    {
      events: [
        evento('2025-01-16T02:00Z', ['USC Trojans', '2'], ['Northwestern Wildcats', '0']),
        evento('2025-01-19T20:00Z', ['USC Trojans', '78'], ['Oregon Ducks', '61']),
        evento('2025-01-12T22:00Z', ['UCLA Bruins', '2'], ['Northwestern Wildcats', '0']),
      ],
    },
    2025,
    forfaits,
  );
  assert.deepEqual(games.map((g) => `${g.homeName} ${g.homePts}-${g.awayPts} ${g.awayName}`), ['USC Trojans 78-61 Oregon Ducks']);
  assert.equal(forfaits.size, 2);
});

test('sin el conjunto de forfaits, también se saltan (quien no pregunta no los recibe como partidos)', () => {
  const games = parseSchedule({ events: [evento('2025-01-16T02:00Z', ['USC Trojans', '2'], ['Northwestern Wildcats', '0'])] }, 2025);
  assert.equal(games.length, 0);
});
