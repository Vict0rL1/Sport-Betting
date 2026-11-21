// G1 (revisión del PR 17): un DÍA de calendario («datos hasta el 20 de noviembre») no es un instante.
// El servidor lo manda como «2026-11-20T00:00:00.000Z» (o «2026-11-20», o «20261120») y la web lo
// formateaba con la zona del navegador: al oeste de UTC salía el 19. Este fichero corre en Nueva York.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { diaDeCalendario } = await import('./zona.ts');
const { staleness } = await import('./staleness.ts');

test('el día del servidor es ese día en cualquier zona', () => {
  assert.equal(new Date('2026-11-20T00:00:00.000Z').getDate(), 19, 'la prueba corre al oeste de UTC');
  for (const s of ['2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00Z', '2026-11-20', '20261120']) {
    const d = diaDeCalendario(s);
    assert.ok(d, s);
    assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2026, 11, 20], s);
  }
});

test('un instante con hora no es un día de calendario, y lo inválido tampoco', () => {
  assert.equal(diaDeCalendario('2026-11-20T15:00:00Z'), null);
  assert.equal(diaDeCalendario('2026-02-30'), null);
  assert.equal(diaDeCalendario('ayer'), null);
  assert.equal(diaDeCalendario(null), null);
});

test('«Datos de» un archivo que llega hasta el 1 de septiembre dice septiembre, no agosto', () => {
  const s = staleness('football', '2025-09-01', false, new Date('2025-09-10T12:00:00Z'));
  assert.equal(s?.through.getMonth(), 8);
  assert.equal(s?.through.getDate(), 1);
});
