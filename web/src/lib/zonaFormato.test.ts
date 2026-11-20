// G1 (revisión del PR 17): la zona elegida en Ajustes vale en toda la app, no solo en Partidos.
// Medianoche, cambio de hora y valores inválidos.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const almacen = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => void almacen.set(k, v),
  removeItem: (k: string) => void almacen.delete(k),
};
const { formatearInstante, leerZona, CLAVE_ZONA } = await import('./zona.ts');
const { dayKey, todayKey, shortTime, daysFromToday } = await import('./format.ts');
const { formato } = await import('../i18n/index.tsx');

const hora = { hour: '2-digit', minute: '2-digit' } as const;

test('G1: medianoche: el mismo instante es de otro día según la zona elegida', () => {
  almacen.set(CLAVE_ZONA, 'Europe/Madrid');
  assert.equal(dayKey('2026-11-20T23:30:00Z'), '2026-11-21');
  assert.equal(shortTime('2026-11-20T23:30:00Z'), '00:30');
  assert.equal(formato('es').fecha('2026-11-20T23:30:00Z', hora), '00:30');
  almacen.set(CLAVE_ZONA, 'America/New_York');
  assert.equal(dayKey('2026-11-20T23:30:00Z'), '2026-11-20');
  assert.equal(shortTime('2026-11-20T23:30:00Z'), '18:30');
  assert.equal(todayKey(new Date('2026-11-21T03:00:00Z')), '2026-11-20', 'aún es el 20 en Nueva York');
  assert.equal(daysFromToday('2026-11-21', new Date('2026-11-21T03:00:00Z')), 1);
});

test('G1: cambio de hora en Madrid (29-mar y 25-oct de 2026)', () => {
  assert.equal(formatearInstante('2026-03-29T00:30:00Z', 'es-ES', hora, 'Europe/Madrid'), '01:30');
  assert.equal(formatearInstante('2026-03-29T01:30:00Z', 'es-ES', hora, 'Europe/Madrid'), '03:30', 'de 02:00 se salta a 03:00');
  assert.equal(formatearInstante('2026-10-25T00:30:00Z', 'es-ES', hora, 'Europe/Madrid'), '02:30');
  assert.equal(formatearInstante('2026-10-25T01:30:00Z', 'es-ES', hora, 'Europe/Madrid'), '02:30', 'las 02:30 pasan dos veces');
});

test('G1: valores inválidos: una fecha rota no lanza ni enseña «Invalid Date», y una zona rota vuelve a la del navegador', () => {
  assert.equal(formatearInstante('no es fecha', 'es-ES', hora, 'Europe/Madrid'), '—');
  assert.equal(formatearInstante('2026-11-20T10:00:00Z', 'es-ES', hora, 'Marte/Olympus'), formatearInstante('2026-11-20T10:00:00Z', 'es-ES', hora, Intl.DateTimeFormat().resolvedOptions().timeZone));
  almacen.set(CLAVE_ZONA, 'Marte/Olympus');
  assert.equal(leerZona(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  assert.equal(dayKey('roto'), 'invalid');
});
