// Clima: horizontes que tocan, lectura de la hora correcta, nada inventado cuando la fuente
// falla, y el ciclo guarda filas inmutables para los partidos con estadio conocido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { horizontesPendientes, leerHora, consultar, cicloClima, climaDe, estadioDe, estadios, descripcionCodigo } = await import('./openMeteo.ts');
const { getDb } = await import('../db.ts');

const KICKOFF = '2026-10-11T17:00:00Z';
const h = (horas: number) => new Date(Date.parse(KICKOFF) - horas * 3_600_000);

test('estadios: 32 ids de la NFL y 31 parques MLB (ATH y OAK), todos con coordenadas y techo', () => {
  const f = estadios();
  assert.equal(Object.keys(f.nfl).length, 32);
  assert.equal(Object.keys(f.mlb).length, 31);
  for (const e of [...Object.values(f.nfl), ...Object.values(f.mlb)]) {
    assert.ok(Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180 && ['outdoors', 'retractable', 'dome'].includes(e.roof), e.name);
  }
  assert.equal(estadioDe('nfl', 'nfl', 'GB')?.name, 'Lambeau Field');
  assert.equal(estadioDe('baseball', 'mlb', 'BOS')?.name, 'Fenway Park');
  assert.equal(estadioDe('baseball', 'kbo', 'BOS'), null, 'otra liga, otro parque');
  assert.equal(estadioDe('nfl', 'nfl', null), null);
});

test('horizontesPendientes: cada marca una vez al cruzarla, y «final» cuatro horas después', () => {
  assert.deepEqual(horizontesPendientes(KICKOFF, h(30), new Set()), [], 'aún lejos');
  assert.deepEqual(horizontesPendientes(KICKOFF, h(20), new Set()), ['T-24h']);
  assert.deepEqual(horizontesPendientes(KICKOFF, h(20), new Set(['T-24h'])), [], 'ya hecha');
  assert.deepEqual(horizontesPendientes(KICKOFF, h(0.5), new Set(['T-24h'])), ['T-6h', 'T-1h'], 'si el servidor estuvo parado, las que faltan');
  assert.deepEqual(horizontesPendientes(KICKOFF, h(-1), new Set()), [], 'empezado pero no acabado: nada');
  assert.deepEqual(horizontesPendientes(KICKOFF, h(-5), new Set()), ['final']);
  assert.deepEqual(horizontesPendientes('basura', h(-5), new Set()), []);
});

const RESPUESTA = {
  hourly: {
    time: ['2026-10-11T16:00', '2026-10-11T17:00', '2026-10-11T18:00'],
    temperature_2m: [12.1, 11.4, 10.9],
    wind_speed_10m: [14.2, 17.8, 16.0],
    precipitation: [0, 0.3, 0.1],
    precipitation_probability: [10, 35, 30],
    weather_code: [2, 61, 61],
  },
};

test('leerHora toma la hora del partido; consultar devuelve null ante error, 500 o hora ausente', async () => {
  const l = leerHora(RESPUESTA, KICKOFF)!;
  assert.deepEqual(l, { tempC: 11.4, vientoMph: 17.8, lluviaMm: 0.3, probLluvia: 35, codigo: 61 });
  assert.equal(leerHora(RESPUESTA, '2026-10-11T20:00:00Z'), null);
  assert.equal(leerHora({ error: true }, KICKOFF), null);
  const e = estadioDe('nfl', 'nfl', 'GB')!;
  assert.equal(await consultar(e, KICKOFF, 'prevision', async () => new Response('no', { status: 500 })), null);
  assert.equal(await consultar(e, KICKOFF, 'prevision', async () => { throw new Error('sin red'); }), null);
  const ok = await consultar(e, KICKOFF, 'prevision', async (url) => {
    assert.match(String(url), /api\.open-meteo\.com\/v1\/forecast.*latitude=44\.5013.*wind_speed_unit=mph.*start_date=2026-10-11/);
    return new Response(JSON.stringify(RESPUESTA), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(ok?.vientoMph, 17.8);
  const arch = await consultar(e, KICKOFF, 'observado', async (url) => {
    assert.match(String(url), /archive-api\.open-meteo\.com/);
    return new Response(JSON.stringify(RESPUESTA), { status: 200 });
  });
  assert.equal(arch?.tempC, 11.4);
  assert.equal(descripcionCodigo(61), 'lluvia');
  assert.equal(descripcionCodigo(null), 'sin dato');
});

test('cicloClima: guarda la previsión de los partidos con estadio, deja DESCONOCIDO a los demás y no repite', async () => {
  const db = getDb();
  db.prepare("INSERT INTO naf_teams (id, league, name) VALUES ('GB', 'nfl', 'Green Bay Packers'), ('CHI', 'nfl', 'Chicago Bears'), ('XXX', 'nfl', 'Equipo sin estadio')").run();
  db.prepare("INSERT INTO naf_upcoming (id, league, season, week, commence_time, home_name, away_name, home_id, away_id, neutral, source, updated_at, roof) VALUES ('g1', 'nfl', 2026, 6, ?, 'Green Bay Packers', 'Chicago Bears', 'GB', 'CHI', 0, 'schedule', ?, 'outdoors')").run(KICKOFF, KICKOFF);
  db.prepare("INSERT INTO naf_upcoming (id, league, season, week, commence_time, home_name, away_name, home_id, away_id, neutral, source, updated_at, roof) VALUES ('g2', 'nfl', 2026, 6, ?, 'Equipo sin estadio', 'Chicago Bears', 'XXX', 'CHI', 0, 'schedule', ?, 'outdoors')").run(KICKOFF, KICKOFF);
  let llamadas = 0;
  const f = async () => {
    llamadas++;
    return new Response(JSON.stringify(RESPUESTA), { status: 200 });
  };
  const r1 = await cicloClima({ ahora: h(20), fetch: f });
  assert.deepEqual(r1, { consultados: 1, guardados: 1, fallidos: 0, sinEstadio: 1 });
  const r2 = await cicloClima({ ahora: h(19), fetch: f });
  assert.equal(r2.consultados, 0, 'T-24h ya está; no se vuelve a pedir');
  const r3 = await cicloClima({ ahora: h(0.5), fetch: f });
  assert.equal(r3.guardados, 2, 'T-6h y T-1h de golpe');
  assert.equal(llamadas, 3);
  const c = climaDe('nfl', 'nfl', 'g1', 'GB');
  assert.equal(c.estado, 'previsión');
  assert.equal(c.horizonte, 'T-1h');
  assert.equal(c.vientoMph, 17.8);
  assert.equal(c.descripcion, 'lluvia');
  assert.equal(c.estadio?.nombre, 'Lambeau Field');
  const d = climaDe('nfl', 'nfl', 'g2', 'XXX');
  assert.equal(d.estado, 'DESCONOCIDO');
  assert.match(d.motivo ?? '', /no configurado/);
  // Inmutable.
  assert.throws(() => db.exec("DELETE FROM weather_observations WHERE match_key = 'g1'"), /inmutable/);
  assert.throws(() => db.exec("UPDATE weather_observations SET temp_c = 99 WHERE match_key = 'g1'"), /inmutable/);
  // Fuente caída: cuenta como fallida y no deja fila.
  const r4 = await cicloClima({ ahora: h(-5), fetch: async () => new Response('x', { status: 503 }) });
  assert.deepEqual([r4.consultados, r4.guardados, r4.fallidos], [1, 0, 1]);
  assert.equal(climaDe('nfl', 'nfl', 'g1', 'GB').estado, 'previsión', 'sigue la última previsión; nada inventado');
});
