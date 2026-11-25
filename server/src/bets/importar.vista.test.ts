// Fase F del seguimiento del PR #18: la importación por CSV dice ANTES de escribir qué entrará, qué no
// y qué se pierde, y al importar vuelve a validarlo todo (la vista previa no autoriza nada).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { createBet, getBet, listBets } = await import('../bets.ts');
const { analizarCsv, importarCsv } = await import('./importar.ts');

const db = getDb();
beforeEach(() => db.exec('DELETE FROM bets'));

const CAB = 'placed_on,sport,event,market,selection,odds,stake,status,payout,currency,settled_at,snapshot_id\n';

test('la vista previa no escribe nada y dice, fila a fila, qué entra y qué no, con el campo y su código', () => {
  const csv = CAB + '2026-11-20,tennis,Buena,moneyline,A,1.9,10,,,EUR,,\n' + '2026-11-20,foo,Mala,moneyline,A,1.9,10,,,EUR,,\n';
  const v = analizarCsv(csv);
  assert.equal(listBets({}).length, 0, 'nada escrito');
  assert.deepEqual([v.resumen.validas, v.resumen.rechazadas], [1, 1]);
  assert.equal(v.filas[0].linea, 2);
  assert.equal(v.filas[0].valida, true);
  assert.equal(v.filas[1].valida, false);
  assert.deepEqual(v.filas[1].errores.map((e) => [e.campo, e.codigo]), [['sport', 'apuesta.deporte-invalido']]);
});

test('un enlace a una instantánea no se restaura: se avisa, y no se engancha a otra con el mismo número', () => {
  // Una instantánea cualquiera con id 1 en ESTA instalación.
  db.prepare(
    `INSERT INTO prediction_snapshots (sport, match_key, event_id, commence_time, captured_at, outcomes, probs, model_version, inputs)
     VALUES ('tennis', 'otro|partido', 'e', '2026-12-01T10:00:00Z', '2026-11-20T08:00:00Z', '["A","B"]', '[0.6,0.4]', 'v', '{"usaMercado":false,"entradas":{}}')`,
  ).run();
  const csv = CAB + '2026-11-20,tennis,Enlazada,moneyline,A,1.9,10,,,EUR,,1\n';
  const v = analizarCsv(csv);
  assert.equal(v.filas[0].valida, true);
  assert.deepEqual(v.filas[0].avisos.map((a) => a.codigo), ['enlace-no-restaurado']);
  const r = importarCsv(csv, (input) => createBet(input));
  assert.equal(getBet(r.ids[0])!.snapshot_id, null, 'sin enlace: el id 1 de aquí es otra instantánea');
  assert.deepEqual(r.avisos.map((a) => [a.linea, a.codigo]), [[2, 'enlace-no-restaurado']]);
});

test('duplicados: se avisa de lo idéntico a una apuesta ya guardada o a otra fila del fichero, y no se descarta en silencio', () => {
  createBet({ placed_on: '2026-11-20', sport: 'tennis', event: 'Repetida', market: 'moneyline', selection: 'A', odds: 1.9, stake: 10, currency: 'EUR' });
  const fila = '2026-11-20,tennis,Repetida,moneyline,A,1.9,10,,,EUR,,\n';
  const v = analizarCsv(CAB + fila + fila + '2026-11-20,tennis,Repetida,moneyline,A,1.9,12,,,EUR,,\n');
  assert.deepEqual(v.filas.map((f) => f.avisos.map((a) => a.codigo)), [['posible-duplicado'], ['posible-duplicado'], []]);
  assert.equal(v.resumen.validas, 3, 'un aviso no es un rechazo');
});

test('la fecha de liquidación del CSV se conserva si es legible y coherente; si no, la fila se rechaza', () => {
  const r = importarCsv(CAB + '2026-11-20,tennis,Liquidada,moneyline,A,2,10,lost,,EUR,2026-11-21T19:00:00.000Z,\n', (input) => createBet(input));
  assert.equal(r.importadas, 1);
  assert.equal(getBet(r.ids[0])!.settled_at, '2026-11-21T19:00:00.000Z', 'antes se cambiaba por la hora de la importación');
  const malas = analizarCsv(
    CAB +
      '2026-11-20,tennis,Antes,moneyline,A,2,10,lost,,EUR,2026-11-19T09:00:00Z,\n' + // antes de colocarse (en cualquier zona)
      '2026-11-20,tennis,Futuro,moneyline,A,2,10,lost,,EUR,2999-01-01T10:00:00Z,\n' + // en el futuro
      '2026-11-20,tennis,Pendiente,moneyline,A,2,10,pending,,EUR,2026-11-21T10:00:00Z,\n' + // pendiente con fecha
      '2026-11-20,tennis,Ilegible,moneyline,A,2,10,lost,,EUR,ayer,\n',
  );
  assert.deepEqual(malas.filas.map((f) => f.errores.map((e) => e.campo)), [['settled_at'], ['settled_at'], ['settled_at'], ['settled_at']]);
  // Liquidada SIN fecha y colocada antes de hoy: entra, pero los límites de pérdida no sabrán qué día se liquidó.
  const sinFecha = analizarCsv(CAB + '2025-06-01,tennis,Vieja,moneyline,A,2,10,lost,,EUR,,\n');
  assert.deepEqual(sinFecha.filas[0].avisos.map((a) => a.codigo), ['dia-de-liquidacion-desconocido']);
});

test('lo que pasa del límite de filas se dice, no se ignora', () => {
  const v = analizarCsv(CAB + '2026-11-20,tennis,Una,moneyline,A,1.9,10,,,EUR,,\n'.repeat(3), 2);
  assert.equal(v.filas.length, 2);
  assert.equal(v.resumen.omitidas, 1);
  assert.equal(importarCsv(CAB + '2026-11-20,tennis,Una,moneyline,A,1.9,10,,,EUR,,\n'.repeat(3), (i) => createBet(i), 2).omitidas, 1);
});

test('la importación vuelve a validar: una fila inválida no entra aunque una vista previa anterior la diera por buena', () => {
  const r = importarCsv(CAB + '2026-11-20,foo,Mala,moneyline,A,1.9,10,,,EUR,,\n', (input) => createBet(input));
  assert.equal(r.importadas, 0);
  assert.equal(listBets({}).length, 0);
});

test('la ruta de la vista previa no escribe; la de importar escribe lo mismo que dijo', async () => {
  const { buildApp } = await import('../app.ts');
  const { configAuth } = await import('../auth/mode.ts');
  const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  const csv = CAB + '2026-11-20,tennis,Buena,moneyline,A,1.9,10,,,EUR,,7\n' + '2026-11-20,foo,Mala,moneyline,A,1.9,10,,,EUR,,\n';
  const v = (await app.inject({ method: 'POST', url: '/api/bets/import/preview', payload: { csv } })).json();
  assert.deepEqual(v.resumen, { validas: 1, rechazadas: 1, conAvisos: 1, omitidas: 0 });
  assert.equal(v.filas[0].apuesta.event, 'Buena');
  assert.deepEqual(v.filas[0].avisos, [{ codigo: 'enlace-no-restaurado' }]);
  assert.equal(listBets({}).length, 0, 'la vista previa no escribe');
  const r = (await app.inject({ method: 'POST', url: '/api/bets/import', payload: { csv } })).json();
  assert.equal(r.importadas, 1);
  assert.deepEqual(r.avisos, [{ linea: 2, codigo: 'enlace-no-restaurado' }]);
  assert.equal((await app.inject({ method: 'POST', url: '/api/bets/import/preview', payload: {} })).statusCode, 400);
  await app.close();
});

test('data-guardian (alto): solo se acepta un instante ISO con zona; una fecha a secas o sin zona no se adivina', () => {
  const fila = (sa: string) => `2026-11-20,tennis,X,moneyline,A,2,10,lost,,EUR,${sa},\n`;
  const v = analizarCsv(CAB + ['2026-11-21', '2026', '05/11/2026', '2026-11-21 23:30', '2026-11-21T23:30:00'].map(fila).join(''));
  assert.deepEqual(v.filas.map((f) => f.errores.map((e) => e.codigo)), Array(5).fill(['importar.liquidacion-sin-zona']));
  const bien = analizarCsv(CAB + fila('2026-11-21T23:30:00+01:00') + fila('2026-11-21T22:30:00.000Z'));
  assert.deepEqual(bien.filas.map((f) => f.valida), [true, true]);
});

test('data-guardian (medio): una apuesta que entró ya liquidada (settled_at = created_at) no gana un día conocido al reimportarla', () => {
  const cab = 'placed_on,sport,event,market,selection,odds,stake,status,currency,created_at,settled_at\n';
  const v = analizarCsv(cab + '2026-11-01,tennis,X,moneyline,A,2,10,lost,EUR,2026-11-20T10:00:00.000Z,2026-11-20T10:00:00.000Z\n');
  assert.equal(v.filas[0].valida, true);
  assert.equal(v.filas[0].apuesta?.settled_at ?? null, null, 'su día no se sabía: sigue sin saberse');
  assert.deepEqual(v.filas[0].avisos.map((a) => a.codigo), ['dia-de-liquidacion-desconocido']);
});

test('data-guardian (bajo): el día de liquidación no puede ser anterior al de colocación EN LA ZONA de la política', () => {
  const antes = process.env.APP_TIMEZONE;
  process.env.APP_TIMEZONE = 'America/New_York';
  try {
    // 20:00Z del 20 son las 15:00 del 20 en Nueva York: antes de colocarla el 21.
    const v = analizarCsv(CAB + '2026-11-21,tennis,X,moneyline,A,2,10,lost,,EUR,2026-11-20T20:00:00Z,\n');
    assert.deepEqual(v.filas[0].errores.map((e) => e.codigo), ['importar.liquidacion-antes']);
  } finally {
    if (antes == null) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = antes;
  }
});

test('data-guardian (bajo): el aviso de duplicado no depende del estado ni de la moneda (una pendiente ya liquidada, o sin moneda)', () => {
  const b = createBet({ placed_on: '2026-11-20', sport: 'tennis', event: 'Ya liquidada', market: 'moneyline', selection: 'A', odds: 1.9, stake: 10, currency: 'EUR' });
  db.prepare("UPDATE bets SET status = 'won', settled_at = '2026-11-21T10:00:00.000Z' WHERE id = ?").run(b.id);
  const v = analizarCsv(CAB + '2026-11-20,tennis,Ya liquidada,moneyline,A,1.9,10,,,,,\n');
  assert.deepEqual(v.filas[0].avisos.map((a) => a.codigo), ['posible-duplicado']);
});

test('seguridad: una cabecera enorme no se devuelve entera ni se recorre por celda', () => {
  const cab = 'placed_on,sport,event,market,selection,odds,stake,' + Array.from({ length: 20_000 }, (_, i) => `c${i}`).join(',') + '\n';
  const v = analizarCsv(cab + '2026-11-20,tennis,X,moneyline,A,1.9,10\n'.repeat(50));
  assert.equal(v.resumen.validas, 50);
  assert.ok(v.ignoradas.length <= 50, `${v.ignoradas.length} columnas devueltas`);
  assert.equal(v.ignoradasTotal, 20_000);
});
