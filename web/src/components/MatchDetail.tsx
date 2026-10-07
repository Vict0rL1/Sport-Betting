import type { Prediction } from '../lib/api';
import { pct, surfaceLabelEs, formatDate } from '../lib/format';
import { P1_COLOR, P2_COLOR } from './ProbabilityBars';
import { ReliabilityBlock, FormBox, FitnessBlock, ServeCompare } from './MatchDetailPartes';
import { conNodos, useI18n } from '../i18n';

function Num({ value, plus = false }: { value: number; plus?: boolean }) {
  const sign = plus && value > 0 ? '+' : '';
  const color = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : 'text-(--ink-soft)';
  return (
    <span className={color}>
      {sign}
      {value}
    </span>
  );
}

/** Diverging bar for one reasoning factor: right = favours p1 (lime), left = p2 (sky). */
function FactorBar({ points, max }: { points: number; max: number }) {
  const frac = Math.max(-1, Math.min(1, points / max));
  const width = Math.abs(frac) * 50;
  return (
    <div className="relative h-3 w-full rounded bg-(--raised)">
      <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
      <div
        className="absolute top-0 h-full rounded"
        style={
          frac >= 0
            ? { left: '50%', width: `${width}%`, backgroundColor: P1_COLOR }
            : { right: '50%', width: `${width}%`, backgroundColor: P2_COLOR }
        }
      />
    </div>
  );
}


/** Signal-by-signal breakdown, all in Elo points so the math is transparent. */
export default function MatchDetail({ prediction }: { prediction: Prediction }) {
  const { ratings, form, h2h, adjustedRatings, players, surface, market, reasoning } = prediction;
  const { t, idioma } = useI18n();
  const surfLabel = surfaceLabelEs(surface, idioma);
  const maxFactor = Math.max(50, ...reasoning.factors.map((f) => Math.abs(f.pointsForP1)));
  // Most likely scoreline comes from the derived distribution — never a separate
  // heuristic, which could contradict the table right above it.
  const topOutcome = prediction.scorelines.outcomes[0];

  const rows: { label: string; p1: React.ReactNode; p2: React.ReactNode }[] = [
    { label: t('det.eloGeneral'), p1: ratings.p1.overall, p2: ratings.p2.overall },
    { label: t('det.eloSuperficie', { sup: surfLabel.toLowerCase() }), p1: ratings.p1.surface ?? '—', p2: ratings.p2.surface ?? '—' },
    { label: t('det.efectivo'), p1: ratings.p1.effective, p2: ratings.p2.effective },
    { label: t('det.ajusteForma'), p1: <Num value={form.p1.delta} plus />, p2: <Num value={form.p2.delta} plus /> },
    { label: t('det.ajusteH2h'), p1: <Num value={h2h.delta} plus />, p2: <Num value={-h2h.delta} plus /> },
    // Only shown when it bites: a zero row for every in-season match would be noise.
    ...(prediction.layoff.p1 !== 0 || prediction.layoff.p2 !== 0
      ? [
          {
            label: t('det.ajusteInactividad'),
            p1: <Num value={prediction.layoff.p1} plus />,
            p2: <Num value={prediction.layoff.p2} plus />,
          },
        ]
      : []),
    { label: t('det.ratingAjustado'), p1: <strong>{adjustedRatings.p1}</strong>, p2: <strong>{adjustedRatings.p2}</strong> },
    { label: t('det.probModelo'), p1: <strong>{pct(prediction.model.prob1, 1)}</strong>, p2: <strong>{pct(prediction.model.prob2, 1)}</strong> },
  ];

  return (
    <div className="mt-4 space-y-5 border-t border-(--line) pt-4 text-[16px]">
      {/* HOW SOLID — qualifies every number below it, so it goes first */}
      <ReliabilityBlock prediction={prediction} />

      {/* WHY — reasoning */}
      <div className="rounded-lg bg-(--raised) p-3">
        <div className="mb-2 text-[14px] uppercase tracking-wide text-(--ink-muted)">{t('det.porQue')}</div>
        <p className="mb-3 text-(--ink-body)">{reasoning.text}</p>
        <div className="space-y-2">
          {reasoning.factors.map((f) => (
            <div key={f.key} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-2">
              <span className="text-[14px] text-(--ink-soft)">{f.label}</span>
              <FactorBar points={f.pointsForP1} max={maxFactor} />
              <span className="text-right text-[14px] tabular-nums text-(--ink-body)">
                {f.pointsForP1 > 0 ? '+' : ''}
                {f.pointsForP1}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-(--ink-muted)">
          <span>◀ {t('det.ventaja', { nombre: players.p2.name })}</span>
          <span>{t('det.ventaja', { nombre: players.p1.name })} ▶</span>
        </div>
      </div>

      {/* Player headers with rank */}
      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
        <div className="text-(--ink-soft)">{t('det.senal')}</div>
        <div className="w-24 text-right font-semibold" style={{ color: P1_COLOR }}>
          {players.p1.name}
          <span className="ml-1 text-[14px] font-normal text-(--ink-muted)">#{prediction.ranks.p1}</span>
        </div>
        <div className="w-24 text-right font-semibold" style={{ color: P2_COLOR }}>
          {players.p2.name}
          <span className="ml-1 text-[14px] font-normal text-(--ink-muted)">#{prediction.ranks.p2}</span>
        </div>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[1fr_auto_auto] gap-2 -my-2">
          <div className="text-(--ink-soft)">{r.label}</div>
          <div className="w-24 text-right tabular-nums">{r.p1}</div>
          <div className="w-24 text-right tabular-nums">{r.p2}</div>
        </div>
      ))}

      {/* Form + surface record */}
      <div className="rounded-lg bg-(--raised) p-3">
        <div className="mb-2 text-[14px] uppercase tracking-wide text-(--ink-muted)">
          {t('det.formaReciente', { sup: surfLabel.toLowerCase() })}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormBox
            name={players.p1.name}
            color={P1_COLOR}
            f={form.p1}
            last5={prediction.last5.p1}
            rec={prediction.surfaceRecord.p1}
          />
          <FormBox
            name={players.p2.name}
            color={P2_COLOR}
            f={form.p2}
            last5={prediction.last5.p2}
            rec={prediction.surfaceRecord.p2}
          />
        </div>
      </div>

      {/* Serve / return stats */}
      <ServeCompare
        p1Name={players.p1.name}
        p2Name={players.p2.name}
        s1={prediction.serve.p1}
        s2={prediction.serve.p2}
      />

      {/* Head-to-head */}
      <div className="rounded-lg bg-(--raised) p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[14px] uppercase tracking-wide text-(--ink-muted)">Head-to-head</span>
          <span className="text-[16px]">
            <span style={{ color: P1_COLOR }}>{h2h.p1Wins}</span>
            <span className="text-(--ink-muted)"> – </span>
            <span style={{ color: P2_COLOR }}>{h2h.p2Wins}</span>
            <span className="ml-2 text-(--ink-muted)">{t('det.enfrentamientos', { n: h2h.total })}</span>
          </span>
        </div>
        {h2h.recent.length === 0 ? (
          <div className="text-(--ink-muted)">{t('det.sinEnfrentamientos')}</div>
        ) : (
          <ul className="space-y-1">
            {h2h.recent.map((m, i) => (
              <li key={i} className="flex items-center justify-between text-[14px] text-(--ink-body)">
                <span>
                  {formatDate(m.date)} · {m.tourney_name} ({surfaceLabelEs(m.surface, idioma)}) {m.round}
                </span>
                <span className="text-(--ink-soft)">
                  {conNodos(t('det.gano', { marcador: m.score ?? '' }), {
                    nombre: (
                      <span style={{ color: m.winnerId === players.p1.id ? P1_COLOR : P2_COLOR }}>
                        {m.winnerId === players.p1.id ? players.p1.name : players.p2.name}
                      </span>
                    ),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Scoreline distribution — real probabilities, not a single guess */}
      <div className="rounded-lg bg-(--raised) p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[14px] uppercase tracking-wide text-(--ink-muted)">
            {t('det.probMarcador')}
          </span>
          <span className="text-[11px] text-(--ink-muted)">
            {t('vivo.alMejorDe', { n: prediction.scorelines.bestOf })}
          </span>
        </div>
        <div className="space-y-1.5">
          {prediction.scorelines.outcomes.map((o) => (
            <div key={o.label} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2">
              <span className="break-words text-[14px] font-medium text-(--ink-body)" title={o.label}>
                {(o.side === 1 ? players.p1.name : players.p2.name).split(' ').slice(-1)[0]}{' '}
                {o.side === 1 ? o.label : o.label.split('-').reverse().join('-')}
              </span>
              <div className="h-3 overflow-hidden rounded bg-(--raised)">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.max(1, o.probability * 100 * 2.4)}%`,
                    backgroundColor: o.side === 1 ? P1_COLOR : P2_COLOR,
                  }}
                />
              </div>
              <span className="text-right text-[14px] tabular-nums text-(--ink-soft)">
                {pct(o.probability, 1)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 text-[14px] text-(--ink-soft)">
          <span>{t('det.setDecisivo', { p: pct(prediction.scorelines.decidingSetProbability, 1) })}</span>
          <span>{t('det.setsCorridos', { p: pct(prediction.scorelines.straightSetsProbability, 1) })}</span>
        </div>
      </div>

      {/* Tournament history */}
      {prediction.tournamentHistory &&
        (prediction.tournamentHistory.p1.played > 0 ||
          prediction.tournamentHistory.p2.played > 0) && (
          <div className="rounded-lg bg-(--raised) p-3">
            <div className="mb-2 text-[14px] uppercase tracking-wide text-(--ink-muted)">
              {t('det.historialTorneo')}
            </div>
            <div className="grid grid-cols-2 gap-4 text-[14px]">
              {(['p1', 'p2'] as const).map((k) => {
                const h = prediction.tournamentHistory![k];
                const name = players[k].name;
                return (
                  <div key={k}>
                    <div
                      className="mb-0.5 font-medium"
                      style={{ color: k === 'p1' ? P1_COLOR : P2_COLOR }}
                    >
                      {name}
                    </div>
                    {h.played === 0 ? (
                      <div className="text-(--ink-muted)">{t('det.nuncaAqui')}</div>
                    ) : (
                      <div className="text-(--ink-soft)">
                        {t('det.vd', { v: h.wins, d: h.losses })}
                        {h.titles > 0 && t(h.titles > 1 ? 'det.titulosN' : 'det.titulos1', { n: h.titles })}
                        {h.titles === 0 && h.bestRound && t('det.mejorRonda', { r: h.bestRound })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* Physical availability signals */}
      <FitnessBlock
        p1Name={players.p1.name}
        p2Name={players.p2.name}
        f1={prediction.fitness.p1}
        f2={prediction.fitness.p2}
      />

      {/* Market + expected score */}
      <div className="rounded-lg bg-(--raised) p-3 text-[14px]">
        <div className="mb-2 uppercase tracking-wide text-(--ink-muted)">{t('det.mercadoMarcador')}</div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-(--ink-body)">
          {market.market && (
            <>
              <span>{t('det.cuotas', { a: market.market.odds1, b: market.market.odds2 })}</span>
              <span>{t('det.implicita', { a: pct(market.market.implied1, 1), b: pct(market.market.implied2, 1) })}</span>
              <span>{t('det.overround', { p: pct(market.market.overround - 1, 1) })}</span>
              {market.edge1 != null && (
                <span>
                  {conNodos(t('det.ventajaModelo', { nombre: players.p1.name }), { valor: <Num value={Math.round(market.edge1 * 1000) / 10} plus /> })}
                </span>
              )}
            </>
          )}
          <span className="w-full text-(--ink-soft)">
            {conNodos(
              t('det.masProbable', {
                p: topOutcome ? pct(topOutcome.probability, 1) : '—',
                s: pct(prediction.scorelines.decidingSetProbability, 1),
              }),
              {
                marcador: (
                  <strong className="text-(--ink-body)">
                    {topOutcome
                      ? `${topOutcome.side === 1 ? players.p1.name : players.p2.name} ${
                          topOutcome.side === 1 ? topOutcome.label : topOutcome.label.split('-').reverse().join('-')
                        }`
                      : '—'}
                  </strong>
                ),
              },
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
