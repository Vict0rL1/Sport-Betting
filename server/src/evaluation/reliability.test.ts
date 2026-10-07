// Diagramas de fiabilidad: cubetas con recuento, ECE igual que la capa común, y el fichero
// del backtest se escribe sin mezclar orígenes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../test/setup.ts';

const { diagrama, guardarDiagramaBacktest, leerDiagramasBacktest, RELIABILITY_PATH, fiabilidad } = await import('./reliability.ts');
const { ece } = await import('./metrics.ts');

const xs = [
  { p: [0.95, 0.05], y: 0 },
  { p: [0.92, 0.08], y: 0 },
  { p: [0.55, 0.45], y: 1 },
  { p: [0.52, 0.48], y: 0 },
  { p: [0.3, 0.7], y: 1 },
];

test('diagrama: cada probabilidad dicha cae en su cubeta y la frecuencia observada es la real', () => {
  const d = diagrama('live', 'nfl', xs);
  assert.equal(d.partidos, 5);
  assert.equal(d.cubetas.length, 10);
  assert.equal(d.cubetas.reduce((s, c) => s + c.n, 0), 10, 'dos salidas por partido');
  const alta = d.cubetas[9];
  assert.equal(alta.n, 2);
  assert.equal(alta.observada, 1);
  assert.ok(Math.abs((alta.predicha as number) - 0.935) < 1e-9);
  const baja = d.cubetas[0];
  assert.equal(baja.n, 2);
  assert.equal(baja.observada, 0);
  assert.ok(Math.abs((d.ece as number) - ece(xs)) < 1e-12, 'el mismo ECE que metrics.ts');
  assert.equal(d.aviso.nivel, 'insuficiente');
  const vacio = diagrama('live', 'nfl', []);
  assert.equal(vacio.ece, null);
  assert.ok(vacio.cubetas.every((c) => c.n === 0 && c.predicha === null));
});

test('el fichero del backtest se escribe por deporte, ordenado, y lo vivo nunca entra en él', () => {
  const antes = fs.existsSync(RELIABILITY_PATH) ? fs.readFileSync(RELIABILITY_PATH, 'utf8') : null;
  try {
    const d = guardarDiagramaBacktest('nfl', xs);
    assert.equal(d.origen, 'backtest');
    assert.match(d.model_version as string, /^nfl-/);
    const leido = leerDiagramasBacktest();
    assert.equal(leido.nfl?.partidos, 5);
    const f = fiabilidad('nfl');
    assert.equal(f.backtest?.origen, 'backtest');
    assert.equal(f.live.origen, 'live');
  } finally {
    if (antes == null) fs.rmSync(RELIABILITY_PATH, { force: true });
    else fs.writeFileSync(RELIABILITY_PATH, antes);
  }
});
