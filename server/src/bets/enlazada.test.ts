// E5 (revisión del PR 17): una apuesta puede apuntar la estimación (instantánea) con la que se hizo.
// Columna nueva; las de antes quedan explícitamente sin enlazar. El enlace se valida: la instantánea
// existe y es del mismo deporte y partido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { recordSnapshot } = await import('../prematch/snapshots.ts');
const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');

const H = 3_600_000;
const INICIO = new Date(Date.now() + 24 * H).toISOString();
recordSnapshot({ sport: 'nhl', matchKey: 'nhl|b|1', eventId: null, commence: INICIO, outcomes: ['Toronto', 'Boston'], probs: [0.6, 0.4], probsRaw: null, odds: null, oddsAt: null, dataAsOf: null, usaMercado: false, entradas: { x: { etiqueta: 'x', valor: 1 } } } as never, new Date(Date.now() - H));
const snapId = (getDb().prepare("SELECT id FROM prediction_snapshots WHERE match_key = 'nhl|b|1'").get() as { id: number }).id;
const base = { sport: 'nhl', event: 'Boston @ Toronto', market: 'moneyline', selection: 'Toronto', odds: 1.8, stake: 10, currency: 'EUR', match_key: 'nhl|b|1' };

async function con<T>(f: (app: Awaited<ReturnType<typeof buildApp>>) => Promise<T>): Promise<T> {
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  try {
    return await f(app);
  } finally {
    await app.close();
  }
}

test('E5: una apuesta enlazada guarda la instantánea y la devuelve con su estimación', async () => {
  await con(async (app) => {
    const r = await app.inject({ method: 'POST', url: '/api/bets', payload: { ...base, snapshot_id: snapId } });
    assert.equal(r.statusCode, 201, r.body);
    const b = r.json() as { snapshotId: number | null; estimacion: { probs: number[]; captured_at: string } | null };
    assert.equal(b.snapshotId, snapId);
    assert.deepEqual(b.estimacion?.probs, [0.6, 0.4]);
  });
});

test('E5: sin enlace es explícito (null), y un enlace a otro partido, otro deporte o que no existe se rechaza', async () => {
  await con(async (app) => {
    const sin = await app.inject({ method: 'POST', url: '/api/bets', payload: base });
    assert.equal((sin.json() as { snapshotId: number | null; estimacion: unknown }).snapshotId, null);
    for (const malo of [{ snapshot_id: 999999 }, { snapshot_id: snapId, match_key: 'nhl|otro|9' }, { snapshot_id: snapId, sport: 'nfl' }, { snapshot_id: 'abc' }]) {
      const r = await app.inject({ method: 'POST', url: '/api/bets', payload: { ...base, ...malo } });
      assert.equal(r.statusCode, 400, JSON.stringify(malo));
    }
  });
});

test('E5 (data-guardian): cambiar el deporte o el partido de una apuesta enlazada se vuelve a comprobar; quitar el enlace siempre vale', async () => {
  await con(async (app) => {
    const r = await app.inject({ method: 'POST', url: '/api/bets', payload: { ...base, snapshot_id: snapId } });
    const id = (r.json() as { id: number }).id;
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/bets/${id}`, payload: { match_key: 'nhl|otro|9' } })).statusCode, 400, 'otro partido con el enlace puesto');
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/bets/${id}`, payload: { sport: 'nfl' } })).statusCode, 400, 'otro deporte con el enlace puesto');
    const quitar = await app.inject({ method: 'PATCH', url: `/api/bets/${id}`, payload: { snapshot_id: null, match_key: 'nhl|otro|9' } });
    assert.equal(quitar.statusCode, 200, 'sin enlace, el partido se puede cambiar');
    assert.equal((quitar.json() as { snapshotId: number | null }).snapshotId, null);
  });
});

test('G2: los errores de validación llevan un código estable (y parámetros) para traducirlos; el mensaje sigue', async () => {
  await con(async (app) => {
    const r = await app.inject({ method: 'POST', url: '/api/bets', payload: { ...base, odds: 0.5, stake: 10.005, currency: 'XYZ' } });
    assert.equal(r.statusCode, 400);
    const errores = (r.json() as { errors: { field: string; code: string; params?: Record<string, unknown>; message: string }[] }).errors;
    const por = Object.fromEntries(errores.map((e) => [e.field, e]));
    assert.equal(por.odds.code, 'apuesta.cuota-minima');
    assert.equal(por.stake.code, 'apuesta.dos-decimales');
    assert.equal(por.currency.code, 'apuesta.moneda-invalida');
    assert.deepEqual(por.currency.params, { lista: 'EUR, USD, GBP' });
    assert.ok(por.odds.message.length > 0, 'el texto de antes sigue para quien lo lea por la API');
    const enlace = await app.inject({ method: 'POST', url: '/api/bets', payload: { ...base, snapshot_id: 999999 } });
    assert.equal((enlace.json() as { errors: { code: string }[] }).errors[0].code, 'apuesta.enlace-no-existe');
  });
});
