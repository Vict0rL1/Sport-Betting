// «¿Acertó?»: lo reconstruido no mira al futuro, lo registrado en vivo no se cuenta dos
// veces, y todos los días de la ventana aparecen aunque estén vacíos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { reconstruirDesde } = await import('./reconstruct.ts');
const { historialReciente, resumir } = await import('../today.ts');
const { getDb } = await import('../db.ts');

const db = getDb();
const EQUIPOS = ['a', 'b', 'c', 'd', 'e', 'f'];
const FUERZA: Record<string, number> = { a: 12, b: 8, c: 4, d: -4, e: -8, f: -12 };
for (const id of EQUIPOS) db.prepare("INSERT INTO bb_teams (id, league, name) VALUES (?, 'nba', ?)").run(id, `Equipo ${id.toUpperCase()}`);

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const insJuego = db.prepare(
  "INSERT INTO bb_games (league, season, game_date, home_id, away_id, home_pts, away_pts) VALUES ('nba', 2026, ?, ?, ?, ?, ?)",
);
// Tres partidos al día del 1 de agosto al 5 de octubre (cada equipo llega con ~100
// jugados), con un día SIN partidos (1 de octubre) para ver que el día vacío sale igual.
// Resultados deterministas: gana el más fuerte salvo cada séptimo partido.
let k = 0;
for (let d = new Date(2026, 7, 1); d <= new Date(2026, 9, 5); d.setDate(d.getDate() + 1)) {
  if (ymd(d) === '20261001') continue;
  const ronda = [[0, 1, 2, 3, 4, 5], [0, 2, 1, 4, 3, 5], [0, 3, 1, 5, 2, 4], [0, 4, 1, 3, 2, 5], [0, 5, 1, 2, 3, 4]][k % 5];
  for (let i = 0; i < 6; i += 2) {
    const [h, a] = k % 2 ? [EQUIPOS[ronda[i]], EQUIPOS[ronda[i + 1]]] : [EQUIPOS[ronda[i + 1]], EQUIPOS[ronda[i]]];
    const sorpresa = (k * 3 + i) % 7 === 0;
    const ganaLocal = (FUERZA[h] + 3 > FUERZA[a]) !== sorpresa;
    insJuego.run(ymd(d), h, a, ganaLocal ? 110 : 100, ganaLocal ? 100 : 110);
  }
  k++;
}
const AHORA = new Date(2026, 9, 6, 12, 0, 0);
const DESDE = '20260929';

const claveDe = (p: { fecha: string; casaId: string; fueraId: string }) => `${p.fecha}|${p.casaId}|${p.fueraId}`;

test('reconstruye todos los partidos jugados de la ventana, con probabilidades que suman 1', () => {
  const r = reconstruirDesde(DESDE);
  const bb = r.partidos.filter((p) => p.deporte === 'Baloncesto');
  // 29 sep – 5 oct son 7 días, menos el 1 de octubre vacío: 6 × 3 partidos.
  assert.equal(bb.length, 18);
  for (const p of bb) assert.ok(Math.abs(p.probs[0] + p.probs[1] - 1) < 1e-12);
  // El fuerte en casa contra el débil tiene que salir favorito: el modelo aprendió algo.
  const af = bb.find((p) => p.casaId === 'a' && p.fueraId === 'f') ?? bb.find((p) => p.casaId === 'f' && p.fueraId === 'a')!;
  assert.ok(af.casaId === 'a' ? af.probs[0] > 0.6 : af.probs[1] > 0.6);
});

// LO QUE MÁS IMPORTA: sin mirar al futuro. Ni el resultado del propio partido ni nada de
// días posteriores puede mover su predicción reconstruida. (Otro partido POSTERIOR del
// mismo día sí puede moverse: como en los backtests, lo ya jugado ese día cuenta como
// pasado. Por eso el partido que se cambia es el ÚLTIMO del día.)
test('sin mirar al futuro: cambiar el resultado de un partido o añadir partidos después no mueve su predicción', () => {
  const antes = new Map(reconstruirDesde(DESDE).partidos.filter((p) => p.deporte === 'Baloncesto').map((p) => [claveDe(p), p]));
  const ultimo = db.prepare("SELECT id, game_date, home_id, away_id, home_pts, away_pts FROM bb_games WHERE game_date = '20261005' ORDER BY id DESC LIMIT 1").get() as {
    id: number; game_date: string; home_id: string; away_id: string; home_pts: number; away_pts: number;
  };
  // Darle la vuelta al resultado (la huella del archivo ve el cambio de marcador) y
  // añadir un partido posterior con un resultado absurdo.
  db.prepare('UPDATE bb_games SET home_pts = ?, away_pts = ? WHERE id = ?').run(ultimo.away_pts, ultimo.home_pts, ultimo.id);
  insJuego.run('20261006', 'f', 'a', 160, 60);
  const despues = new Map(reconstruirDesde(DESDE).partidos.filter((p) => p.deporte === 'Baloncesto').map((p) => [claveDe(p), p]));
  for (const [clave, p] of antes) {
    const q = despues.get(clave)!;
    assert.deepEqual(q.probs, p.probs, `la predicción de ${clave} cambió con información posterior`);
  }
  const k0 = `${ultimo.game_date}|${ultimo.home_id}|${ultimo.away_id}`;
  assert.notEqual(despues.get(k0)!.y, antes.get(k0)!.y, 'el resultado sí cambia (y la caché lo ha visto)');
  assert.equal(despues.size, antes.size + 1, 'el partido nuevo entra');
  // Dejarlo como estaba para los tests de abajo.
  db.prepare('UPDATE bb_games SET home_pts = ?, away_pts = ? WHERE id = ?').run(ultimo.home_pts, ultimo.away_pts, ultimo.id);
  db.prepare("DELETE FROM bb_games WHERE game_date = '20261006'").run();
});

test('un partido registrado en vivo cuenta una vez, como «en vivo», no también como reconstruido', () => {
  const sinVivo = historialReciente(AHORA, 7);
  const g = db.prepare("SELECT id, game_date, home_id, away_id, home_pts, away_pts FROM bb_games WHERE game_date = '20261004' ORDER BY id LIMIT 1").get() as {
    id: number; home_id: string; away_id: string; home_pts: number; away_pts: number;
  };
  db.prepare(
    `INSERT INTO bb_prediction_log (game_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, reliability, predicted_at, home_pts, away_pts, game_id, resolved_at)
     VALUES ('vivo-1', 'nba', 'u1', ?, ?, ?, 'Equipo Vivo Casa', 'Equipo Vivo Fuera', 0.9, 'high', ?, ?, ?, ?, ?)`,
  ).run(new Date(2026, 9, 4, 20).toISOString(), g.home_id, g.away_id, new Date(2026, 9, 4, 10).toISOString(), g.home_pts, g.away_pts, g.id, new Date(2026, 9, 5).toISOString());
  const h = historialReciente(AHORA, 7);
  assert.equal(h.resumen.total, sinVivo.resumen.total, 'mismo número de partidos: el vivo sustituye al reconstruido');
  assert.equal(h.porOrigen['en vivo'].total, 1);
  assert.equal(h.porOrigen.reconstruida.total, sinVivo.porOrigen.reconstruida.total - 1);
  const vivo = h.resultados.find((r) => r.origen === 'en vivo')!;
  assert.equal(vivo.probabilidad, 0.9, 'la probabilidad que se enseñó, no la reconstruida');
  assert.equal(vivo.dia, '2026-10-04');
});

test('todos los días de la ventana aparecen, también el vacío; y lo jugado sin resultado se cuenta', () => {
  // Un partido que la app vio empezar ayer y del que el archivo aún no sabe nada.
  db.prepare(
    `INSERT INTO bb_prediction_log (game_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, reliability, predicted_at)
     VALUES ('pendiente-1', 'nba', 'u2', ?, 'a', 'b', 'A', 'B', 0.6, 'high', ?)`,
  ).run(new Date(2026, 9, 5, 20).toISOString(), new Date(2026, 9, 5, 10).toISOString());
  // Y uno que acaba de empezar: todavía no se le puede pedir resultado.
  db.prepare(
    `INSERT INTO bb_prediction_log (game_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, reliability, predicted_at)
     VALUES ('en-juego-1', 'nba', 'u3', ?, 'c', 'd', 'C', 'D', 0.6, 'high', ?)`,
  ).run(new Date(AHORA.getTime() - 60 * 60_000).toISOString(), new Date(2026, 9, 6, 8).toISOString());
  const h = historialReciente(AHORA, 7);
  assert.equal(h.porDia.length, 7);
  assert.equal(h.porDia[0].dia, '2026-10-06', 'empieza por hoy');
  assert.equal(h.porDia.find((d) => d.dia === '2026-10-01')?.total, 0, 'el día sin partidos está, con 0');
  assert.equal(h.porDia.reduce((a, d) => a + d.total, 0), h.resumen.total);
  const bb = h.archivo.find((a) => a.deporte === 'Baloncesto')!;
  assert.equal(bb.hasta, '2026-10-05');
  assert.equal(bb.sinResultado, 1, 'el de ayer sí; el que empezó hace una hora todavía no');
  assert.equal(bb.comando, 'npm run update-data:bb');
  assert.equal(h.archivo.find((a) => a.deporte === 'Tenis')?.reconstruye, false);
  // 14 días también se calculan, con su propia caché.
  assert.equal(historialReciente(AHORA, 14).porDia.length, 14);
});

test('el resumen: esperados = suma de probabilidades, y sin partidos no hay porcentaje', () => {
  const r = resumir([
    { probabilidad: 0.8, acerto: true },
    { probabilidad: 0.6, acerto: false },
    { probabilidad: 0.5, acerto: true },
  ]);
  assert.equal(r.aciertos, 2);
  assert.ok(Math.abs((r.esperado as number) - 1.9) < 1e-12);
  const sd = Math.sqrt(0.16 + 0.24 + 0.25);
  assert.deepEqual(r.rangoNormal, [Math.max(0, Math.ceil(1.9 - 1.96 * sd)), Math.min(3, Math.floor(1.9 + 1.96 * sd))]);
  assert.deepEqual(resumir([]), { total: 0, aciertos: 0, tasa: null, esperado: null, tasaEsperada: null, rangoNormal: null });
});

test('fútbol en vivo: el empate puede ser el favorito, y acertarlo cuenta', () => {
  db.prepare(
    `INSERT INTO fb_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, prob_draw, prob_away, reliability, predicted_at, home_goals, away_goals, resolved_at)
     VALUES ('fb-1', 'epl', 'u', ?, 'x', 'y', 'Local FC', 'Visitante FC', 0.3, 0.4, 0.3, 'high', ?, 1, 1, ?)`,
  ).run(new Date(2026, 9, 3, 16).toISOString(), new Date(2026, 9, 3, 9).toISOString(), new Date(2026, 9, 4).toISOString());
  const r = historialReciente(AHORA, 7).resultados.find((x) => x.deporte === 'Fútbol')!;
  assert.equal(r.favorito, 'Empate');
  assert.equal(r.ganador, 'Empate');
  assert.equal(r.acerto, true);
  assert.equal(r.origen, 'en vivo');
});
