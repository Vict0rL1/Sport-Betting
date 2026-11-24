// Fase C del seguimiento del PR #18: las explicaciones de las tarjetas y la ficha llegan como códigos con
// parámetros (server/src/explicaciones/). Cada código necesita su frase en los dos catálogos, y la
// española es la MISMA que la del servidor: así la web en español dice lo que decía antes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { es } from './es';
import { en } from './en';
import { EXPLICACIONES } from '../../../server/src/explicaciones/catalogo.ts';
import { explica, int, porc, txt, lista, dec, signo, miles, exacto } from '../../../server/src/explicaciones/index.ts';
import { escribir, escribirJunto, escribirTodas, valorEn } from '../lib/explicacion.ts';
import { fijarIdiomaFormato } from '../lib/formato.ts';

const marcas = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]))].sort().join(',');
const cat = EXPLICACIONES as Record<string, string>;

test('cada código del servidor tiene su frase en es.ts (la misma) y en en.ts (traducida, con los mismos parámetros)', () => {
  for (const [k, plantilla] of Object.entries(cat)) {
    const clave = `explica.${k}` as keyof typeof es;
    assert.equal(es[clave], plantilla, `es.ts no dice lo mismo que el servidor en ${k}`);
    const ingles = (en as Record<string, string>)[clave];
    assert.ok(ingles, `${k} sin inglés`);
    assert.notEqual(ingles, plantilla, `${k} sin traducir`);
    assert.equal(marcas(ingles), marcas(plantilla), `${k}: parámetros distintos`);
  }
  const sobran = Object.keys(es).filter((k) => k.startsWith('explica.') && !(k.slice('explica.'.length) in cat));
  assert.deepEqual(sobran, [], 'claves explica.* sin código en el servidor');
});

/** Un t() mínimo con las mismas reglas que el de la app (plurales y luego variables). */
const tDe = (cat: Record<string, string>) => (clave: string, vars: Record<string, string | number> = {}) => {
  let s = cat[clave];
  s = s.replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (todo, k: string, uno: string, varios: string) => (k in vars ? (Number(vars[k]) === 1 ? uno : varios) : todo));
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

test('en español, la web escribe exactamente la frase del servidor; en inglés, la suya', () => {
  const casos = [
    explica('nhl.titular', { fav: txt('Boston Bruins'), p: porc(0.6234) }),
    explica('nhl.fiab.parado', { equipos: lista(['Utah', 'Seattle Kraken']), n: int(2), dias: int(100) }),
    explica('nhl.fiab.parado', { equipos: lista(['Utah']), n: int(1), dias: int(100) }),
    explica('nfl.margen', { margen: signo(3.5, 1), local: txt('Kansas City Chiefs'), puntosLocal: dec(24.4, 1), puntosVisitante: dec(20.9, 1) }),
    explica('nfl.mercado.linea', { p: porc(0.58), linea: { t: 'signo', v: -3.5, d: 1 }, n: miles(7276), brierMercado: dec(0.2115, 4), brierModelo: dec(0.218, 4) }),
    explica('nfl.fiab.temporadas', { n: int(1) }),
    explica('nfl.fiab.temporadas', { n: int(3) }),
    explica('ufc.factor.edad', { quien: txt('A'), pp: dec(2.4, 1), joven: txt('A'), anios: exacto(3.5) }),
    explica('nfl.veredicto', { equipo: txt('Kansas City Chiefs') }),
  ];
  fijarIdiomaFormato('es');
  for (const c of casos) assert.equal(escribir(tDe(es) as never, 'es', c, '¿?'), c.texto, c.codigo);
  fijarIdiomaFormato('en');
  const ingles = casos.map((c) => escribir(tDe({ ...es, ...en }) as never, 'en', c, '¿?'));
  assert.equal(ingles[0], 'Boston Bruins wins with 62.3% (overtime and shootout included)');
  assert.equal(ingles[1], 'Utah and Seattle Kraken have not played for more than 100 days: their Elo is last season\'s.');
  assert.equal(ingles[2], 'Utah has not played for more than 100 days: their Elo is last season\'s.');
  assert.match(ingles[4], /Measured over 7,276 games/);
  assert.match(ingles[4], /\(−3\.5\)/);
  assert.equal(ingles[5], '1 season is missing from the history: the Elo ratings do not describe today\'s rosters.');
  assert.equal(ingles[6], '3 seasons are missing from the history: the Elo ratings do not describe today\'s rosters.');
  assert.equal(ingles[8], 'Kansas City Chiefs wins');
  fijarIdiomaFormato('es');
});

test('un código que el catálogo no conoce, o que no llega, enseña la frase del servidor: nunca una clave', () => {
  const t = tDe(es) as never;
  assert.equal(escribir(t, 'en', { codigo: 'deporte.nuevo', params: {} }, 'Frase del servidor'), 'Frase del servidor');
  assert.equal(escribir(t, 'en', null, 'Frase del servidor'), 'Frase del servidor');
  assert.deepEqual(escribirTodas(t, 'es', undefined, ['a', 'b']), ['a', 'b']);
  // Si no casan en número (un servidor que cambió a medias), las frases del servidor.
  assert.deepEqual(escribirTodas(t, 'es', [{ codigo: 'nhl.fiab.igualado', params: {} }], ['a', 'b']), ['a', 'b']);
  // Un párrafo con una pieza desconocida: el párrafo del servidor entero, no uno a medias.
  assert.equal(escribirJunto(t, 'es', [{ codigo: 'nhl.fiab.igualado', params: {} }, { codigo: 'nuevo', params: {} }], 'Párrafo del servidor'), 'Párrafo del servidor');
  assert.equal(escribirJunto(t, 'es', [{ codigo: 'nhl.fiab.igualado', params: {} }], 'x'), es['explica.nhl.fiab.igualado']);
});

test('los nombres van tal cual en los dos idiomas', () => {
  assert.equal(valorEn({ t: 'txt', v: 'Atlético de Madrid' }, 'en'), 'Atlético de Madrid');
  assert.equal(valorEn({ t: 'int', v: 1650 }, 'en'), '1650', 'un Elo no lleva separador de miles');
  assert.equal(valorEn({ t: 'miles', v: 7276 }, 'es'), '7.276');
});
