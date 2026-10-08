// Los informes: uno por periodo, archivados sin reescritura, a su hora y con lo que hay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { generarDiario, generarSemanal, cicloResumenDiario, cicloInformeSemanal, listarInformes, informe } = await import('./index.ts');
const { semanaIso, local, lunesDe } = await import('./tiempo.ts');
const { semanaAnterior } = await import('./semanal.ts');
const { tabla, pct, dinero } = await import('./formato.ts');
const { listarBandeja } = await import('../bandeja/index.ts');

const db = getDb();
const ZONA = 'Europe/Madrid';

test('tiempo: semana ISO, día local y lunes', () => {
  assert.equal(semanaIso('2026-10-07'), '2026-W41');
  assert.equal(semanaIso('2027-01-01'), '2026-W53');
  assert.equal(semanaIso('2026-01-01'), '2026-W01');
  assert.equal(lunesDe('2026-10-11'), '2026-10-05');
  const l = local(new Date('2026-10-07T23:30:00Z'), ZONA);
  assert.deepEqual([l.fecha, l.hora, l.diaSemana], ['2026-10-08', 1, 4], 'medianoche y media en Madrid ya es jueves');
  assert.equal(semanaAnterior(new Date('2026-10-07T08:00:00Z'), ZONA).semana, '2026-W40');
});

test('formato: tabla, porcentaje y dinero en español', () => {
  assert.equal(tabla(['a', 'b'], [['x|y', 1]]), '| a | b |\n|---|---|\n| x/y | 1 |');
  assert.equal(tabla(['a'], []), '');
  assert.equal(pct(0.1234), '12,3 %');
  assert.equal(pct(null), '—');
  assert.equal(dinero(-1234.5), '−1.234,50');
});

test('el diario no se genera antes de las 7:00 locales', () => {
  assert.equal(cicloResumenDiario(() => {}, new Date('2026-10-07T04:30:00Z'), ZONA), null, '6:30 en Madrid');
});

test('el diario: partidos de ayer con su resultado, banco y alertas; uno por día y avisa', () => {
  // Una predicción de NFL de ayer (6 de octubre) ya resuelta: el favorito ganó.
  db.prepare(
    "INSERT INTO naf_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, reliability, predicted_at, home_points, away_points, resolved_at) VALUES ('nfl|buf|mia', 'nfl', 'odds-9', '2026-10-06T17:00:00Z', 'BUF', 'MIA', 'Bills', 'Dolphins', 0.66, 'high', '2026-10-05T10:00:00Z', 27, 20, '2026-10-06T21:00:00Z')",
  ).run();
  const i = cicloResumenDiario(() => {}, new Date('2026-10-07T06:00:00Z'), ZONA)!;
  assert.ok(i);
  assert.equal(i.tipo, 'diario');
  assert.equal(i.periodo, '2026-10-07');
  assert.match(i.markdown, /^# Resumen del día · miércoles 7 de octubre/);
  assert.match(i.markdown, /NFL: el favorito del modelo ganó 1 de 1/);
  assert.match(i.markdown, /## Banco de papel/);
  assert.match(i.resumen, /ayer el favorito ganó 1 de 1/);
  const otra = generarDiario(new Date('2026-10-07T15:00:00Z'), ZONA);
  assert.equal(otra.nuevo, false, 'un informe archivado no se rehace');
  assert.equal(otra.informe.id, i.id);
  assert.ok(listarBandeja({ tipo: 'digest_listo' }).avisos.some((a) => a.url === `/informes/${i.id}`), 'avisa con enlace al informe');
});

test('el semanal: la semana anterior, desde el lunes a las 7:00', () => {
  assert.equal(cicloInformeSemanal(() => {}, new Date('2026-10-05T04:00:00Z'), ZONA), null, 'lunes a las 6:00');
  const s = cicloInformeSemanal(() => {}, new Date('2026-10-05T06:00:00Z'), ZONA)!;
  assert.equal(s.periodo, '2026-W40');
  for (const sec of ['Salud del modelo', 'CLV del banco de papel', 'Banco', 'Alertas de deriva', 'Frescura de los datos', 'Experimentos']) assert.match(s.markdown, new RegExp(`## ${sec}`));
  assert.equal(generarSemanal(new Date('2026-10-08T10:00:00Z'), ZONA).nuevo, false, 'el miércoles sigue siendo la W40 la que toca');
});

test('archivo: lista, lee y no se reescribe ni se borra', () => {
  const xs = listarInformes();
  assert.equal(xs.length, 2);
  assert.equal(listarInformes({ tipo: 'semanal' }).length, 1);
  const d = informe(xs[0].id)!;
  assert.equal(typeof d.datos, 'object');
  assert.throws(() => db.prepare("UPDATE reports SET markdown = 'x'").run(), /no se reescribe/);
  assert.throws(() => db.prepare('DELETE FROM reports').run(), /no se borra/);
});
