// E3/E4 (revisión del PR 17): una nota editable en cada estimación guardada (un dato personal, aparte
// de la instantánea, que no se toca) y la comparación de lo guardado con lo último registrado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { recordSnapshot } = await import('../prematch/snapshots.ts');
const { guardarInstantanea, listarGuardadas, anotarGuardada } = await import('./guardadas.ts');
const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');

const H = 3_600_000;
const INICIO = new Date(Date.now() + 48 * H).toISOString();
const snap = (probs: number[], at: Date) =>
  recordSnapshot({ sport: 'nhl', matchKey: 'nhl|n|1', eventId: null, commence: INICIO, outcomes: ['Toronto', 'Boston'], probs, probsRaw: null, odds: null, oddsAt: null, dataAsOf: null, usaMercado: false, entradas: { x: { etiqueta: 'x', valor: probs[0] } } } as never, at);
snap([0.6, 0.4], new Date(Date.now() - 5 * H));
const primera = (getDb().prepare("SELECT id FROM prediction_snapshots WHERE match_key = 'nhl|n|1' ORDER BY id").get() as { id: number }).id;
const g = guardarInstantanea({ sport: 'nhl', matchKey: 'nhl|n|1', snapshotId: primera });
snap([0.52, 0.48], new Date(Date.now() - 1 * H));

test('E4: lo guardado se compara con lo último registrado (Δ en pp), sin tocar lo guardado', () => {
  const x = listarGuardadas().find((y) => y.id === g.id)!;
  assert.deepEqual(x.probs, [0.6, 0.4]);
  assert.ok(x.actual, 'hay una estimación más reciente');
  assert.deepEqual(x.actual.probs, [0.52, 0.48]);
  assert.notEqual(x.actual.snapshot_id, primera);
});

test('E3: la nota se escribe, se cambia y se borra; la instantánea no cambia', () => {
  const antes = getDb().prepare('SELECT probs, captured_at FROM prediction_snapshots WHERE id = ?').get(primera);
  assert.equal(anotarGuardada(g.id, '  Mirar la portería  ')?.nota, 'Mirar la portería');
  assert.equal(anotarGuardada(g.id, 'otra')?.nota, 'otra');
  assert.equal(anotarGuardada(g.id, '   ')?.nota, null, 'en blanco es sin nota');
  assert.equal(anotarGuardada(9999, 'x'), null);
  assert.throws(() => anotarGuardada(g.id, 'x'.repeat(1001)), /1000/);
  assert.deepEqual(getDb().prepare('SELECT probs, captured_at FROM prediction_snapshots WHERE id = ?').get(primera), antes);
});

test('E3: PATCH /api/guardadas/:id con la nota; validación y 404', async () => {
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  try {
    const ok = await app.inject({ method: 'PATCH', url: `/api/guardadas/${g.id}`, payload: { nota: 'desde la API' } });
    assert.equal(ok.statusCode, 200);
    assert.equal((ok.json() as { nota: string }).nota, 'desde la API');
    const largo = await app.inject({ method: 'PATCH', url: `/api/guardadas/${g.id}`, payload: { nota: 'x'.repeat(1001) } });
    assert.equal(largo.statusCode, 400);
    const nada = await app.inject({ method: 'PATCH', url: '/api/guardadas/9999', payload: { nota: 'x' } });
    assert.equal(nada.statusCode, 404);
    const lista = (await app.inject({ method: 'GET', url: '/api/guardadas' })).json() as { guardadas: { id: number; nota: string | null; actual: unknown }[] };
    const x = lista.guardadas.find((y) => y.id === g.id)!;
    assert.equal(x.nota, 'desde la API');
    assert.ok(x.actual);
  } finally {
    await app.close();
  }
});
