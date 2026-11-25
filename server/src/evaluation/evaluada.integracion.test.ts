// B1 (revisión del PR 17): la predicción EVALUADA es la misma en todas partes.
//
// Antes, «¿Acertó?», los resultados recientes y la evaluación en vivo puntuaban la primera fila del
// registro (la publicación original), mientras el historial de la ficha llamaba «evaluada» a la
// final congelada en prematch_final. Con una original 20/20/60 y una final 60/20/20, y el local
// ganando 1-0, la app contaba un fallo y a la vez etiquetaba como evaluada la instantánea que
// acertaba. Aquí se comprueba que etiqueta, veredicto, agregado, evaluación en vivo y exportación
// dicen lo mismo, en los dos sentidos del cambio de favorito, sin cambio, sin final, con final
// ilegible y sin publicación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { recordSnapshot, freezeFinals, historial } = await import('../prematch/snapshots.ts');
const { historialReciente } = await import('../today.ts');
const { predicciones } = await import('./live.ts');
const { exportar } = await import('../exports/datasets.ts');
const { buildApp } = await import('../app.ts');
const { configAuth } = await import('../auth/mode.ts');
const { LimiteDeIntentos } = await import('../auth/rateLimit.ts');

const db = getDb();
const H = 3_600_000;
const AHORA = new Date();
// Ayer a mediodía (hora local del proceso): dentro de la ventana de 7 días de historialReciente.
const ayer = new Date(AHORA.getFullYear(), AHORA.getMonth(), AHORA.getDate() - 1, 12, 0, 0);
const INICIO = ayer.toISOString();
const antes = (h: number) => new Date(ayer.getTime() - h * H);

/** Una fila del registro de fútbol, ya resuelta (marcador g1-g2). */
function publicar(mk: string, probs: [number, number, number], g1: number, g2: number, inicio = INICIO, predichaEn = antes(30)) {
  db.prepare(
    `INSERT INTO fb_prediction_log (match_key, league, commence_time, home_id, away_id, home_name, away_name,
       prob_home, prob_draw, prob_away, shown_home, shown_draw, shown_away, market_prob_home, market_prob_draw, market_prob_away,
       predicted_at, home_goals, away_goals, resolved_at, model_version)
     VALUES (?, 'esp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.4, 0.3, 0.3, ?, ?, ?, ?, 'fb-v1')`,
  ).run(mk, inicio, `${mk}-l`, `${mk}-v`, `Local ${mk}`, `Visitante ${mk}`, ...probs, ...probs, predichaEn.toISOString(), g1, g2, AHORA.toISOString());
}

function instantanea(mk: string, probs: [number, number, number], en: Date, inicio = INICIO) {
  const r = recordSnapshot(
    {
      sport: 'football',
      matchKey: mk,
      eventId: null,
      commence: inicio,
      outcomes: [`Local ${mk}`, 'Empate', `Visitante ${mk}`],
      probs,
      probsRaw: probs,
      odds: [2.5, 3.3, 2.9],
      oddsAt: new Date(en.getTime() - 60_000).toISOString(),
      dataAsOf: new Date(en.getTime() - H).toISOString(),
      usaMercado: false,
      entradas: { x: { etiqueta: 'x', valor: probs[0] } },
    },
    en,
  );
  assert.equal(r, 'nueva', `instantánea de ${mk}`);
}

// 1. El favorito pasa del visitante al local, y gana el local.
publicar('b1-ida', [0.2, 0.2, 0.6], 1, 0);
instantanea('b1-ida', [0.2, 0.2, 0.6], antes(30));
instantanea('b1-ida', [0.6, 0.2, 0.2], antes(2));
// 2. Al revés: del local al visitante, y gana el local.
publicar('b1-vuelta', [0.6, 0.2, 0.2], 1, 0);
instantanea('b1-vuelta', [0.6, 0.2, 0.2], antes(30));
instantanea('b1-vuelta', [0.2, 0.2, 0.6], antes(2));
// 3. Sin cambio de favorito.
publicar('b1-igual', [0.5, 0.3, 0.2], 2, 1);
instantanea('b1-igual', [0.5, 0.3, 0.2], antes(30));
instantanea('b1-igual', [0.55, 0.25, 0.2], antes(2));
// Congelar las finales de lo que ya empezó.
freezeFinals(new Date(ayer.getTime() + 60_000));

// 4. Sin final congelada (el ciclo no la congeló): se evalúa la publicación y se marca «legado».
//    Empieza después de la congelación de arriba, y no se vuelve a congelar.
const INICIO_SIN_FINAL = new Date(ayer.getTime() + 3 * H).toISOString();
publicar('b1-sinfinal', [0.2, 0.2, 0.6], 1, 0, INICIO_SIN_FINAL);

// 5. Una final ilegible (de dos resultados en un mercado de tres): no se evalúa ni se sustituye.
publicar('b1-ilegible', [0.2, 0.2, 0.6], 1, 0);
db.prepare(
  `INSERT INTO prematch_final (sport, match_key, commence_time, frozen_at, source, snapshot_id, captured_at, outcomes, probs, market_probs, model_version)
   VALUES ('football', 'b1-ilegible', ?, ?, 'prediction_log', NULL, ?, '["a","b"]', '[0.7,0.3]', NULL, 'fb-v1')`,
).run(INICIO, new Date(ayer.getTime() + 60_000).toISOString(), antes(30).toISOString());

async function veredicto(mk: string) {
  const e = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
  const app = await buildApp({ auth: { config: configAuth(e), limite: new LimiteDeIntentos() }, servirWeb: false, logger: false, entorno: e });
  try {
    const r = await app.inject({ method: 'GET', url: `/api/resultado/football/${encodeURIComponent(mk)}` });
    return { status: r.statusCode, cuerpo: r.json() as Record<string, unknown> };
  } finally {
    await app.close();
  }
}

const reciente = (mk: string) => historialReciente(AHORA, 7).resultados.find((r) => r.casa === `Local ${mk}`);
const enVivo = (mk: string) => predicciones('football').find((p) => (p as { matchKey?: string }).matchKey === mk);
const exportada = (mk: string) => exportar('predicciones', { sport: 'football' }).datos.find((d) => d.match_key === mk);

test('B1 ida: original 20/20/60, final 60/20/20, gana el local: acierto en etiqueta, veredicto, agregado, en vivo y exportación', async () => {
  const r = reciente('b1-ida');
  assert.ok(r, 'sale en los resultados recientes');
  assert.equal(r.acerto, true, 'se puntúa la final congelada, no la publicación original');
  assert.equal(r.favorito, 'Local b1-ida');
  assert.equal(r.probabilidad, 0.6);
  assert.equal(r.evaluacion, 'final');

  const h = historial('football', 'b1-ida');
  const evaluada = h.find((x) => x.papel === 'evaluada');
  assert.ok(evaluada, 'el historial marca una evaluada');
  assert.deepEqual(evaluada.probs, [0.6, 0.2, 0.2]);

  const v = await veredicto('b1-ida');
  assert.equal(v.status, 200);
  assert.equal(v.cuerpo.acerto, true);
  assert.deepEqual(v.cuerpo.probabilidades, [0.6, 0.2, 0.2]);
  const ev = v.cuerpo.evaluacion as { tipo: string; snapshotId: number | null; politica: string };
  assert.equal(ev.tipo, 'final');
  assert.equal(ev.snapshotId, evaluada.id, 'el veredicto y el historial señalan la misma instantánea');

  const p = enVivo('b1-ida');
  assert.ok(p, 'entra en la evaluación en vivo');
  assert.deepEqual(p.p.map((x) => +x.toFixed(6)), [0.6, 0.2, 0.2]);

  const x = exportada('b1-ida');
  assert.ok(x);
  assert.equal(x.evaluacion, 'final');
  assert.equal(x.eval_prob_a, 0.6);
  assert.equal(x.eval_prob_b, 0.2);
  assert.equal(x.eval_prob_draw, 0.2);
});

test('B1 vuelta: original 60/20/20, final 20/20/60, gana el local: fallo en todas partes', async () => {
  const r = reciente('b1-vuelta');
  assert.equal(r?.acerto, false);
  assert.equal(r?.favorito, 'Visitante b1-vuelta');
  const v = await veredicto('b1-vuelta');
  assert.equal(v.cuerpo.acerto, false);
  assert.deepEqual(v.cuerpo.probabilidades, [0.2, 0.2, 0.6]);
  assert.deepEqual(historial('football', 'b1-vuelta').find((x) => x.papel === 'evaluada')?.probs, [0.2, 0.2, 0.6]);
});

test('B1 sin cambio de favorito: acierto con la probabilidad de la final', async () => {
  const r = reciente('b1-igual');
  assert.equal(r?.acerto, true);
  assert.equal(r?.probabilidad, 0.55);
  assert.equal((await veredicto('b1-igual')).cuerpo.acerto, true);
});

test('B1 sin final congelada: se evalúa la publicación original, marcada «legado», y el historial no inventa una evaluada', async () => {
  const r = reciente('b1-sinfinal');
  assert.equal(r?.evaluacion, 'legado');
  assert.equal(r?.acerto, false, 'la publicación daba favorito al visitante');
  const v = await veredicto('b1-sinfinal');
  assert.equal((v.cuerpo.evaluacion as { tipo: string }).tipo, 'legado');
  assert.equal(historial('football', 'b1-sinfinal').filter((x) => x.papel === 'evaluada').length, 0);
  assert.equal(exportada('b1-sinfinal')?.evaluacion, 'legado');
  const h = historialReciente(AHORA, 7);
  assert.ok(h.evaluacion.legado >= 1, 'el resumen dice cuántas son legado');
});

test('B1 final ilegible: no se evalúa, no se cambia por la publicación y se cuenta como excluida', async () => {
  assert.equal(reciente('b1-ilegible'), undefined, 'fuera de los resultados recientes');
  const h = historialReciente(AHORA, 7);
  assert.ok(h.evaluacion.excluidas >= 1);
  const v = await veredicto('b1-ilegible');
  assert.equal(v.status, 200);
  assert.equal(v.cuerpo.acerto, null, 'sin veredicto');
  assert.equal((v.cuerpo.evaluacion as { tipo: string | null; motivo: string | null }).motivo, 'final-invalida');
  assert.equal(exportada('b1-ilegible')?.evaluacion, 'excluida');
  assert.ok(!predicciones('football').some((p) => (p as { matchKey?: string }).matchKey === 'b1-ilegible'));
});

test('B1 sin publicación: el veredicto no inventa nada', async () => {
  const v = await veredicto('b1-no-existe');
  assert.equal(v.status, 404);
});

test('B1 agregado: el resumen nombra la política y suma lo mismo que las filas', () => {
  const h = historialReciente(AHORA, 7);
  assert.equal(h.evaluacion.politica, 'final-congelada-v1');
  const enVivoFilas = h.resultados.filter((r) => r.origen === 'en vivo');
  assert.equal(h.porOrigen['en vivo'].total, enVivoFilas.length);
  assert.equal(h.porOrigen['en vivo'].aciertos, enVivoFilas.filter((r) => r.acerto).length);
  assert.equal(h.evaluacion.final + h.evaluacion.legado, enVivoFilas.length);
});
