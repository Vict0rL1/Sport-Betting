// Piezas de FootballDashboard.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { useEffect, useState } from 'react';
import { fbApi } from '../../lib/football';

export function TrackRecordPanel({ league }: { league: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fbApi.trackRecord>> | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    fbApi
      .trackRecord(league)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [league]);

  if (!data || (data.resolved === 0 && data.pending === 0)) return null;

  return (
    <div className="mb-4 rounded-lg border border-(--line) bg-(--raised) p-3">
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
              RPS <strong className="tabular-nums">{data.rps}</strong> en{' '}
              <strong className="tabular-nums">{data.resolved}</strong> partidos
              <span className="text-(--ink-soft)">
                {' '}
                · acertó el resultado en {((data.accuracy ?? 0) * 100).toFixed(1)}%
              </span>
            </span>
          )}
        </span>
        <span className="shrink-0 text-[14px] text-(--ink-faint)">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-(--line) pt-3 text-[14px] text-(--ink-body)">
          <p className="text-(--ink-soft)">
            El <strong>RPS</strong> (Ranked Probability Score) es la medida correcta para un 1X2:
            penaliza menos equivocarse por un escalón (decir «local» y salir empate) que por dos.
            Menor es mejor.
          </p>
          {data.draws && (
            <p>
              Empates: el modelo los eligió como resultado más probable en{' '}
              <strong>{data.draws.predicted}</strong> partidos y hubo{' '}
              <strong>{data.draws.actual}</strong>; probabilidad media asignada al empate{' '}
              <strong>{((data.draws.meanProbability ?? 0) * 100).toFixed(1)}%</strong>.
            </p>
          )}
          {data.vsMarket && (
            <p>
              Contra el mercado en {data.vsMarket.n} partidos: modelo RPS{' '}
              <strong>{data.vsMarket.modelRps}</strong> vs mercado{' '}
              <strong>{data.vsMarket.marketRps}</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
