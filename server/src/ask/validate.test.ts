// La lista permitida del asistente, contra entradas adversarias: nombres de herramienta con
// SQL, argumentos con SQL, tamaños absurdos, tipos equivocados. Nada de eso llega a la
// base como otra cosa que una cadena parametrizada, y las tablas siguen ahí después.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../test/setup.ts';

const { validarIntencion, MAX_TEXTO, CLASIFICACION_MAX } = await import('./validate.ts');
const { ejecutar } = await import('./router.ts');
const { getDb } = await import('../db.ts');
const { masterDe } = await import('../db/ledgerize.ts');
const { LEDGER_SCHEMA } = await import('../db/layout.ts');

const SQL = "'; DROP TABLE players; --";

test('nombres de herramienta fuera de la lista → ninguna, vengan como vengan', () => {
  for (const nombre of ['DROP TABLE players', 'jugador; DELETE FROM bets', 'exec', 'sql', '', 'Jugador', 'constructor', '__proto__']) {
    assert.equal(validarIntencion({ herramienta: nombre, argumentos: ['x'] }).herramienta, 'ninguna', nombre);
    assert.equal(validarIntencion({ name: nombre, input: { nombre: 'x' } }).herramienta, 'ninguna', nombre);
  }
  assert.equal(validarIntencion(null).herramienta, 'ninguna');
  assert.equal(validarIntencion('jugador').herramienta, 'ninguna');
  assert.equal(validarIntencion(42).herramienta, 'ninguna');
});

test('argumentos: acotados, sin caracteres de control, con los valores de la lista', () => {
  assert.deepEqual(validarIntencion({ herramienta: 'jugador', argumentos: [SQL] }), { herramienta: 'jugador', argumentos: [SQL] }, 'el SQL es solo texto: se busca tal cual, parametrizado');
  assert.equal(validarIntencion({ herramienta: 'jugador', argumentos: ['x'.repeat(MAX_TEXTO + 1)] }).herramienta, 'ninguna', 'demasiado largo');
  assert.equal(validarIntencion({ herramienta: 'jugador', argumentos: ['al\u0000caraz'] }).herramienta, 'ninguna', 'carácter de control');
  assert.equal(validarIntencion({ herramienta: 'jugador', argumentos: [42] }).herramienta, 'ninguna', 'tipo equivocado');
  assert.equal(validarIntencion({ herramienta: 'jugador', argumentos: [] }).herramienta, 'ninguna', 'falta el nombre');
  assert.equal(validarIntencion({ herramienta: 'caraACara', argumentos: ['a'] }).herramienta, 'ninguna', 'faltan argumentos');
  assert.deepEqual(validarIntencion({ herramienta: 'prediccion', argumentos: ['a', 'b', 'clay'] }).argumentos, ['a', 'b', 'tierra']);
  assert.deepEqual(validarIntencion({ herramienta: 'prediccion', argumentos: ['a', 'b', 'marte'] }).argumentos, ['a', 'b', 'dura'], 'superficie desconocida → la de por defecto');
  assert.deepEqual(validarIntencion({ herramienta: 'clasificacion', argumentos: ['999999', 'wta'] }).argumentos, [String(CLASIFICACION_MAX), 'wta']);
  assert.deepEqual(validarIntencion({ herramienta: 'clasificacion', argumentos: ['-5', 'nba'] }).argumentos, ['1', 'atp']);
  assert.deepEqual(validarIntencion({ herramienta: 'clasificacion', argumentos: ['1e308', "' OR 1=1"] }).argumentos, [String(CLASIFICACION_MAX), 'atp']);
  assert.deepEqual(validarIntencion({ name: 'clasificacion', input: { n: 7, tour: 'wta' } }).argumentos, ['7', 'wta']);
  assert.deepEqual(validarIntencion({ herramienta: 'estadoDatos', argumentos: ['basura', 'más basura'] }).argumentos, [], 'los extras se descartan');
});

test('ejecutar con SQL dentro de los argumentos no rompe nada: las tablas siguen y la respuesta es texto', () => {
  const db = getDb();
  const tablas = () => (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
  const antes = tablas();
  for (const intencion of [
    { herramienta: 'jugador', argumentos: [SQL] },
    { herramienta: 'caraACara', argumentos: [SQL, '1 UNION SELECT * FROM bets'] },
    { herramienta: 'prediccion', argumentos: ["x' OR '1'='1", SQL, SQL] },
    { herramienta: 'clasificacion', argumentos: [SQL, SQL] },
    { herramienta: 'DROP TABLE players', argumentos: [] },
  ] as const) {
    const r = ejecutar(intencion as never);
    assert.equal(typeof r.texto, 'string');
    assert.ok(r.texto.length > 0);
  }
  assert.equal(tablas(), antes, 'ninguna tabla desapareció');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'players'").get(), 'players sigue');
  assert.ok(db.prepare(`SELECT 1 FROM ${masterDe('bets', LEDGER_SCHEMA)} WHERE name = 'bets'`).get(), 'bets sigue');
});

// Prueba estática: el SQL del asistente no concatena entrada del usuario. Las únicas
// interpolaciones `${…}` dentro de `prepare(...)` son identificadores internos fijos.
test('el SQL de tools.ts solo interpola identificadores internos, nunca argumentos', () => {
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  const fuente = fs.readFileSync(path.join(aqui, 'tools.ts'), 'utf8');
  const interpolaciones: string[] = [];
  const re = /prepare\(\s*`([\s\S]*?)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente))) {
    for (const x of m[1].matchAll(/\$\{([^}]*)\}/g)) interpolaciones.push(x[1].trim());
  }
  const permitidas = new Set(['d.tabla']);
  for (const i of interpolaciones) assert.ok(permitidas.has(i), `interpolación en SQL de tools.ts no permitida: \${${i}}`);
});
