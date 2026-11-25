// La cartera: qué se pondría hoy, cuánto riesgo agregado es y qué lo recortó.
//
//   GET /api/staking/book?bankroll=1000&moneda=EUR
//
// ===========================================================================
// POR QUÉ ESTO ES UN ENDPOINT Y NO UN CÁLCULO EN EL NAVEGADOR
// ===========================================================================
// El tamaño de una apuesta depende de la calibración medida, de las apuestas que ya
// están abiertas en la base y de la correlación con el resto de la cartera. Nada de eso
// está en el navegador, y ponerlo ahí significaría mantener dos implementaciones de la
// misma política de riesgo — que acabarían discrepando el día que una se actualice y la
// otra no. La política vive en un sitio.

import type { FastifyInstance } from 'fastify';
import { listUpcoming } from '../football/repo.ts';
import { buildFootballPrediction } from '../football/predict.ts';
import { bestSelection, lossState, DEFAULT_CONFIG } from '../staking/policy.ts';
import { CONTRATO_RIESGO, esMoneda, exposicionPersonal } from '../staking/contabilidad.ts';
import { aCentimos } from '../dinero.ts';
import { decideBook, type BookCandidate } from '../staking/book.ts';
import { MEASURED, SAME_LEAGUE_DAY_RHO } from '../staking/correlation.ts';
import { DEMO_SOURCE } from '../freshness.ts';

export async function registerStakingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/book', async (req, reply) => {
    const q = req.query as { bankroll?: string; moneda?: string };
    // El banco es un importe con céntimos como mucho, y una moneda (staking/contabilidad.ts). Sin
    // banco, 1000 como siempre; un banco ilegible ya no se cambia por 1000 en silencio.
    const bankroll = q.bankroll == null || q.bankroll === '' ? 1000 : Number(q.bankroll);
    if (aCentimos(bankroll) == null || bankroll > 1e9) {
      return reply.code(400).send({ error: 'banco inválido: un importe mayor que 0, con dos decimales como mucho', code: 'cartera.banco-invalido' });
    }
    if (q.moneda != null && q.moneda !== '' && !esMoneda(q.moneda)) {
      return reply.code(400).send({ error: 'moneda inválida: EUR, USD o GBP', code: 'cartera.moneda-invalida' });
    }
    // Sin moneda, ninguna apuesta personal se puede atribuir al banco: si hay alguna, los límites y
    // los topes quedan sin evaluar en vez de sumar monedas distintas.
    const moneda = esMoneda(q.moneda) ? q.moneda : null;
    const cfg = DEFAULT_CONFIG;

    const fixtures = listUpcoming() as unknown as {
      id: string;
      league: string;
      commence_time: string | null;
      home_name: string;
      away_name: string;
      home_id: string | null;
      away_id: string | null;
      odds_home: number | null;
      odds_draw: number | null;
      odds_away: number | null;
      source: string | null;
    }[];

    const demo = fixtures.filter((f) => f.source === DEMO_SOURCE).length;
    const candidates: BookCandidate[] = [];

    for (const f of fixtures) {
      // Las cuotas de demostración las genera el propio modelo: apostar contra la
      // propia salida no es una ventaja, es una identidad.
      if (f.source === DEMO_SOURCE) continue;
      if (
        !f.home_id ||
        !f.away_id ||
        f.odds_home == null ||
        f.odds_draw == null ||
        f.odds_away == null
      ) {
        continue;
      }
      let pred;
      try {
        pred = buildFootballPrediction(f.league as never, f.home_id, f.away_id);
      } catch {
        continue;
      }
      const best = bestSelection(
        [
          { label: f.home_name, p: pred.model.home, odds: f.odds_home, side: 'canonica' as const },
          { label: 'Empate', p: pred.model.draw, odds: f.odds_draw, side: 'otro' as const },
          { label: f.away_name, p: pred.model.away, odds: f.odds_away, side: 'contraria' as const },
        ],
        cfg,
      );
      if (!best) continue;
      candidates.push({
        key: f.id,
        label: `${f.home_name} vs ${f.away_name} — ${best.label}`,
        sport: 'football',
        league: f.league,
        day: (f.commence_time ?? 'sin-fecha').slice(0, 10),
        matchKey: f.id,
        market: '1x2',
        side: best.side,
        p: best.p,
        odds: best.odds,
      });
    }

    const now = new Date();
    const loss = lossState(bankroll, cfg, now, moneda);
    const book = decideBook(candidates, bankroll, cfg, undefined, now, moneda, { limites: loss });
    const abierto = exposicionPersonal(moneda);

    return {
      bankroll,
      moneda,
      contrato: CONTRATO_RIESGO,
      // Lo pendiente de este banco: lo seguro y lo más que puede ser (lo sin moneda indicada cuenta en la
      // cota de arriba). null: un importe ilegible, sin cota.
      exposicion: {
        segura: abierto.total.seguro / 100,
        maxima: Number.isFinite(abierto.total.maximo) ? abierto.total.maximo / 100 : null,
        apuestas: abierto.apuestas,
        incidencias: abierto.incidencias,
      },
      // Cuántas se miraron y cuántas quedaron fuera por no tener precio real. Sin esto,
      // una cartera vacía por falta de clave se lee igual que una cartera vacía porque
      // el modelo no encontró ventaja, y son dos situaciones muy distintas.
      considered: fixtures.length,
      demoOdds: demo,
      priced: candidates.length,
      limits: {
        maxPerEvent: cfg.maxPerEvent,
        maxTotalExposure: cfg.maxTotalExposure,
        maxExposurePerDay: cfg.maxExposurePerDay,
        maxExposurePerLeague: cfg.maxExposurePerLeague,
      },
      loss,
      entries: book.entries.filter((e) => e.stake > 0),
      blocked: book.entries.length - book.entries.filter((e) => e.stake > 0).length,
      naiveStake: book.naiveStake,
      totalStake: book.totalStake,
      aggregate: book.aggregate,
      links: book.links.slice(0, 8),
      // Lo ya en juego sin cota (un importe pendiente ilegible) va como null y con su marca: en JSON,
      // Infinity sería null a secas y la pantalla lo leería como 0 (revisión quant).
      caps: book.caps.map((c) => ({ ...c, used: Number.isFinite(c.used) ? c.used : null, sinCota: !Number.isFinite(c.used) })),
      notes: book.notes,
      // Lo medido va en la respuesta para que el panel pueda citar el número y no
      // repetirlo escrito a mano en el frontend, que es como acaban divergiendo.
      correlation: {
        sameMatch: MEASURED.sameMatch,
        sameLeagueDay: MEASURED.sameLeagueDay,
        used: SAME_LEAGUE_DAY_RHO,
        control: MEASURED.control.rho,
        n: MEASURED.n,
      },
    };
  });
}
