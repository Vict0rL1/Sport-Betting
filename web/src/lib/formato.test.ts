// D5 (revisión del 8 de octubre): los números de la interfaz salían con `toFixed` (punto
// decimal en español, sin espacio duro antes del %), el banco de papel inventaba un «$» y los
// rangos se partían de línea por el guion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dinero, fijarIdiomaFormato, num, pct } from './formato.ts';
import { pct as pctTema } from './theme.ts';
import { es } from '../i18n/es.ts';
import { en } from '../i18n/en.ts';

const NBSP = ' ';

test('D5: pct y num siguen el idioma activo, con Intl', () => {
  fijarIdiomaFormato('es');
  assert.equal(pct(0.523), `52,3${NBSP}%`);
  assert.equal(pct(0.5, 0), `50${NBSP}%`);
  assert.equal(num(1.955, 2), '1,96');
  assert.equal(pctTema(0.523), `52,3${NBSP}%`, 'el pct de theme.ts (182 usos) es el mismo');
  fijarIdiomaFormato('en');
  assert.equal(pct(0.523), '52.3%');
  assert.equal(num(1.955, 2), '1.96');
  fijarIdiomaFormato('es');
});

test('D5: el dinero del banco de papel, con Intl y sin inventar moneda (lib/bets.ts)', () => {
  assert.equal(dinero(-12.5, 'es'), '−12,50');
  assert.equal(dinero(1234.5, 'en'), '1,234.50');
  assert.equal(dinero(0, 'es'), '0,00');
});

test('D5: los rangos del catálogo no se parten de línea', () => {
  for (const [nombre, cat] of [['es', es], ['en', en]] as const) {
    for (const [k, v] of Object.entries(cat as Record<string, string>)) {
      if (/\{\w+\} [–-] \{\w+\}/.test(v)) assert.fail(`${nombre} ${k}: rango con espacios normales: ${v}`);
    }
  }
});

// G5b (segunda pasada de ui-tester): un número que llega tal cual a la pantalla (una fila de
// comparación, un `Num` de las fichas) sale con la coma o el punto del idioma y los decimales que
// trae: «1.43» al lado de «total 2,64» en la misma tarjeta.
test('G5b: cifra() escribe el número con los decimales que trae, en el idioma y sin separador de miles', async () => {
  const { cifra } = await import('./formato.ts');
  assert.equal(cifra(1.43, 'es'), '1,43');
  assert.equal(cifra(1682.5, 'es'), '1682,5');
  assert.equal(cifra(-8.6, 'es'), '−8,6');
  assert.equal(cifra(115, 'es'), '115');
  assert.equal(cifra(2026, 'en'), '2026');
  assert.equal(cifra(18.8, 'en'), '18.8');
  assert.equal(cifra(0.1 + 0.2, 'es'), '0,3');
});

test('G5b: las líneas de una selección («Over 2.5», «Yankees −1.5») se escriben en el idioma al pintarlas', async () => {
  const { lineasEnIdioma } = await import('./formato.ts');
  assert.equal(lineasEnIdioma('Over 227.5', 'es'), 'Over 227,5');
  assert.equal(lineasEnIdioma('New York Yankees −1.5', 'es'), 'New York Yankees −1,5');
  assert.equal(lineasEnIdioma('Over 2.5', 'en'), 'Over 2.5');
  assert.equal(lineasEnIdioma('1. FC Köln', 'es'), '1. FC Köln', 'un nombre con punto no es una línea');
});
