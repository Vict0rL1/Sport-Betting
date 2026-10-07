// Piezas de BasketballDashboard.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { useEffect, useState } from 'react';
import { bbApi, type BbMeta, type BbTrackRecord } from '../../lib/basketball';
import { CheckIcon, CrossIcon } from '../icons';

export function DataLine({ meta }: { meta: BbMeta }) {
  const when = meta.oddsRefreshedAt ?? meta.updatedAt;
  const whenTxt = when
    ? new Date(when).toLocaleString('es', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  return (
    <p className="mt-1 text-[14px] text-(--ink-muted)">
      {meta.counts.games} partidos · {meta.counts.teams} equipos · actualizado {whenTxt}
      {meta.hasOddsKey
        ? meta.autoRefreshMinutes > 0
          ? ` · auto cada ${Math.round(meta.autoRefreshMinutes / 60)}h`
          : ''
        : ' · configura ODDS_API_KEY para partidos y cuotas reales'}
    </p>
  );
}

/**
 * Ratings are only as current as the results behind them. In basketball this
 * matters even more than in tennis: a roster can change completely over one
 * summer, so a rating from a past season describes a team that no longer exists.
 */

/**
 * The app's own scorecard for basketball. Unlike tennis it can also report how far
 * off the predicted MARGIN was, which is the figure a handicap bet depends on.
 */
export function BbTrackRecordPanel({ league }: { league: string }) {
  const [data, setData] = useState<BbTrackRecord | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    bbApi
      .trackRecord(league)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [league]);

  if (!data || (data.resolved === 0 && data.pending === 0)) return null;
  const thin = data.resolved > 0 && data.resolved < 30;

  return (
    <div className="mt-3 rounded-lg border border-(--line) bg-(--raised) p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[16px]">
          <span className="text-[14px] uppercase tracking-wide text-(--ink-muted)">
            Aciertos reales de la app
          </span>
          <br />
          {data.resolved === 0 ? (
            <span className="text-(--ink-body)">
              {data.pending} predicción(es) registradas, esperando resultado.
            </span>
          ) : (
            <span className="text-(--ink-strong)">
              <strong className="tabular-nums">{((data.accuracy ?? 0) * 100).toFixed(1)}%</strong> de
              acierto en <strong className="tabular-nums">{data.resolved}</strong> partidos jugados
              {data.marginMae != null && (
                <span className="text-(--ink-soft)"> · error de margen {data.marginMae} pts</span>
              )}
              {thin && <span className="text-amber-400"> · muestra pequeña</span>}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[14px] text-(--ink-faint)">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4 border-t border-(--line) pt-3 text-[14px]">
          <p className="text-(--ink-soft)">
            Cada predicción se guarda <strong>antes</strong> del partido y se puntúa cuando llega el
            resultado real (al ejecutar{' '}
            <code className="rounded bg-(--tint) px-1">npm run update-data:bb</code>). No es el
            backtest histórico: son los partidos que viste aquí.
          </p>
          {data.resolved > 0 && (
            <div className="grid grid-cols-4 gap-x-4 gap-y-3 border-y border-(--line) py-3">
              <Cell label="Acierto" value={`${((data.accuracy ?? 0) * 100).toFixed(1)}%`} />
              <Cell label="Brier" value={data.brier?.toFixed(4) ?? '—'} />
              <Cell label="Error margen" value={data.marginMae != null ? `${data.marginMae} pts` : '—'} />
              <Cell
                label="Sesgo margen"
                value={
                  data.marginBias != null
                    ? `${data.marginBias > 0 ? '+' : ''}${data.marginBias}`
                    : '—'
                }
                hint="+ = sobreestima al local"
              />
            </div>
          )}
          {data.vsMarket && (
            <div>
              <div className="mb-1 uppercase tracking-wide text-(--ink-muted)">
                Modelo vs mercado ({data.vsMarket.n} partidos con cuotas)
              </div>
              <table className="w-full text-left tabular-nums">
                <thead className="text-(--ink-muted)">
                  <tr>
                    <th className="py-1 font-normal">&nbsp;</th>
                    <th className="py-1 font-normal">Acierto</th>
                    <th className="py-1 font-normal">Brier</th>
                  </tr>
                </thead>
                <tbody className="text-(--ink-body)">
                  <tr>
                    <td className="py-1 text-(--ink-soft)">Modelo</td>
                    <td>{fmtPct(data.vsMarket.modelAccuracy)}</td>
                    <td>{data.vsMarket.modelBrier?.toFixed(4) ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-(--ink-soft)">Mercado</td>
                    <td>{fmtPct(data.vsMarket.marketAccuracy)}</td>
                    <td>{data.vsMarket.marketBrier?.toFixed(4) ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {data.recent.length > 0 && (
            <div>
              <div className="mb-1 uppercase tracking-wide text-(--ink-muted)">Últimas resueltas</div>
              <ul className="space-y-1">
                {data.recent.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`mt-[3px] inline-flex ${r.hit ? 'text-emerald-400' : 'text-rose-400'}`} aria-label={r.hit ? 'acertó' : 'falló'}>
                      {r.hit ? <CheckIcon size={15} strokeWidth={2.4} /> : <CrossIcon size={15} strokeWidth={2.4} />}
                    </span>
                    <span className="text-(--ink-body)">
                      {r.away} @ {r.home}
                      <span className="text-(--ink-muted)">
                        {' '}
                        — dijo {fmtPct(Math.max(r.probHome, 1 - r.probHome))} para{' '}
                        {r.probHome >= 0.5 ? r.home : r.away}; acabó {r.awayPts}–{r.homePts}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-(--ink-muted)">{label}</div>
      <div className="tabular-nums text-(--ink-strong)">{value}</div>
      {hint && <div className="text-[11px] text-(--ink-faint)">{hint}</div>}
    </div>
  );
}

export function fmtPct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}
