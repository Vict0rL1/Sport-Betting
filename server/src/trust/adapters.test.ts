// Reglas por deporte de la capa de confianza: calidad de datos, OOD y régimen. Con
// predicciones parciales (solo los campos que lee cada adaptador): lo que se prueba son
// las reglas, no los modelos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const A = await import('./adapters.ts');
const { puntuar, graduado, cuotasRecientes, archivoAlDia, ok, aviso, desconocido } = await import('./dataQuality.ts');

const ahora = new Date('2026-10-06T12:00:00Z');
const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();
const textos = (xs: { texto: string }[]) => xs.map((x) => x.texto).join(' · ');
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

test('calidad de datos: lo DESCONOCIDO se enseña pero no cuenta; lo graduado da medio punto', () => {
  const c = puntuar([ok('a', 40), aviso('b', 20), aviso('c', 20, 10), desconocido('lesiones')]);
  assert.equal(c.puntuacion, Math.round((50 / 80) * 100));
  assert.match(c.explicacion, /1 dato\(s\) marcados DESCONOCIDO no cuentan/);
  assert.equal(graduado(15, 10, 25, 20, String).puntos, 10);
  assert.equal(graduado(30, 10, 25, 20, String).estado, 'ok');
  assert.equal(graduado(3, 10, 25, 20, String).puntos, 0);
});

test('cuotas recientes y archivo al día', () => {
  assert.equal(cuotasRecientes(hace(2), false, ahora).estado, 'ok');
  assert.equal(cuotasRecientes(hace(8), false, ahora).estado, 'aviso');
  assert.match(cuotasRecientes(hace(1), true, ahora).texto, /demostración/);
  // Sin mercado no es «confianza baja» (Fase 5.9): el dato no cuenta.
  assert.equal(cuotasRecientes(null, false, ahora).estado, 'desconocido');
  assert.equal(cuotasRecientes(hace(1), true, ahora).estado, 'desconocido');
  assert.equal(cuotasRecientes(null, false, ahora).max, 0);
  assert.equal(archivoAlDia('2026-10-01T00:00:00.000Z', ahora).estado, 'ok');
  assert.match(archivoAlDia('2026-08-01T00:00:00.000Z', ahora).texto, /hace 67 días/);
  assert.equal(archivoAlDia(null, ahora).estado, 'aviso');
});

// ---------------------------------------------------------------------------
const filaMlb = (over: Any = {}) => ({
  id: 'ev', league: 'mlb', commence_time: '2026-10-07T23:00:00Z', home_name: 'Red Sox', away_name: 'Yankees', home_id: 'bos', away_id: 'nyy',
  home_sp: null, away_sp: null, odds_home: 1.9, odds_away: 2.0, books: 8, source: 'live', updated_at: hace(1), ...over,
});
const starter = (name: string | null, starts: number) => ({ id: name, name, starts, runsPerStart: null, rating: null, runFactor: 1, label: '' });
const predMlb = (home: Any, away: Any) =>
  ({
    model: { home: 0.55, away: 0.45 },
    teams: { home: { elo: 1510, gamesInDb: 800, starter: home }, away: { elo: 1490, gamesInDb: 800, starter: away } },
    park: { name: 'Fenway', factor: 1.03 },
    reasoning: { factors: [{ key: 'rating', label: 'Elo', pointsForHome: 20 }, { key: 'home', label: 'Campo', pointsForHome: 24 }, { key: 'pitching', label: 'Abridores', pointsForHome: -10 }] },
    reliability: { level: 'high', marginPp: 2, reasons: [] },
  }) as Any;

test('MLB: abridor debutante es OOD grave; abridor sin anunciar baja la calidad y ensancha el supuesto', () => {
  const e = A.confianzaBeisbol(filaMlb() as Any, predMlb(starter('Novato', 0), starter('Cole', 120)), ahora)!;
  assert.ok(e.ood.some((o) => o.grave && /Novato/.test(o.texto)));
  assert.equal(e.regimen.etiqueta, 'postemporada (por fecha)', 'octubre');
  const sin = A.confianzaBeisbol(filaMlb() as Any, predMlb(starter(null, 0), starter('Cole', 120)), ahora)!;
  assert.match(textos(sin.datos), /Algún abridor sin anunciar/);
  assert.deepEqual(sin.factores.find((f) => f.clave === 'pitching')?.rango, [0, 1.3]);
  assert.ok(puntuar(sin.datos).puntuacion < puntuar(e.datos).puntuacion);
  assert.match(textos(e.datos), /Bullpen/, 'lo que no hay se dice');
  assert.equal(e.datos.find((d) => /Bullpen/.test(d.texto))?.estado, 'desconocido');
  const abril = A.confianzaBeisbol(filaMlb({ commence_time: '2026-04-10T23:00:00Z' }) as Any, predMlb(starter('A', 30), starter('B', 30)), ahora)!;
  assert.equal(abril.regimen.etiqueta, 'inicio de temporada');
});

// ---------------------------------------------------------------------------
const predNba = (rest: number | null, games = 900) =>
  ({
    model: { probHome: 0.6, probAway: 0.4 },
    teams: { home: { elo: 1550, gamesInDb: games, daysRest: rest, record: { wins: 0, losses: 0 } }, away: { elo: 1500, gamesInDb: 900, daysRest: 2, record: { wins: 0, losses: 0 } } },
    reasoning: { factors: [{ key: 'rating', label: 'Elo', pointsForHome: 50 }, { key: 'home', label: 'Campo', pointsForHome: 20 }] },
    reliability: { level: 'high', marginPp: 2, reasons: [] },
  }) as Any;
const filaNba = (over: Any = {}) => ({ id: 'g', league: 'nba', commence_time: '2026-10-25T00:00:00Z', home_name: 'Lakers', away_name: 'Celtics', home_id: 'lal', away_id: 'bos', home_odds: 1.7, away_odds: 2.2, books: 8, source: 'live', updated_at: hace(1), ...over });

test('NBA: tras el verano es inicio de temporada (OOD leve); pocos partidos en el archivo es OOD grave', () => {
  const e = A.confianzaBaloncesto(filaNba() as Any, predNba(120), ahora)!;
  assert.equal(e.regimen.etiqueta, 'inicio de temporada');
  assert.ok(e.ood.some((o) => !o.grave));
  assert.equal(e.datos.find((d) => /Lesiones/.test(d.texto))?.estado, 'desconocido');
  const pocos = A.confianzaBaloncesto(filaNba() as Any, predNba(2, 10), ahora)!;
  assert.ok(pocos.ood.some((o) => o.grave));
  const abril = A.confianzaBaloncesto(filaNba({ commence_time: '2027-04-20T00:00:00Z' }) as Any, predNba(2), ahora)!;
  assert.match(abril.regimen.etiqueta, /playoffs/);
  assert.equal(abril.pendienteExacta, true, 'la NBA es logística en Elo');
});

// ---------------------------------------------------------------------------
const qb = (name: string, starts: number) => ({ name, adjustment: 0, points: 0, starts, assumed: true });
const predNfl = (q: Any, roof: string | null) =>
  ({
    model: { home: 0.6, away: 0.38, tie: 0.02 },
    final: { home: 0.6, away: 0.4 },
    postprocess: { calibrator: 'platt', weight: 0.5, disagreement: null },
    quarterbacks: { home: q, away: qb('Mahomes', 120) },
    conditions: roof ? { roof, totalAdjustment: 0 } : null,
    teams: { home: { elo: 1550, gamesInDb: 200 }, away: { elo: 1540, gamesInDb: 200 } },
    reasoning: { factors: [{ key: 'elo', label: 'Elo', pointsForHome: 1 }, { key: 'qb', label: 'QB', pointsForHome: 2 }, { key: 'home', label: 'Campo', pointsForHome: 1.5 }] },
    reliability: { level: 'high', marginPp: 3, reasons: [] },
  }) as Any;
const filaNfl = (week: number) => ({ id: 'odds-x', league: 'nfl', season: 2026, week, commence_time: '2026-10-11T17:00:00Z', home_name: 'Bills', away_name: 'Chiefs', home_id: 'buf', away_id: 'kc', neutral: 0, odds_home: 1.8, odds_away: 2.05, spread_line: null, total_line: null, books: 8, source: 'live', updated_at: hace(1), roof: null });

test('NFL: QB sin salidas es OOD grave, el QB supuesto nunca puntúa como confirmado, y el techo cubierto evita el clima desconocido', () => {
  const e = A.confianzaNfl(filaNfl(5) as Any, predNfl(qb('Nuevo', 0), 'dome'), ahora)!;
  assert.ok(e.ood.some((o) => o.grave && /Nuevo/.test(o.texto)));
  const qbItem = e.datos.find((d) => /QB/.test(d.texto))!;
  assert.equal(qbItem.estado, 'aviso');
  assert.ok(qbItem.puntos < qbItem.max, 'supuesto, no confirmado');
  assert.ok(e.datos.some((d) => /cubierto/.test(d.texto) && d.estado === 'ok'));
  const fuera = A.confianzaNfl(filaNfl(5) as Any, predNfl(qb('Allen', 100), 'outdoors'), ahora)!;
  assert.equal(fuera.datos.find((d) => /Clima/.test(d.texto))?.estado, 'desconocido');
  assert.equal(A.confianzaNfl(filaNfl(20) as Any, predNfl(qb('Allen', 100), null), ahora)!.regimen.etiqueta, 'playoffs');
  assert.equal(A.confianzaNfl(filaNfl(2) as Any, predNfl(qb('Allen', 100), null), ahora)!.regimen.etiqueta, 'primeras 4 semanas');
  assert.equal(fuera.providerEventId, 'x', 'el id del proveedor sin el prefijo odds-');
});

// ---------------------------------------------------------------------------
const predTenis = (matches: number, dias: number) =>
  ({
    model: { prob1: 0.64, prob2: 0.36 },
    surface: 'Clay',
    ratings: { p1: { overall: 1900, surface: 1950, effective: 1930 }, p2: { overall: 1800, surface: 1820, effective: 1810 } },
    form: { p1: { delta: 5 }, p2: { delta: -3 } },
    h2h: { delta: 4, total: 3 },
    layoff: { p1: 0, p2: 0 },
    fitness: { p1: { daysSinceLastMatch: dias, retirements: 0 }, p2: { daysSinceLastMatch: 7, retirements: 0 } },
    reasoning: { factors: [{ key: 'rating', label: 'Elo', pointsForP1: 120 }, { key: 'form', label: 'Forma', pointsForP1: 8 }] },
    reliability: { level: 'high', marginPp: 2, reasons: [], effectiveMatches: { p1: matches, p2: 300 } },
  }) as Any;
const filaTenis = (fecha = '2026-05-20T10:00:00Z') => ({ id: 't', tour: 'atp', tournament_id: 'x', tournament_name: 'Roland Garros', surface: 'Clay', commence_time: fecha, p1_name: 'A', p2_name: 'B', p1_id: 1, p2_id: 2, p1_odds: 1.6, p2_odds: 2.4, books: 8, source: 'live', updated_at: hace(1) });

test('tenis: jugador con pocos partidos o que vuelve tras medio año es OOD grave; enero es inicio de temporada', () => {
  const novato = A.confianzaTenis(filaTenis() as Any, predTenis(5, 10), ahora)!;
  assert.ok(novato.ood.some((o) => o.grave && /5 partidos/.test(o.texto)));
  const vuelve = A.confianzaTenis(filaTenis() as Any, predTenis(300, 200), ahora)!;
  assert.ok(vuelve.ood.some((o) => o.grave && /meses sin competir/.test(o.texto)));
  const normal = A.confianzaTenis(filaTenis() as Any, predTenis(300, 10), ahora)!;
  assert.deepEqual(normal.ood, []);
  assert.deepEqual(normal.componentes.map((c) => c.nombre.split(' (')[0]), ['Elo general', 'Elo de superficie', 'Modelo completo']);
  assert.equal(A.confianzaTenis(filaTenis('2027-01-10T10:00:00Z') as Any, predTenis(300, 10), ahora)!.regimen.etiqueta, 'inicio de temporada');
  // La pendiente exacta reproduce la probabilidad del modelo con sus factores.
  const suma = normal.factores.reduce((a, f) => a + f.puntos, 0);
  assert.ok(Math.abs(1 / (1 + Math.exp(-normal.pendiente * suma)) - 0.64) < 1e-9);
});
