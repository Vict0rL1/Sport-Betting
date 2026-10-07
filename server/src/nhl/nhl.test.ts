// La NHL en sombra (Fase 8.1): el modelo, el lector de la API y el backtest, con datos sintéticos.
// Nada sale a la red: la API de la NHL se simula y los partidos se generan con una semilla fija.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { NHL, esperado, predecir, actualizar, resultado60 } = await import('./model.ts');
const { partidosDe, ingestarRango, NHL_API } = await import('./ingest.ts');
const { evaluarNhl, leerPartidos, CALENTAMIENTO } = await import('./evaluacion.ts');
const { getDb } = await import('../db.ts');
type PartidoNhl = import('./ingest.ts').PartidoNhl;

const cerca = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

test('modelo: probabilidades que suman uno y el moneyline es el del Elo', () => {
  for (const [h, a] of [
    [1500, 1500],
    [1600, 1450],
    [1400, 1620],
  ]) {
    const p = predecir(h, a);
    cerca(p.local + p.visitante, 1);
    cerca(p.local, esperado(h + NHL.campo - a), 1e-6);
    assert.ok(p.empate60 > 0.1 && p.empate60 < 0.35, `empate a 60 minutos verosímil: ${p.empate60}`);
    // El reparto conserva la media geométrica de la liga: lo que uno marca de más, el otro de menos.
    cerca(Math.sqrt(p.golesLocal * p.golesVisitante), NHL.golesLiga / 2, 1e-9);
  }
  const r = resultado60(3, 3);
  cerca(r.gana + r.empata + r.pierde, 1);
  cerca(r.gana, r.pierde, 1e-12);
});

test('modelo: la ventaja de campo y el campo neutral', () => {
  const casa = predecir(1500, 1500);
  const neutral = predecir(1500, 1500, true);
  assert.ok(casa.local > 0.5 && casa.golesLocal > casa.golesVisitante);
  cerca(neutral.local, 0.5, 1e-6);
});

test('modelo: el total de goles baja al subir la línea y cuenta la prórroga como un gol', () => {
  const p = predecir(1550, 1500);
  const lineas = [4.5, 5.5, 6.5, 7.5];
  const xs = lineas.map((l) => p.overTotal(l));
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] < xs[i - 1]);
  assert.ok(xs.every((x) => x > 0 && x < 1));
});

test('modelo: lo que gana uno lo pierde el otro, y ganar por más mueve más', () => {
  const [h1, a1] = actualizar(1500, 1500, 3, 2);
  cerca(h1 - 1500, 1500 - a1, 1e-9);
  assert.ok(h1 > 1500);
  const [h2] = actualizar(1500, 1500, 6, 1);
  assert.ok(h2 > h1, 'una victoria por cinco pesa más que por uno');
  const [h3, a3] = actualizar(1500, 1500, 1, 4);
  assert.ok(h3 < 1500 && a3 > 1500);
});

const semana = {
  nextStartDate: '2024-10-15',
  gameWeek: [
    {
      date: '2024-10-08',
      games: [
        {
          id: 2024020001,
          season: 20242025,
          gameType: 2,
          gameState: 'OFF',
          homeTeam: { abbrev: 'TOR', score: 3, placeName: { default: 'Toronto' }, commonName: { default: 'Maple Leafs' } },
          awayTeam: { abbrev: 'MTL', score: 2, name: { default: 'Montréal Canadiens' } },
          gameOutcome: { lastPeriodType: 'OT' },
        },
        // Sin terminar: se ignora.
        { id: 2024020002, season: 20242025, gameType: 2, gameState: 'FUT', homeTeam: { abbrev: 'BOS' }, awayTeam: { abbrev: 'FLA' } },
        // Sin marcador: se ignora, no se inventa.
        { id: 2024020003, season: 20242025, gameType: 2, gameState: 'FINAL', homeTeam: { abbrev: 'NYR' }, awayTeam: { abbrev: 'NJD' } },
        { id: 2024020004, season: 20242025, gameType: 3, gameState: 'FINAL', homeTeam: { abbrev: 'EDM', score: 1 }, awayTeam: { abbrev: 'VAN', score: 4 } },
      ],
    },
  ],
};

test('lector: solo partidos terminados con marcador, temporada por año de inicio y prórroga', () => {
  const xs = partidosDe(semana);
  assert.equal(xs.length, 2);
  const [a, b] = xs;
  assert.equal(a.season, 2024);
  assert.equal(a.game_date, '2024-10-08');
  assert.equal(a.final_period, 'OT');
  assert.equal(a.home_name, 'Toronto Maple Leafs');
  assert.equal(a.away_name, 'Montréal Canadiens');
  assert.equal(b.game_type, 3);
  assert.equal(b.final_period, 'REG');
  assert.deepEqual(partidosDe({}), []);
});

test('ingesta: semana a semana con la API simulada, y un error claro si la fuente no contesta', async () => {
  getDb().exec('DELETE FROM nhl_games');
  const pedidos: string[] = [];
  const f = (async (url: string | URL) => {
    pedidos.push(String(url));
    if (String(url).endsWith('/2024-10-08')) return new Response(JSON.stringify(semana));
    return new Response(JSON.stringify({ gameWeek: [], nextStartDate: '2024-10-22' }));
  }) as typeof fetch;
  const r = await ingestarRango('2024-10-08', '2024-10-20', f);
  assert.deepEqual(pedidos, [`${NHL_API}/schedule/2024-10-08`, `${NHL_API}/schedule/2024-10-15`]);
  assert.deepEqual(r, { semanas: 2, partidos: 2 });
  assert.equal(leerPartidos().length, 2);
  // Volver a bajar la misma semana no duplica.
  await ingestarRango('2024-10-08', '2024-10-08', f);
  assert.equal(leerPartidos().length, 2);

  const caida = (async () => {
    throw new Error('403 Forbidden');
  }) as typeof fetch;
  await assert.rejects(() => ingestarRango('2024-10-08', '2024-10-08', caida), /no se pudo contactar con api-web\.nhle\.com/);
  const error = (async () => new Response('no', { status: 503 })) as typeof fetch;
  await assert.rejects(() => ingestarRango('2024-10-08', '2024-10-08', error), /contestó 503/);
  getDb().exec('DELETE FROM nhl_games');
});

test('backtest: sin partidos lo dice y no puntúa nada', () => {
  const r = evaluarNhl([]);
  assert.equal(r.puntuados, 0);
  assert.equal(r.modelo, null);
  assert.match(r.nota, /sin partidos en nhl_games/);
});

/** Una liga sintética con fuerzas fijas y una semilla, para que el Elo tenga algo que aprender. */
function ligaSintetica(): PartidoNhl[] {
  let s = 7;
  const azar = () => ((s = (s * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
  const equipos = Array.from({ length: 12 }, (_, i) => ({ id: `E${i}`, fuerza: (i - 5.5) * 30 }));
  const xs: PartidoNhl[] = [];
  let id = 1;
  for (let temporada = 2021; temporada <= 2025; temporada++)
    for (let d = 0; d < 120; d++) {
      const h = equipos[Math.floor(azar() * 12)];
      let a = equipos[Math.floor(azar() * 12)];
      if (a === h) a = equipos[(equipos.indexOf(h) + 1) % 12];
      const p = esperado(h.fuerza + NHL.campo - a.fuerza);
      const gana = azar() < p;
      const fecha = new Date(Date.UTC(temporada, 9, 1) + d * 86_400_000).toISOString().slice(0, 10);
      xs.push({
        id: id++,
        season: temporada,
        game_type: 2,
        game_date: fecha,
        home_id: h.id,
        away_id: a.id,
        home_name: null,
        away_name: null,
        home_goals: gana ? 3 : 1,
        away_goals: gana ? 1 : 3,
        final_period: 'REG',
      });
    }
  return xs;
}

test('backtest: el holdout de 2025 no se puntúa, el calentamiento tampoco, y el Elo aprende', () => {
  const xs = ligaSintetica();
  const r = evaluarNhl(xs);
  const holdout = xs.filter((x) => x.season >= 2025).length;
  assert.equal(r.holdoutExcluido, holdout);
  assert.equal(r.puntuados, xs.length - holdout - CALENTAMIENTO);
  assert.ok(!r.porTemporada.some((t) => t.temporada >= 2025), 'ninguna temporada del holdout en el informe');
  assert.ok(r.modelo && r.modelo.logLoss != null);
  const local = r.referencias.find((x) => x.nombre.startsWith('Siempre el local'));
  assert.ok(local?.logLoss != null && r.modelo.logLoss! < local.logLoss, 'con fuerzas reales, el Elo gana a «siempre el local»');
  // 180 predicciones: por encima del mínimo de 100, pero todavía con su aviso de cifra orientativa.
  assert.equal(r.aviso.nivel, 'orientativa');
  assert.match(r.aviso.texto ?? '', /180 predicciones/);
});

test('backtest: la predicción de cada partido es la del Elo ANTES de jugarlo', () => {
  const xs = ligaSintetica().filter((x) => x.season < 2025);
  const ultimo = xs.at(-1)!;
  const otro = [...xs.slice(0, -1), { ...ultimo, home_goals: ultimo.away_goals, away_goals: ultimo.home_goals }];
  // El Elo de los dos equipos con todo lo anterior, a mano.
  const elo = new Map<string, number>();
  for (const g of xs.slice(0, -1)) {
    const [h, a] = actualizar(elo.get(g.home_id) ?? NHL.inicial, elo.get(g.away_id) ?? NHL.inicial, g.home_goals, g.away_goals);
    elo.set(g.home_id, h);
    elo.set(g.away_id, a);
  }
  const p = predecir(elo.get(ultimo.home_id) ?? NHL.inicial, elo.get(ultimo.away_id) ?? NHL.inicial);
  const probs = [p.local, p.visitante];
  const y1 = ultimo.home_goals > ultimo.away_goals ? 0 : 1;
  const r1 = evaluarNhl(xs);
  const r2 = evaluarNhl(otro);
  assert.equal(r1.puntuados, r2.puntuados);
  // Solo cambia el término del último partido, y con la MISMA probabilidad en los dos casos.
  const n = r1.puntuados;
  cerca(n * (r2.modelo!.logLoss! - r1.modelo!.logLoss!), Math.log(probs[y1]) - Math.log(probs[1 - y1]), 1e-6);
});
