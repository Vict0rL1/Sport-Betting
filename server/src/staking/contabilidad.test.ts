// El contrato de la contabilidad del riesgo (staking/contabilidad.ts, 'riesgo-v1'), en sus fronteras.
// Casi todo sobre la función pura `evaluarPerdidas`: las filas, el banco, la moneda, la hora y la zona
// entran; nada se lee de fuera.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { evaluarPerdidas, evaluarExposicion, beneficioCentimos, limiteCentimos, diasDeLiquidacion, zonaPolitica, centimosConSigno } = await import('./contabilidad.ts');
const { DEFAULT_CONFIG, estadoDePerdidas, decideStake } = await import('./policy.ts');
type Liquidada = import('./contabilidad.ts').Liquidada;

const MADRID = 'Europe/Madrid';
// Miércoles 25-nov-2026, 13:00 en Madrid; la semana empezó el lunes 23.
const AHORA = new Date('2026-11-25T12:00:00Z');
const cfg = { dailyLossLimit: DEFAULT_CONFIG.dailyLossLimit, weeklyLossLimit: DEFAULT_CONFIG.weeklyLossLimit };

/** Liquidada hoy a las 10:00 UTC, registrada antes como pendiente, en euros. */
const hoy = (o: Partial<Liquidada>): Liquidada => ({
  placed_on: '2026-11-25',
  created_at: '2026-11-25T08:00:00Z',
  settled_at: '2026-11-25T10:00:00Z',
  status: 'lost',
  stake: 10,
  odds: 2,
  payout: null,
  currency: 'EUR',
  ...o,
});

const eval1 = (filas: Liquidada[], moneda: 'EUR' | 'USD' | null = 'EUR', banco = 1000, now = AHORA, zona: string | null = MADRID) => evaluarPerdidas(filas, banco, moneda, cfg, now, zona);

test('cada estado, en céntimos, con el mismo pago que el registro (dinero.ts)', () => {
  const casos: [Partial<Liquidada>, number][] = [
    [{ status: 'won', stake: 10, odds: 2.06 }, 1060],
    [{ status: 'lost', stake: 10 }, -1000],
    [{ status: 'void', stake: 10 }, 0],
    [{ status: 'push', stake: 10 }, 0],
    [{ status: 'half_won', stake: 10.01, odds: 1.95 }, 475],
    [{ status: 'half_lost', stake: 10.01, odds: 1.95 }, -500],
    [{ status: 'cashout', stake: 50, odds: 3.1, payout: 61.7 }, 1170],
    [{ status: 'cashout', stake: 50, odds: 3.1, payout: 0 }, -5000],
    // Una apuesta de antes de la validación, con tres decimales: se lee como estaba, redondeada una vez.
    [{ status: 'lost', stake: 10.005 }, -1001],
  ];
  for (const [o, c] of casos) {
    const b = beneficioCentimos(hoy(o));
    assert.deepEqual([b.min, b.max], [c, c], JSON.stringify(o));
    assert.equal(eval1([hoy(o)]).hoy.conocido, c, JSON.stringify(o));
  }
});

test('lo que no se sabe tiene cotas, no un 0: cashout sin importe y estado desconocido', () => {
  for (const o of [{ status: 'cashout', payout: null }, { status: 'zzz' }]) {
    const b = beneficioCentimos(hoy({ ...o, stake: 80 }));
    assert.equal(b.min, -8000, 'lo peor: perderlo todo');
    assert.equal(b.max, Infinity, 'lo mejor: sin cota');
    const e = eval1([hoy({ ...o, stake: 80 })]);
    assert.equal(e.hoy.veredicto, 'sin-evaluar', '−80 € puede pasar el límite de 50 €');
    assert.equal(e.hoy.maximo, null);
  }
  // Si incluso lo peor no llega al límite, se sabe: está por debajo.
  assert.equal(eval1([hoy({ status: 'cashout', payout: null, stake: 20 })]).hoy.veredicto, 'por-debajo');
});

test('el límite: −⌈banco × %⌉ en céntimos; igual o más es alcanzado, un céntimo menos no', () => {
  assert.equal(limiteCentimos(1000, 0.05), -5000);
  // 61,728: con céntimos enteros, perder 61,73 o más es perder el 5 % o más; 61,72 no lo es (como antes).
  assert.equal(limiteCentimos(1234.56, 0.05), -6173);
  assert.equal(eval1([hoy({ stake: 61.72 })], 'EUR', 1234.56).hoy.veredicto, 'por-debajo');
  assert.equal(eval1([hoy({ stake: 61.73 })], 'EUR', 1234.56).hoy.veredicto, 'alcanzado');
  assert.equal(limiteCentimos(0, 0.05), null);
  assert.equal(limiteCentimos(-5, 0.05), null);
  assert.equal(eval1([hoy({ stake: 50 })]).hoy.veredicto, 'alcanzado', 'exactamente el límite');
  assert.equal(eval1([hoy({ stake: 49.99 })]).hoy.veredicto, 'por-debajo', 'un céntimo menos');
  assert.equal(eval1([hoy({ stake: 50.01 })]).hoy.veredicto, 'alcanzado', 'un céntimo más');
  // Las ganancias del día también cuentan: es la pérdida NETA.
  assert.equal(eval1([hoy({ stake: 60 }), hoy({ status: 'won', stake: 10, odds: 2.5 })]).hoy.veredicto, 'por-debajo', '−60 + 15 = −45');
});

test('monedas: otra moneda no cuenta; sin moneda puede contar; banco sin moneda no atribuye nada', () => {
  const usd = hoy({ stake: 60, currency: 'USD' });
  assert.equal(eval1([usd]).hoy.veredicto, 'por-debajo', 'dólares en un banco de euros: no son suyos');
  assert.equal(eval1([usd]).apuestas, 0);
  const sinMoneda = hoy({ stake: 60, currency: null });
  const e = eval1([sinMoneda]);
  assert.equal(e.hoy.veredicto, 'sin-evaluar', 'puede ser del banco o no');
  assert.deepEqual(e.incidencias, [{ codigo: 'moneda-sin-indicar', apuestas: 1 }]);
  assert.equal(e.hoy.conocido, 0, 'no se cuenta como del banco');
  // Una ganancia sin moneda no puede empujar al límite.
  assert.equal(eval1([hoy({ status: 'won', currency: null })]).hoy.veredicto, 'por-debajo');
  // Con pérdidas en euros que ya pasan el límite, lo de dudosa moneda no lo salva.
  assert.equal(eval1([hoy({ stake: 60 }), hoy({ status: 'won', stake: 100, odds: 3, currency: null })]).hoy.veredicto, 'sin-evaluar');
  assert.equal(eval1([hoy({ stake: 60 }), hoy({ stake: 100, currency: null })]).hoy.veredicto, 'alcanzado');
  const sinBanco = eval1([hoy({ stake: 60 })], null);
  assert.equal(sinBanco.hoy.veredicto, 'sin-evaluar');
  assert.deepEqual(sinBanco.incidencias, [{ codigo: 'banco-sin-moneda', apuestas: 1 }]);
  // Sin nada que contar, la falta de moneda no importa.
  assert.equal(eval1([], null).hoy.veredicto, 'por-debajo');
  assert.deepEqual(eval1([], null).incidencias, []);
});

test('el día de liquidación: pasó a liquidada, entró ya liquidada, sin fecha', () => {
  assert.deepEqual(diasDeLiquidacion({ placed_on: '2026-11-20', created_at: '2026-11-20T08:00:00Z', settled_at: '2026-11-24T09:00:00Z' }, MADRID), { desde: '2026-11-24', hasta: '2026-11-24', incidencia: null });
  // Entró ya liquidada el mismo día en que se colocó: ese día.
  assert.deepEqual(diasDeLiquidacion({ placed_on: '2026-11-25', created_at: '2026-11-25T08:00:00Z', settled_at: '2026-11-25T08:00:00Z' }, MADRID), { desde: '2026-11-25', hasta: '2026-11-25', incidencia: null });
  // Entró ya liquidada días después de colocarse: algún día entre los dos, no se inventa cuál.
  assert.deepEqual(diasDeLiquidacion({ placed_on: '2026-11-21', created_at: '2026-11-25T08:00:00Z', settled_at: '2026-11-25T08:00:00Z' }, MADRID), { desde: '2026-11-21', hasta: '2026-11-25', incidencia: 'liquidacion-sin-dia' });
  assert.deepEqual(diasDeLiquidacion({ placed_on: '2026-11-21', created_at: '2026-11-21T08:00:00Z', settled_at: null }, MADRID), { desde: '2026-11-21', hasta: '9999-12-31', incidencia: 'liquidacion-sin-fecha' });
});

test('entró ya liquidada: cuenta en la semana si se colocó esta semana; si no, la semana queda abierta', () => {
  const registradaHoy = { created_at: '2026-11-25T08:00:00Z', settled_at: '2026-11-25T08:00:00Z' };
  // Colocada el martes, registrada hoy como perdida: de esta semana seguro; de hoy, no se sabe.
  const e = eval1([hoy({ ...registradaHoy, placed_on: '2026-11-24', stake: 120 })]);
  assert.equal(e.semana.veredicto, 'alcanzado', '120 € esta semana, sea el martes o hoy');
  assert.equal(e.hoy.veredicto, 'sin-evaluar', 'pudo ser ayer o hoy');
  // Colocada hace un mes y registrada hoy (un histórico importado): no se sabe si esta semana.
  const h = eval1([hoy({ ...registradaHoy, placed_on: '2026-10-20', stake: 120 })]);
  assert.equal(h.semana.veredicto, 'sin-evaluar');
  assert.deepEqual(h.incidencias, [{ codigo: 'liquidacion-sin-dia', apuestas: 1 }]);
  // Pequeña frente al límite: aunque fuera de esta semana, no llega. Se sabe.
  assert.equal(eval1([hoy({ ...registradaHoy, placed_on: '2026-10-20', stake: 5 })]).semana.veredicto, 'por-debajo');
  // Registrada la semana pasada: no es de esta semana en ningún caso.
  assert.equal(eval1([hoy({ placed_on: '2026-10-20', created_at: '2026-11-20T08:00:00Z', settled_at: '2026-11-20T08:00:00Z', stake: 500 })]).apuestas, 0);
  // Liquidada sin fecha: no se sabe cuándo.
  assert.equal(eval1([hoy({ settled_at: null, placed_on: '2026-11-02', stake: 200 })]).semana.veredicto, 'sin-evaluar');
});

test('la semana empieza el lunes a medianoche en la zona, también con cambio de hora', () => {
  // Otoño: el 25-oct-2026 Madrid pasa de UTC+2 a UTC+1. Lunes 26, 00:30 local = 25, 23:30 UTC.
  const lunes = new Date('2026-10-25T23:30:00Z');
  const domingoNoche = hoy({ placed_on: '2026-10-25', created_at: '2026-10-25T18:00:00Z', settled_at: '2026-10-25T22:50:00Z', stake: 120 }); // 23:50 del domingo
  const lunesMadrugada = hoy({ placed_on: '2026-10-25', created_at: '2026-10-25T18:00:00Z', settled_at: '2026-10-25T23:10:00Z', stake: 30 }); // 00:10 del lunes
  const e = eval1([domingoNoche, lunesMadrugada], 'EUR', 1000, lunes);
  assert.equal(e.semana.desde, '2026-10-26');
  assert.equal(e.semana.conocido, -3000, 'lo del domingo es de la semana pasada');
  assert.equal(e.hoy.conocido, -3000);
  // Primavera: el 29-mar-2026 pasa de UTC+1 a UTC+2. Lunes 30, 00:30 local = 29, 22:30 UTC.
  const lunesP = new Date('2026-03-29T22:30:00Z');
  const p = eval1(
    [
      hoy({ placed_on: '2026-03-29', created_at: '2026-03-29T12:00:00Z', settled_at: '2026-03-29T21:50:00Z', stake: 120 }), // 23:50 del domingo
      hoy({ placed_on: '2026-03-29', created_at: '2026-03-29T12:00:00Z', settled_at: '2026-03-29T22:10:00Z', stake: 30 }), // 00:10 del lunes
    ],
    'EUR',
    1000,
    lunesP,
  );
  assert.equal(p.semana.desde, '2026-03-30');
  assert.equal(p.semana.conocido, -3000);
});

test('una zona de la política mal escrita no cae a otra en silencio: sin evaluar', () => {
  assert.deepEqual(zonaPolitica({ APP_TIMEZONE: 'Marte/Olympus' } as NodeJS.ProcessEnv), { zona: null, origen: 'APP_TIMEZONE' });
  assert.deepEqual(zonaPolitica({ APP_TIMEZONE: 'Europe/Madrid' } as NodeJS.ProcessEnv), { zona: 'Europe/Madrid', origen: 'APP_TIMEZONE' });
  assert.equal(zonaPolitica({} as NodeJS.ProcessEnv).origen, 'servidor');
  const e = eval1([hoy({ stake: 5 })], 'EUR', 1000, AHORA, null);
  assert.equal(e.hoy.veredicto, 'sin-evaluar');
  assert.deepEqual(e.incidencias, [{ codigo: 'zona-invalida', apuestas: 1 }]);
  assert.equal(eval1([], 'EUR', 1000, AHORA, null).hoy.veredicto, 'por-debajo', 'sin nada liquidado, nada que contar');
});

test('la exposición pendiente: por moneda, con cota de arriba para lo sin moneda', () => {
  const p = (o: Partial<{ stake: number; currency: string | null; league: string | null; placed_on: string }>) => ({ placed_on: '2026-11-25', league: 'epl', stake: 10, currency: 'EUR', ...o });
  const e = evaluarExposicion([p({ stake: 40 }), p({ stake: 70, currency: 'USD' }), p({ stake: 5.555, currency: null, league: null })], 'EUR');
  assert.deepEqual(e.total, { seguro: 4000, maximo: 4556 });
  assert.deepEqual(e.porLiga.get('epl'), { seguro: 4000, maximo: 4000 });
  assert.deepEqual(e.porLiga.get('(sin liga)'), { seguro: 0, maximo: 556 });
  assert.deepEqual(e.incidencias, [{ codigo: 'moneda-sin-indicar', apuestas: 1 }]);
  assert.deepEqual(evaluarExposicion([p({ stake: 70, currency: 'USD' })], 'EUR').total, { seguro: 0, maximo: 0 });
  assert.equal(evaluarExposicion([p({ stake: Number.NaN })], 'EUR').total.maximo, Infinity, 'un importe ilegible no es 0');
});

test('los bancos de papel y de estrategia: en céntimos y con «no se sabe» explícito', () => {
  assert.equal(centimosConSigno(-12.345), -1235);
  assert.equal(centimosConSigno(1.2e-7), 0);
  assert.equal(centimosConSigno(Number.NaN), null);
  const l = estadoDePerdidas(1000, DEFAULT_CONFIG, { hoy: -50, semana: -50 });
  assert.equal(l.dayBreached, true);
  assert.equal(l.evaluable, true);
  const n = estadoDePerdidas(1000, DEFAULT_CONFIG, { hoy: null, semana: -10 });
  assert.equal(n.dayBreached, false);
  assert.equal(n.evaluable, false);
});

test('la decisión: alcanzado corta, «sin evaluar» tampoco apuesta, y lo dice distinto', () => {
  const cal = { bueno: { multiplier: 1, reason: 'prueba', ece: 0, n: 0 } } as never;
  const pedir = (perdidas: { hoy: number | null; semana: number | null }) =>
    decideStake({ sport: 'bueno', p: 0.55, odds: 2, bankroll: 1000, perdidas, openExposure: 0 }, DEFAULT_CONFIG, cal);
  assert.ok(pedir({ hoy: 0, semana: 0 }).stake > 0);
  assert.equal(pedir({ hoy: -50, semana: -50 }).blockedBy, 'límite de pérdida DIARIA alcanzado');
  const sin = pedir({ hoy: null, semana: 0 });
  assert.equal(sin.stake, 0);
  assert.equal(sin.blockedBy, 'límites de pérdida sin evaluar: falta información');
  const exp = decideStake({ sport: 'bueno', p: 0.55, odds: 2, bankroll: 1000, perdidas: { hoy: 0, semana: 0 }, openExposure: Infinity }, DEFAULT_CONFIG, cal);
  assert.equal(exp.blockedBy, 'exposición sin evaluar: falta información');
});
