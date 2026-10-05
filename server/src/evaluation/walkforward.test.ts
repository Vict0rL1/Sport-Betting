import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { walkForward, periodoDe, ajustarPlatt, MIN_PASADO, MIN_SEGMENTO } = await import('./walkforward.ts');
type Juego = Parameters<typeof walkForward>[1][number];

/** Generador determinista. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/**
 * Un histórico sintético de baloncesto: 20 equipos con fuerza fija, un partido por día.
 * El «modelo» es la verdad un poco sobreconfiada, para que la recalibración tenga algo
 * que corregir.
 */
function historico(dias: number, seed = 1, desde = Date.UTC(2020, 9, 1)): Juego[] {
  const r = rng(seed);
  const fuerza = Array.from({ length: 20 }, (_, i) => (i - 10) * 30);
  const out: Juego[] = [];
  for (let d = 0; d < dias; d++) {
    const fecha = new Date(desde + d * 86_400_000).toISOString().slice(0, 10);
    for (let g = 0; g < 4; g++) {
      const a = Math.floor(r() * 20);
      let b = Math.floor(r() * 20);
      if (b === a) b = (a + 1) % 20;
      const verdad = 1 / (1 + 10 ** (-(fuerza[a] - fuerza[b] + 60) / 400));
      const modelo = 1 / (1 + 10 ** (-(1.4 * (fuerza[a] - fuerza[b] + 60)) / 400));
      const y = r() < verdad ? 0 : 1;
      out.push({ fecha, a: `t${a}`, b: `t${b}`, local: true, y, K: 2, modelo: d < 5 ? null : [modelo, 1 - modelo], profundidad: d });
    }
  }
  return out;
}

test('los periodos van por deporte', () => {
  assert.equal(periodoDe('tennis', { fecha: '20230515' }), '2023-T2');
  assert.equal(periodoDe('football', { fecha: '2023-09-02' }), '2023/24 ida');
  assert.equal(periodoDe('football', { fecha: '2024-02-10' }), '2023/24 vuelta');
  assert.equal(periodoDe('basketball', { fecha: '2024-01-10' }), '2023/24 ene–jun');
  assert.equal(periodoDe('baseball', { fecha: '2024-08-01' }), '2024 jul–oct');
  assert.equal(periodoDe('nfl', { fecha: '2025-01-12', temporada: 2024 }), '2024');
});

// TEST NEGATIVO CONTRA LA FUGA: quitar el futuro no puede cambiar nada del pasado. Si la
// recalibración o un baseline mirara periodos posteriores, las cifras cambiarían.
test('las cifras de un periodo no dependen de los periodos posteriores', () => {
  const todo = historico(600);
  const completo = walkForward('basketball', todo);
  const corte = completo.periodos[2];
  const truncado = walkForward('basketball', todo.filter((j) => j.fecha <= corte.hasta));
  const mismo = truncado.periodos.find((p) => p.periodo === corte.periodo)!;
  assert.equal(mismo.n, corte.n);
  assert.equal(mismo.modelo.logLoss, corte.modelo.logLoss);
  assert.equal(mismo.recalibrado.logLoss, corte.recalibrado.logLoss, 'la recalibración solo usa el pasado');
  assert.equal(mismo.recalibrado.parametros, corte.recalibrado.parametros);
  assert.deepEqual(mismo.baselines, corte.baselines);
});

test('la recalibración de cada periodo se ajusta con los partidos ANTERIORES, ni uno más', () => {
  const r = walkForward('basketball', historico(600));
  let anteriores = 0;
  for (const p of r.periodos) {
    if (anteriores >= MIN_PASADO) assert.match(p.recalibrado.parametros, new RegExp(`con ${anteriores} partidos anteriores`));
    else assert.match(p.recalibrado.parametros, /identidad/);
    anteriores += p.n;
  }
  // Y corrige la sobreconfianza: el modelo sintético exagera ×1,4 y Platt lo devuelve a ~1/1,4.
  const ultimo = r.periodos[r.periodos.length - 1];
  const b = Number(/b=([\d.-]+)/.exec(ultimo.recalibrado.parametros)?.[1]);
  assert.ok(Math.abs(b - 1 / 1.4) < 0.12, `b = ${b}`);
  assert.ok((r.global.recalibrado.logLoss as number) < (r.global.modelo.logLoss as number));
});

test('el Elo básico predice antes de actualizar: el primer partido de todos sale con la ventaja de campo sola', () => {
  const r = walkForward('tennis', [
    { fecha: '20200101', a: '1', b: '2', local: false, y: 0, K: 2, modelo: [0.6, 0.4] },
  ]);
  assert.equal(r.global.baselines['Elo básico'].logLoss?.toFixed(6), Math.log(2).toFixed(6), 'sin historia, 50 %');
});

test('el holdout final de la NFL no se puntúa', () => {
  const juegos: Juego[] = [2022, 2023, 2024, 2025].flatMap((t) =>
    Array.from({ length: 10 }, (_, i) => ({
      fecha: `${t}-10-${String(i + 1).padStart(2, '0')}`, temporada: t, a: 'kc', b: 'buf', local: true, y: i % 2, K: 2 as const, modelo: [0.55, 0.45],
    })),
  );
  const r = walkForward('nfl', juegos);
  assert.equal(r.holdoutExcluido, 20);
  assert.deepEqual(r.periodos.map((p) => p.periodo), ['2022', '2023']);
});

test('ROI: solo con ventaja ≥ la mínima de la política, contra la cuota; el CLV es null, no 0', () => {
  const j = (y: number, modelo: number[], cuotas: number[]): Juego => ({ fecha: '2021-03-01', a: 'a', b: 'b', local: true, y, K: 2, modelo, cuotas });
  const r = walkForward('baseball', [
    j(0, [0.6, 0.4], [2.0, 1.9]), // ventaja +20 % al local: apuesta y gana +1
    j(1, [0.6, 0.4], [2.0, 1.9]), // apuesta y pierde −1
    j(0, [0.5, 0.5], [1.9, 1.9]), // sin ventaja: no apuesta
  ]);
  const p = r.periodos[0];
  assert.equal(p.roi?.apuestas, 2);
  assert.equal(p.roi?.roi, 0);
  assert.equal(p.clv, null);
});

test('segmentos y regímenes con poca muestra no se publican', () => {
  const xs = historico(120).map((j, i) => ({ ...j, segmento: { descanso: i % 50 === 0 ? 'raro' : 'normal' }, regimen: 'regular' }));
  const r = walkForward('basketball', xs);
  assert.ok(r.porSegmento.descanso.normal);
  assert.equal(r.porSegmento.descanso.raro, undefined, `menos de ${MIN_SEGMENTO}`);
  assert.ok(r.porRegimen.regular.n >= MIN_SEGMENTO);
});

test('cobertura: el 25 % con más respaldo es el subconjunto de mayor profundidad', () => {
  const r = walkForward('basketball', historico(300));
  assert.deepEqual(r.cobertura.map((c) => c.cobertura), [1, 0.75, 0.5, 0.25]);
  assert.ok(r.cobertura[3].n < r.cobertura[0].n);
});

test('Platt recupera una pendiente conocida', () => {
  const r0 = rng(5);
  const xs = Array.from({ length: 4000 }, () => {
    const z = (r0() - 0.5) * 6;
    const p = 1 / (1 + Math.exp(-z));
    const verdad = 1 / (1 + Math.exp(-(0.5 * z)));
    return { p, y: r0() < verdad ? 1 : 0 };
  });
  const { a, b } = ajustarPlatt(xs);
  assert.ok(Math.abs(b - 0.5) < 0.08, `b = ${b}`);
  assert.ok(Math.abs(a) < 0.1, `a = ${a}`);
});
