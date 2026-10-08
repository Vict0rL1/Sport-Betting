// Topes por grupo de correlación en las estrategias (seguimiento): lo apostado al mismo equipo no
// pasa del tope de equipo de la política sobre el banco de la estrategia, los grupos quedan
// congelados con la apuesta, y las apuestas de antes de la migración cuentan con su partido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { crearEstrategia, colocarEstrategias, abiertasDe } = await import('./index.ts');
type Candidato = import('../paper/bankroll.ts').Candidato;

const db = getDb();
const H = 3_600_000;
const ahora = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

/** Arsenal en casa contra un rival, con más ventaja cuanto antes en la lista. */
const contra = (rival: string, p: number, enHoras: number): Candidato => ({
  sport: 'football',
  league: 'epl',
  match_key: `epl|ars|${rival}`,
  event_id: `ars-${rival}`,
  label: `Arsenal vs ${rival}`,
  commence: iso(ahora + enHoras * H),
  predictedAt: iso(ahora - H),
  oddsAt: iso(ahora - 30 * 60_000),
  books: 6,
  participantes: ['ars', rival],
  salidas: [
    { label: 'Arsenal', proveedor: 'Arsenal', p, pRaw: p, odds: 2.5, pMarket: 0.38 },
    { label: 'Empate', proveedor: 'Draw', p: (1 - p) / 2, pRaw: (1 - p) / 2, odds: 3.4, pMarket: 0.28 },
    { label: rival, proveedor: rival, p: (1 - p) / 2, pRaw: (1 - p) / 2, odds: 3.0, pMarket: 0.34 },
  ],
});

test('tres partidos del mismo equipo: el tope de equipo (3 %) recorta el segundo y rechaza el tercero', () => {
  const e = crearEstrategia({ nombre: 'Grupos', deportes: ['football'], confianza: false, calibracion: false });
  const [p] = colocarEstrategias(new Date(ahora), [contra('che', 0.62, 48), contra('tot', 0.61, 50), contra('liv', 0.6, 52)]).filter((x) => x.id === e.id);
  assert.equal(p.colocadas, 2, JSON.stringify(p));
  assert.equal(p.rechazos['tope de grupo de correlación alcanzado'], 1);
  const filas = db.prepare('SELECT event_id, stake, correlation_groups FROM strategy_bets WHERE strategy_id = ? ORDER BY id').all(e.id) as { event_id: string; stake: number; correlation_groups: string }[];
  assert.deepEqual(
    filas.map((f) => [f.event_id, f.stake]),
    [
      ['ars-che', 20], // el tope por partido (2 % de 1.000)
      ['ars-tot', 10], // lo que queda del 3 % de Arsenal
    ],
  );
  assert.deepEqual(JSON.parse(filas[0].correlation_groups), ['evento:football:ars-che', 'equipo:football:ars', 'equipo:football:che']);
  // Congelados con la apuesta, como el resto de lo que se sabía al apostar.
  assert.throws(() => db.prepare("UPDATE strategy_bets SET correlation_groups = '[]' WHERE event_id = 'ars-che'").run(), /congelados/);
  // En la pasada siguiente, lo abierto en la base ya cuenta: Arsenal sigue sin hueco.
  const [q] = colocarEstrategias(new Date(ahora), [contra('liv', 0.6, 52)]).filter((x) => x.id === e.id);
  assert.equal(q.colocadas, 0);
  assert.equal(q.rechazos['tope de grupo de correlación alcanzado'], 1);
});

test('una apuesta de antes de la migración cuenta con el grupo de su partido, sin inventar equipos', () => {
  const e = crearEstrategia({ nombre: 'Antigua', deportes: ['nfl'], confianza: false, calibracion: false });
  db.prepare(
    `INSERT INTO strategy_bets (strategy_id, placed_at, sport, match_key, event_id, label, selection, commence_time, p_model, p_market, odds, edge, stake, bankroll_at)
     VALUES (?, ?, 'nfl', 'nfl|buf|nyj', 'nfl-1', 'Jets @ Bills', 'Bills', ?, 0.6, 0.55, 1.9, 0.05, 15, 1000)`,
  ).run(e.id, iso(ahora - H), iso(ahora + 24 * H));
  assert.deepEqual(abiertasDe(e.id), [{ id: abiertasDe(e.id)[0].id, sport: 'nfl', stake: 15, grupos: ['evento:nfl:nfl-1'] }]);
});

test('migración 13 sobre un libro mayor anterior: columna nueva, trigger rehecho, filas intactas', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const { MIGRACIONES } = await import('../db.ts');
  const { STRATEGIES_SCHEMA } = await import('./schema.ts');
  const d = new DatabaseSync(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v13-')), 'ledger.db'));
  // El esquema de la Fase 6, sin la columna ni su mención en el trigger de congelación.
  const anterior = STRATEGIES_SCHEMA.replace(/\n\s*correlation_groups\s+TEXT,[^\n]*/, '').replace(' OR OLD.correlation_groups IS NOT NEW.correlation_groups', '');
  assert.ok(!anterior.includes('correlation_groups'));
  d.exec(anterior);
  d.prepare(
    `INSERT INTO strategy_bets (strategy_id, placed_at, sport, match_key, event_id, label, selection, commence_time, p_model, p_market, odds, edge, stake, bankroll_at)
     VALUES (1, '2026-10-01T10:00:00Z', 'nfl', 'k', 'e', 'A @ B', 'B', '2026-10-02T10:00:00Z', 0.6, 0.55, 1.9, 0.05, 15, 1000)`,
  ).run();
  const antes = JSON.stringify(d.prepare('SELECT * FROM strategy_bets').all());
  MIGRACIONES.find((m) => m.version === 13)!.up(d, { ledger: 'main', fichero: 'ledger' });
  const t = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'strategy_bets_congelada'").get() as { sql: string };
  assert.match(t.sql, /correlation_groups/);
  const fila = d.prepare('SELECT * FROM strategy_bets').get() as Record<string, unknown>;
  assert.equal(fila.correlation_groups, null);
  const { correlation_groups: _nueva, ...resto } = fila;
  assert.deepEqual(resto, JSON.parse(antes)[0], 'la fila existente no cambia');
  assert.throws(() => d.exec("UPDATE strategy_bets SET correlation_groups = '[]'"), /congelados/);
  // Idempotente: otra pasada no falla ni duplica nada.
  MIGRACIONES.find((m) => m.version === 13)!.up(d, { ledger: 'main', fichero: 'ledger' });
  d.close();
});
