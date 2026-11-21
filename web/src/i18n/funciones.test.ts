// G2 (revisión del PR 17): las descripciones de los interruptores de Ajustes salían en español con la
// interfaz en inglés, porque llegan del servidor (config/features.json). Se traducen por el id del
// interruptor: cada uno tiene su clave `funcion.<id>` en los dos catálogos, y la española es la misma
// frase que la del fichero (la fuente), para que no se separen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { es } from './es';
import { en } from './en';

const features = (JSON.parse(readFileSync(new URL('../../../config/features.json', import.meta.url), 'utf8')) as { features: Record<string, { descripcion: string }> }).features;

test('cada interruptor de config/features.json tiene su descripción en los dos catálogos', () => {
  const faltanEs = Object.keys(features).filter((k) => !(`funcion.${k}` in es));
  const faltanEn = Object.keys(features).filter((k) => !(`funcion.${k}` in en));
  assert.deepEqual(faltanEs, [], 'sin clave en es.ts');
  assert.deepEqual(faltanEn, [], 'sin clave en en.ts');
});

test('la descripción española es la del fichero, y la inglesa no es la española', () => {
  for (const [k, f] of Object.entries(features)) {
    const clave = `funcion.${k}` as keyof typeof es;
    assert.equal(es[clave], f.descripcion, `es.ts y config/features.json no dicen lo mismo de ${k}`);
    assert.notEqual(en[clave], es[clave], `${k} sin traducir`);
  }
});

test('no hay claves funcion.* de interruptores que ya no existen', () => {
  const sobran = Object.keys(es).filter((k) => k.startsWith('funcion.') && !(k.slice('funcion.'.length) in features));
  assert.deepEqual(sobran, []);
});

test('Ajustes traduce por id y, si el servidor trae un interruptor que el catálogo no conoce, enseña su texto', async () => {
  const { claveDeFuncion } = await import('../lib/ajustes.ts');
  assert.equal(claveDeFuncion('auth.totp'), 'funcion.auth.totp');
  assert.equal(claveDeFuncion('nuevo.sinTraducir'), null);
  assert.equal(claveDeFuncion('toString'), null);
});

// Lo mismo para los trabajos programados de Ajustes → Cadencias: su descripción es la de `registrar`
// en server/src/index.ts.
const indice = readFileSync(new URL('../../../server/src/index.ts', import.meta.url), 'utf8');
const trabajos = [...indice.matchAll(/registrar\(\{\s*nombre: '([^']+)',\s*descripcion: '([^']+)'/g)].map((m) => ({ nombre: m[1], descripcion: m[2] }));

test('cada trabajo programado tiene su descripción en los dos catálogos, la española igual a la del servidor', async () => {
  const llamadas = indice.match(/\bregistrar\(/g)?.length ?? 0;
  assert.equal(trabajos.length, llamadas, `${trabajos.length} de ${llamadas} trabajos leídos: ¿cambió la forma de registrar?`);
  for (const { nombre, descripcion } of trabajos) {
    const clave = `trabajo.${nombre}` as keyof typeof es;
    assert.equal(es[clave], descripcion, `es.ts y el servidor no dicen lo mismo de ${nombre}`);
    assert.ok(en[clave] && en[clave] !== es[clave], `${nombre} sin traducir`);
  }
  const { claveDeTrabajo } = await import('../lib/ajustes.ts');
  assert.equal(claveDeTrabajo('pre-partido'), 'trabajo.pre-partido');
  assert.equal(claveDeTrabajo('otro'), null);
});
