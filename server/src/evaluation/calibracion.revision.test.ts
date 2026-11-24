// Fase E, revisión de quant-reviewer sobre la implementación: cada hallazgo con su test.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';
import { calibracion, partidosDelPeriodo, rendimiento } from './calibracion.ts';
import type { ExcluidaEnVivo, PrediccionEnVivo } from './live.ts';

let antes: string | undefined;
beforeEach(() => {
  antes = process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE = 'Europe/Madrid';
});
afterEach(() => {
  if (antes == null) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = antes;
});
let id = 0;
const partido = (p: number[], y: number, o: Partial<PrediccionEnVivo> = {}): PrediccionEnVivo => ({ p, y, mercado: null, version: 'v1', cuando: '2026-10-10T18:00:00Z', liga: 'L', matchKey: `r${id++}`, evaluacion: 'final', ...o });
const fuente = (xs: PrediccionEnVivo[], excluidas: ExcluidaEnVivo[] = []) => () => ({ xs, excluidas });
const AHORA = new Date('2026-11-24T12:00:00Z');

test('medio · el desglose devuelve las filas de UN punto: pide cohorte y versión', () => {
  const xs = [...Array.from({ length: 3 }, () => partido([0.6, 0.4], 0)), ...Array.from({ length: 2 }, () => partido([0.6, 0.4], 0, { evaluacion: 'legado', version: 'v2' })), partido([0.6, 0.4], 0, { evaluacion: 'legado', version: 'v3' })];
  const r = rendimiento('nhl', {}, 'mes', AHORA, fuente(xs));
  assert.equal(partidosDelPeriodo('nhl', {}, 'mes', '2026-10', fuente(xs)).motivo, 'falta-serie', 'sin cohorte ni versión, no se mezclan puntos');
  for (const s of r.series) {
    const d = partidosDelPeriodo('nhl', { cohorte: s.cohorte, version: s.version }, 'mes', '2026-10', fuente(xs));
    assert.equal(d.filas.length, s.puntos[0].n, `${s.cohorte}/${s.version}`);
  }
});

test('bajo-medio · el conjunto de un panel no da cifra con menos de 30, ni pruebas con menos de 100', () => {
  const tres = calibracion('nhl', {}, fuente(Array.from({ length: 3 }, () => partido([0.62, 0.38], 0)))).paneles[0].conjunto;
  assert.deepEqual([tres.n, tres.observada, tres.ic95, tres.citlZ, tres.spiegelhalterZ], [3, null, null, null, null]);
  const cincuenta = calibracion('nhl', {}, fuente(Array.from({ length: 50 }, (_, i) => partido([0.62, 0.38], i % 2)))).paneles[0].conjunto;
  assert.notEqual(cincuenta.observada, null);
  assert.deepEqual([cincuenta.citlZ, cincuenta.spiegelhalterZ, cincuenta.veredicto], [null, null, 'insuficiente']);
});

test('bajo · las exclusiones se asignan a su cohorte por su motivo', () => {
  const exc: ExcluidaEnVivo[] = [
    { motivo: 'final-invalida', cuando: '2026-10-10T18:00:00Z', liga: 'L', matchKey: 'x1' },
    { motivo: 'publicacion-invalida', cuando: '2026-10-10T18:00:00Z', liga: 'L', matchKey: 'x2' },
    { motivo: 'sin-publicacion', cuando: '2026-10-10T18:00:00Z', liga: 'L', matchKey: 'x3' },
  ];
  assert.deepEqual(calibracion('nhl', { cohorte: 'final' }, fuente([], exc)).excluidas, { 'final-invalida': 1 });
  assert.deepEqual(calibracion('nhl', { cohorte: 'legado' }, fuente([], exc)).excluidas, { 'publicacion-invalida': 1, 'sin-publicacion': 1 });
});

test('bajo · un periodo recortado por desde/hasta lo dice y lleva los límites del filtro', () => {
  const xs = Array.from({ length: 30 }, () => partido([0.6, 0.4], 0, { cuando: '2026-10-20T18:00:00Z' }));
  const p = rendimiento('nhl', { desde: '2026-10-15' }, 'mes', AHORA, fuente(xs)).series[0].puntos[0];
  assert.equal(p.recortado, true);
  assert.equal(p.desde, '2026-10-14T22:00:00.000Z', 'empieza donde empieza el filtro, no el mes');
  assert.equal(rendimiento('nhl', {}, 'mes', AHORA, fuente(xs)).series[0].puntos[0].recortado, false);
});

test('medio (heredado) · una publicación de fútbol que no suma 1 se excluye, no se renormaliza', async () => {
  const { getDb } = await import('../db.ts');
  const { prediccionesConMotivos } = await import('./live.ts');
  const ahora = new Date();
  const inicio = new Date(ahora.getTime() - 24 * 3_600_000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO fb_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name,
         prob_home, prob_draw, prob_away, shown_home, shown_draw, shown_away, predicted_at, home_goals, away_goals, resolved_at, model_version)
       VALUES ('suma-1-2', 'esp', ?, 'a', 'b', 'Local', 'Visitante', 0.6, 0.3, 0.3, 0.6, 0.3, 0.3, ?, 1, 0, ?, 'fb-v2')`,
    )
    .run(inicio, new Date(ahora.getTime() - 30 * 3_600_000).toISOString(), ahora.toISOString());
  const { xs, excluidas } = prediccionesConMotivos('football');
  assert.equal(xs.find((x) => x.matchKey === 'suma-1-2'), undefined, 'antes se puntuaba como 0,50 / 0,25 / 0,25');
  assert.deepEqual(excluidas.filter((e) => e.matchKey === 'suma-1-2').map((e) => e.motivo), ['publicacion-invalida']);
});

test('bajo · la exportación «evaluadas» avisa con una zona inválida y trae los excluidos con su motivo', async () => {
  const { exportar } = await import('../exports/datasets.ts');
  const e = exportar('evaluadas', { sport: 'football' });
  const fila = e.datos.find((d) => d.match_key === 'suma-1-2');
  assert.deepEqual([fila?.motivo_exclusion, fila?.cohorte, fila?.brier], ['publicacion-invalida', 'legado', null]);
  process.env.APP_TIMEZONE = 'Mars/Olympus';
  const mala = exportar('evaluadas', {});
  assert.deepEqual(mala.datos, []);
  assert.match(mala.aviso ?? '', /APP_TIMEZONE no es una zona válida/);
});

test('11 · lo reconstruido (temporadas que pueden ser de reserva) no entra: el archivo no cambia n, y nadie importa la reconstrucción', async () => {
  const { getDb } = await import('../db.ts');
  const fs = await import('node:fs');
  const db = getDb();
  const antes = [calibracion('nhl', {}).partidos, rendimiento('nhl', {}).series.length];
  const ins = db.prepare("INSERT INTO nhl_games (id, season, game_type, game_date, home_id, away_id, home_goals, away_goals, final_period, ingested_at) VALUES (?, ?, 2, ?, ?, ?, ?, ?, 'REG', '2026-11-01T00:00:00Z')");
  let n = 900_000;
  for (const [temporada, dia] of [[2025, '2025-10-20'], [2026, '2026-10-20']] as const) for (let i = 0; i < 40; i++) ins.run(n++, temporada, dia, 'AAA', 'BBB', 3, 2);
  assert.deepEqual([calibracion('nhl', {}).partidos, rendimiento('nhl', {}).series.length], antes);
  for (const f of ['calibracion.ts', 'live.ts', '../exports/datasets.ts', '../routes/analitica.ts']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/recent\/reconstruct|desbloque|--unlock/.test(src), `${f} no toca la reconstrucción ni el holdout`);
  }
});
