// Pruebas de propiedades (Fase 7.4) con fast-check: en vez de unos pocos casos escritos a mano,
// miles de entradas generadas, y lo que tiene que cumplirse en TODAS. Cuando una falla, fast-check
// reduce el contraejemplo al más simple y lo enseña con su semilla para reproducirlo.
//
// Cubre lo que mueve dinero o borra datos: quitar el margen, Kelly y la decisión de importe, los
// topes por grupo de correlación, la exposición agregada y el adelgazamiento de snapshots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import './setup.ts';

const { devigMultiplicative, devigShin, devigPower } = await import('../market/devig.ts');
const { fullKelly, fractionalKelly, expectedValue } = await import('../staking/kelly.ts');
const { decideStake, DEFAULT_CONFIG } = await import('../staking/policy.ts');
const { cabeEnGrupos, gruposDe, limitesVigentes } = await import('../staking/risk.ts');
const { aggregateExposure } = await import('../staking/correlation.ts');
const { decidir: decidirRetencion, MARCAS_HORAS } = await import('../odds/retention.ts');

const RUNS = { numRuns: 500 };
const CAL = { tennis: { ece: 0, n: 1, beatsMarket: true, vsMarketLogLoss: null, measuredAt: '' } };

/** Un mercado: probabilidades reales (2–4 salidas, cada una 3–90 %) y un margen multiplicativo. */
const mercado = fc
  .tuple(fc.array(fc.double({ min: 1, max: 30, noNaN: true }), { minLength: 2, maxLength: 4 }), fc.double({ min: 0, max: 0.12, noNaN: true }))
  .map(([pesos, margen]) => {
    const s = pesos.reduce((a, b) => a + b, 0);
    const p = pesos.map((w) => w / s);
    return { p, margen, cuotas: p.map((x) => 1 / (x * (1 + margen))) };
  })
  .filter(({ p, cuotas }) => p.every((x) => x > 0.03 && x < 0.9) && cuotas.every((o) => o > 1.01));

test('de-vig: los tres métodos suman 1, dejan cada probabilidad en (0, 1) y conservan el orden de las cuotas', () => {
  fc.assert(
    fc.property(mercado, ({ cuotas }) => {
      for (const f of [devigMultiplicative, devigShin, devigPower]) {
        const { probs } = f(cuotas);
        assert.equal(probs.length, cuotas.length);
        assert.ok(Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < 1e-6, `${f.name}: suma ${probs.reduce((a, b) => a + b, 0)}`);
        for (const x of probs) assert.ok(x > 0 && x < 1, `${f.name}: ${x}`);
        for (let i = 0; i < cuotas.length; i++)
          for (let j = 0; j < cuotas.length; j++) if (cuotas[i] < cuotas[j] - 1e-9) assert.ok(probs[i] >= probs[j] - 1e-9, `${f.name}: orden`);
      }
    }),
    RUNS,
  );
});

test('de-vig multiplicativo: con un margen proporcional devuelve exactamente las probabilidades de partida', () => {
  fc.assert(
    fc.property(mercado, ({ p, cuotas, margen }) => {
      const r = devigMultiplicative(cuotas);
      p.forEach((x, i) => assert.ok(Math.abs(r.probs[i] - x) < 1e-9));
      assert.ok(Math.abs(r.overround - (1 + margen)) < 1e-9);
    }),
    RUNS,
  );
});

const pYCuota = fc.tuple(fc.double({ min: 0.01, max: 0.99, noNaN: true }), fc.double({ min: 1.01, max: 20, noNaN: true }));

test('Kelly: nunca apuesta sin ventaja, nunca pasa de 1, crece con p y la fracción solo lo reduce', () => {
  fc.assert(
    fc.property(pYCuota, fc.double({ min: 0, max: 0.2, noNaN: true }), ([p, o], dp) => {
      const f = fullKelly(p, o);
      assert.ok(f >= 0 && f < 1);
      if (expectedValue(p, o) <= 0) assert.equal(f, 0, 'sin ventaja, cero');
      else assert.ok(f > 0);
      const p2 = Math.min(0.99, p + dp);
      assert.ok(fullKelly(p2, o) >= f - 1e-12, 'monótono en p');
      for (const k of [0.25, 0.2] as const) assert.ok(Math.abs(fractionalKelly(p, o, k) - k * f) < 1e-12);
    }),
    RUNS,
  );
});

test('decideStake: importe ≥ 0 en céntimos hacia abajo, dentro del tope por partido y de la exposición libre; corta sin ventaja o por pérdidas', () => {
  fc.assert(
    fc.property(
      pYCuota,
      fc.double({ min: 10, max: 100_000, noNaN: true }),
      fc.double({ min: 0, max: 0.2, noNaN: true }),
      fc.double({ min: -0.2, max: 0.05, noNaN: true }),
      ([p, o], banco, abiertaFr, perdidaFr) => {
        const abierta = abiertaFr * banco;
        const hoy = perdidaFr * banco;
        const d = decideStake({ sport: 'tennis', p, odds: o, bankroll: banco, openExposure: abierta, perdidas: { hoy, semana: hoy } }, DEFAULT_CONFIG, CAL as never);
        assert.ok(d.stake >= 0);
        assert.ok(Math.abs(d.stake * 100 - Math.round(d.stake * 100)) < 1e-6, 'céntimos');
        assert.ok(d.stake <= DEFAULT_CONFIG.maxPerEvent * banco + 1e-9, 'tope por partido');
        assert.ok(d.stake <= Math.max(0, DEFAULT_CONFIG.maxTotalExposure * banco - abierta) + 1e-9, 'exposición total');
        if (d.edge < DEFAULT_CONFIG.minEdge) assert.equal(d.stake, 0, 'sin ventaja mínima');
        if (hoy <= -DEFAULT_CONFIG.dailyLossLimit * banco) assert.equal(d.stake, 0, 'corte por pérdida diaria');
        if (d.stake === 0) assert.ok(d.blockedBy, 'un cero siempre dice por qué');
      },
    ),
    RUNS,
  );
});

test('topes por grupo de correlación: lo que cabe nunca hace pasar ningún grupo de su límite', () => {
  const lim = limitesVigentes();
  fc.assert(
    fc.property(
      fc.constantFrom('tennis', 'football', 'nfl'),
      fc.array(fc.stringMatching(/^[a-z]{1,4}$/), { minLength: 1, maxLength: 3 }),
      fc.double({ min: 100, max: 50_000, noNaN: true }),
      fc.array(fc.double({ min: 0, max: 0.05, noNaN: true }), { minLength: 4, maxLength: 4 }),
      (sport, participantes, banco, ocupado) => {
        const grupos = gruposDe(sport, 'ev', participantes);
        const extra = new Map(grupos.map((g, i) => [g, ocupado[i % ocupado.length] * banco]));
        const { cabe, limitante } = cabeEnGrupos(grupos, banco, extra);
        assert.ok(cabe >= 0);
        for (const g of grupos) {
          const limite = (g.startsWith('evento:') ? lim.max_same_event_exposure : g.startsWith('jugador:') ? lim.max_same_player_exposure : lim.max_same_team_exposure) * banco;
          const ya = extra.get(g) ?? 0;
          if (ya <= limite) assert.ok(ya + cabe <= limite + 1e-6, `${g}: ${ya} + ${cabe} > ${limite}`);
        }
        assert.ok(limitante == null || grupos.includes(limitante));
      },
    ),
    RUNS,
  );
});

test('exposición agregada: la efectiva nunca pasa de la ingenua y la ingenua es la suma', () => {
  const posicion = fc.record({
    key: fc.uuid(),
    matchKey: fc.constantFrom('a', 'b', 'c'),
    league: fc.constantFrom('epl', 'liga'),
    day: fc.constantFrom('2026-10-10', '2026-10-11'),
    market: fc.constantFrom('1x2', 'over_under', 'btts', 'otro'),
    side: fc.constantFrom('canonica', 'contraria', 'otro'),
    fraction: fc.double({ min: 0, max: 0.05, noNaN: true }),
  });
  fc.assert(
    fc.property(fc.array(posicion, { maxLength: 12 }), (ps) => {
      const a = aggregateExposure(ps as never);
      assert.ok(Math.abs(a.naive - ps.reduce((s, p) => s + p.fraction, 0)) < 1e-12);
      assert.ok(a.effective >= 0 && a.effective <= a.naive + 1e-9, `${a.effective} > ${a.naive}`);
      assert.ok(Number.isFinite(a.concentration));
    }),
    RUNS,
  );
});

test('adelgazar snapshots: conserva apertura, última, cada marca y el cierre; reparte todo; y aplicarlo dos veces no borra más', () => {
  const H = 3_600_000;
  const inicio = Date.UTC(2026, 9, 10, 18);
  const fila = fc.record({
    sel: fc.constantFrom('A', 'B'),
    casa: fc.constantFrom('x', 'y'),
    horasAntes: fc.double({ min: -3, max: 72, noNaN: true }),
  });
  fc.assert(
    fc.property(fc.array(fila, { minLength: 1, maxLength: 40 }), (xs) => {
      const filas = xs.map((x, i) => ({
        id: i + 1,
        event_id: 'e',
        market: 'h2h',
        selection: x.sel,
        bookmaker: x.casa,
        commence_time: new Date(inicio).toISOString(),
        observed_at: new Date(inicio - x.horasAntes * H).toISOString(),
      }));
      const { conservar, borrar } = decidirRetencion(filas);
      assert.equal(conservar.length + borrar.length, filas.length);
      assert.ok(conservar.every((id) => !borrar.includes(id)));
      const grupos = new Map<string, typeof filas>();
      for (const f of filas) (grupos.get(`${f.selection}|${f.bookmaker}`) ?? grupos.set(`${f.selection}|${f.bookmaker}`, []).get(`${f.selection}|${f.bookmaker}`)!).push(f);
      for (const g of grupos.values()) {
        const orden = [...g].sort((a, b) => a.observed_at.localeCompare(b.observed_at) || a.id - b.id);
        assert.ok(conservar.includes(orden[0].id), 'apertura');
        assert.ok(conservar.includes(orden[orden.length - 1].id), 'última');
        for (const h of [...MARCAS_HORAS, 0]) {
          const antes = orden.filter((f) => Date.parse(f.observed_at) <= inicio - h * H);
          if (antes.length) assert.ok(conservar.includes(antes[antes.length - 1].id), `marca T-${h}h`);
        }
      }
      const segunda = decidirRetencion(filas.filter((f) => conservar.includes(f.id)));
      assert.deepEqual(segunda.borrar, [], 'idempotente');
    }),
    RUNS,
  );
});
