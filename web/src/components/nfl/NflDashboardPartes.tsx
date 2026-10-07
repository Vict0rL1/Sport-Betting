// Piezas de NflDashboard.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { useEffect, useState } from 'react';
import { nflApi, type NflMeta, type NflTrackRecord } from '../../lib/nfl';

export function DataLine({ meta }: { meta: NflMeta }) {
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-(--ink-muted)">
      <span className="mr-1 rounded-full px-2 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
        datos reales (nflverse)
      </span>
      {meta.counts.games.toLocaleString('es')} partidos · {meta.counts.teams} equipos ·{' '}
      {/* The two tracked league quantities. Worth a line of chrome: they are the
          model's own reading of how the sport is being played this year. */}
      <span className="text-(--ink-soft)">
        ventaja de campo {meta.league.homeAdvantagePoints} pts · {meta.league.pointsPerGame} puntos
        por partido
      </span>
      {!meta.hasOddsKey && ' · configura ODDS_API_KEY para cuotas reales'}
    </p>
  );
}

/**
 * The staleness warning, counted in SEASONS.
 *
 * The other tabs warn in months. Here that would fire every summer on a
 * perfectly current archive: the NFL simply does not play between February and
 * September, so "the history ends five months ago" in July means nothing is
 * missing at all.
 */

/**
 * The track record.
 *
 * The one panel in the app that can put the model and the market side by side on
 * the SAME games the app actually showed you, because this is the only sport
 * where the market's number is recorded at the moment of the call.
 */
export function NflTrackRecordPanel({ league }: { league: string }) {
  const [data, setData] = useState<NflTrackRecord | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    nflApi
      .trackRecord(league)
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [league]);

  if (!data || (data.resolved === 0 && data.pending === 0)) return null;

  return (
    <div className="mt-3 rounded-xl border border-(--line) bg-(--tint) p-3">
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
              acierto en <strong className="tabular-nums">{data.resolved}</strong> partidos
              {data.marginMae != null && (
                <span className="text-(--ink-soft)"> · error del margen {data.marginMae} pts</span>
              )}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[14px] text-(--ink-faint)">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-(--line) pt-3 text-[14px] text-(--ink-body)">
          {data.vsMarket && (
            <p>
              <strong>Contra el mercado</strong>, en los {data.vsMarket.n} partidos donde había
              cuotas cuando se hizo la predicción: el modelo acertó el{' '}
              {((data.vsMarket.modelAccuracy ?? 0) * 100).toFixed(1)}% y el mercado el{' '}
              {((data.vsMarket.marketAccuracy ?? 0) * 100).toFixed(1)}% (Brier{' '}
              {data.vsMarket.modelBrier} frente a {data.vsMarket.marketBrier}; menor es mejor).
            </p>
          )}
          <p className="text-(--ink-soft)">
            La línea de cierre de la NFL es el precio más afinado del deporte. En 27 temporadas de
            histórico el modelo no la bate — acierta el 50.9% contra el hándicap, por debajo del
            52.4% que hace falta solo para cubrir la comisión. Esto se dice aquí, y no en letra
            pequeña, porque es lo que hay.
          </p>
          {data.calibration.length > 0 && (
            <div>
              <div className="mb-1 text-(--ink-muted)">Calibración del favorito:</div>
              <ul className="space-y-0.5">
                {data.calibration.map((c) => (
                  <li key={c.label} className="tabular-nums">
                    {c.label}: dijo {(c.predicted * 100).toFixed(0)}%, salió{' '}
                    {(c.observed * 100).toFixed(0)}% ({c.n} partidos)
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
