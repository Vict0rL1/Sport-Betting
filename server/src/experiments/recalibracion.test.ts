import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import '../test/setup.ts';

const { registrarRecalibracion, MIN_PARES, NOTA_HOLDOUT } = await import('./recalibracion.ts');
const { REGISTRY_PATH, readRegistry } = await import('./registry.ts');
const { walkForward, SEGMENTOS_GENERICOS, bandaDe, guardarWalkForward, WALKFORWARD_DIR } = await import('../evaluation/walkforward.ts');

const wfFalso = (modelo: number[], recal: number[]) => ({ sport: 'basketball', model_version: 'basketball-test', pares: { modelo, recalibrado: recal } }) as never;

test('registrarRecalibracion: sin muestra no escribe; con mejora clara escribe inconclusive/accepted:false con la nota del holdout; no repite el mismo día', () => {
  const antes = fs.existsSync(REGISTRY_PATH) ? fs.readFileSync(REGISTRY_PATH, 'utf8') : null;
  try {
    assert.equal(registrarRecalibracion('basketball', wfFalso([0.7, 0.6], [0.6, 0.5])), null);
    const modelo = Array.from({ length: MIN_PARES + 50 }, (_, i) => 0.6 + ((i * 7919) % 100) / 1000);
    const recal = modelo.map((x) => x - 0.02);
    const e = registrarRecalibracion('basketball', wfFalso(modelo, recal))!;
    assert.ok(e);
    assert.equal(e.accepted, false);
    assert.equal(e.verdict, 'inconclusive');
    assert.ok(e.result.delta < 0 && e.result.ciHi < 0);
    assert.match(e.reason ?? '', new RegExp(NOTA_HOLDOUT.slice(0, 30)));
    assert.equal(registrarRecalibracion('basketball', wfFalso(modelo, recal)), null, 'ya está hoy');
    const peor = registrarRecalibracion('nfl', wfFalso(modelo, modelo.map((x) => x + 0.03)))!;
    assert.equal(peor.verdict, 'rejected');
    assert.ok(readRegistry().experiments.some((x) => x.id === e.id));
  } finally {
    if (antes == null) fs.rmSync(REGISTRY_PATH, { force: true });
    else fs.writeFileSync(REGISTRY_PATH, antes);
  }
});

test('walk-forward: devuelve pares por partido, segmentos genéricos, y el JSON guardado no lleva los pares', () => {
  const juegos = [];
  let s = 11;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 1400; i++) {
    const fecha = `2024${String(1 + Math.floor(i / 120)).padStart(2, '0')}${String(1 + (i % 28)).padStart(2, '0')}`;
    const p = 0.35 + rnd() * 0.4;
    juegos.push({ fecha, temporada: 2024, a: `t${i % 10}`, b: `t${(i * 3 + 1) % 10}`, local: true, y: rnd() < p ? 0 : 1, K: 2 as const, modelo: [p, 1 - p] });
  }
  const wf = walkForward('basketball', juegos as never);
  assert.ok(wf.pares && wf.pares.modelo.length > 500 && wf.pares.modelo.length === wf.pares.recalibrado.length);
  assert.ok(Object.keys(wf.porSegmento).includes('favorito') && Object.keys(wf.porSegmento).includes('mes'));
  assert.equal(bandaDe([0.72, 0.28]), '70–80 %');
  assert.equal(bandaDe([0.95, 0.05]), '90 %+');
  assert.equal(SEGMENTOS_GENERICOS['día de la semana']({ fecha: '20241006' } as never), 'domingo');
  assert.equal(SEGMENTOS_GENERICOS.favorito({ modelo: [0.3, 0.7], local: true } as never), 'visitante favorito');
  // El fichero de referencia del baloncesto está versionado: se guarda antes y se repone después.
  const ruta = path.join(WALKFORWARD_DIR, 'basketball.json');
  const antes = fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8') : null;
  try {
    const f = guardarWalkForward({ ...wf, sport: 'basketball' });
    assert.equal(f, ruta);
    assert.ok(!fs.readFileSync(f, 'utf8').includes('"pares"'));
  } finally {
    if (antes == null) fs.rmSync(ruta, { force: true });
    else fs.writeFileSync(ruta, antes);
  }
});
