import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../test/setup.ts';

const { registrarSombras, sombrasDe } = await import('./shadows.ts');
const { informeSombras } = await import('./evaluation.ts');
const { ajustarMedia, aplicarMedia, entrenarEnsemble, aplicar } = await import('./ensemble.ts');
const { getDb } = await import('../db.ts');
type Ev = Parameters<typeof registrarSombras>[0];

const dir = path.dirname(fileURLToPath(import.meta.url));
const db = getDb();
const INICIO = new Date(Date.now() + 5 * 3_600_000).toISOString();

const ev = (over: Partial<Ev> = {}): Ev => ({
  sport: 'baseball', matchKey: 'mlb|a|b|1', eventId: 'e', commence: INICIO, outcomes: ['A', 'B'], probs: [0.6, 0.4],
  factores: [], pendiente: 0.0057, pendienteExacta: false, sigmaHueco: null,
  fiabilidad: { nivel: 'high', margenPp: 2, motivos: [] },
  componentes: [
    { nombre: 'Elo de equipos (sin abridores)', probs: [0.55, 0.45] },
    { nombre: 'Modelo con abridores', probs: [0.6, 0.4] },
  ],
  datos: [], ood: [], regimen: { etiqueta: 'r', nota: null }, odds: [1.9, 2.0], oddsAt: null, books: 5,
  providerEventId: 'p1', providerSelections: ['A', 'B'], demo: false, ...over,
});

test('las sombras son los componentes que no son el campeón', () => {
  assert.deepEqual(sombrasDe(ev()).map((s) => s.id), ['elo-de-equipos']);
});

test('se guardan una vez, en el mismo instante que el campeón, y no se reescriben', () => {
  assert.equal(registrarSombras(ev()), 1);
  assert.equal(registrarSombras(ev({ componentes: [{ nombre: 'Elo de equipos (sin abridores)', probs: [0.9, 0.1] }] })), 0, 'la primera se queda');
  const r = db.prepare("SELECT probs, champion_probs FROM shadow_predictions WHERE match_key = 'mlb|a|b|1'").get() as { probs: string; champion_probs: string };
  assert.equal(r.probs, '[0.55,0.45]');
  assert.equal(r.champion_probs, '[0.6,0.4]');
  assert.throws(() => db.prepare("UPDATE shadow_predictions SET probs = '[1,0]'").run(), /no se reescribe/);
  assert.throws(() => db.prepare('DELETE FROM shadow_predictions').run(), /no se borra/);
  assert.equal(registrarSombras(ev({ matchKey: 'demo', demo: true })), 0, 'demostración: nada');
});

// TEST NEGATIVO: el banco de papel no puede leer las sombras, ni por error.
test('el banco de papel no toca las sombras', () => {
  for (const f of ['../paper/bankroll.ts', '../paper/signals.ts', '../staking/policy.ts']) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /shadow/i, f);
  }
});

test('el informe compara en los mismos partidos, con su diferencia y su aviso de muestra', () => {
  db.prepare(
    `INSERT INTO bsb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name,
       prob_home, reliability, predicted_at, home_runs, away_runs, resolved_at)
     VALUES ('mlb|a|b|1', 'mlb', 'e', ?, 'a', 'b', 'A', 'B', 0.6, 'high', '2026-01-01T00:00:00Z', 5, 2, ?)`,
  ).run(INICIO, INICIO);
  const [r] = informeSombras();
  assert.equal(r.n, 1);
  assert.ok((r.sombra.logLoss as number) > (r.campeon.logLoss as number), 'ganó A: el campeón (0,6) acertó mejor que la sombra (0,55)');
  assert.equal(r.diferencia.veredicto, 'muestra insuficiente');
  assert.equal(r.aviso.nivel, 'insuficiente');
});

test('media ponderada: con un componente perfecto y otro ruido, el peso va al bueno', () => {
  const xs = Array.from({ length: 400 }, (_, i) => {
    const y = i % 3 === 0 ? 1 : 0;
    return { ps: [[y === 0 ? 0.9 : 0.1, y === 0 ? 0.1 : 0.9], [0.5, 0.5]], y };
  });
  const w = ajustarMedia(xs);
  assert.ok(w[0] > 0.9, String(w));
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(aplicarMedia([[0.6, 0.4], [0.2, 0.8]], [0.5, 0.5])[0] - 0.4) < 1e-12);
});

test('ensemble con walk-forward: el peso va al componente informativo y sin muestra no se entrena', () => {
  let s = 11;
  const r = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const juegos = Array.from({ length: 1400 }, (_, i) => {
    const verdad = 0.3 + 0.4 * r();
    const y = r() < verdad ? 0 : 1;
    const a = Math.min(0.95, Math.max(0.05, verdad + (r() - 0.5) * 0.1));
    const b = 0.5;
    return {
      fecha: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000 * 0.5).toISOString().slice(0, 10),
      a: 'x', b: 'y', local: true, y, K: 2 as const, modelo: [a, 1 - a],
      componentes: { bueno: [a, 1 - a], plano: [b, 1 - b] },
    };
  });
  const todo = entrenarEnsemble('baseball', juegos)!;
  assert.ok(todo, 'con 1.400 partidos se entrena');
  assert.ok(todo.metodos['media ponderada'].parametros[0] > 0.7, 'el peso va al componente informativo');
  assert.deepEqual(todo.componentes, ['bueno', 'plano']);
  // Aplicar el registrado da probabilidades válidas.
  const q = aplicar({ metodo: todo.mejor, parametros: todo.metodos[todo.mejor].parametros, calibracion: todo.metodos[todo.mejor].calibracion }, [[0.7, 0.3], [0.5, 0.5]]);
  assert.ok(Math.abs(q[0] + q[1] - 1) < 1e-9);
  assert.equal(entrenarEnsemble('baseball', juegos.slice(0, 100)), null, 'sin muestra, no se entrena');
});
