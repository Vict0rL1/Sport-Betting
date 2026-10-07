// Lo que la fila de una apuesta propia añade al abrirla (Fase 5.16): el CLV cuando hay
// snapshot que casar, «¿la habría apostado el modelo?» con la ventaja mínima de la política,
// y las etiquetas.
import { useEffect, useState } from 'react';
import { PROFIT_COLOR, LOSS_COLOR } from '../../lib/theme';
import type { Bet } from '../../lib/bets';

interface Clv { clv: number | null; cierre: number | null; casas: number | null; motivo: string | null }

const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')} %`;

export function Etiquetas({ tags }: { tags: string[] }) {
  if (!tags?.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded-full px-2 py-0.5 text-[11px] text-(--ink-soft) ring-1 ring-(--line)">{t}</span>
      ))}
    </span>
  );
}

export function LoHabriaApostado({ bet, minEdge }: { bet: Bet; minEdge: number | null }) {
  if (bet.model_prob == null || minEdge == null) return null;
  const ventaja = bet.model_prob * bet.odds - 1;
  const si = ventaja >= minEdge;
  return (
    <span className="text-(--ink-soft)" title="Con la probabilidad del modelo guardada en la apuesta y la ventaja mínima de la política vigente.">
      ¿La habría apostado el modelo?{' '}
      <strong style={{ color: si ? PROFIT_COLOR : LOSS_COLOR }}>{si ? 'sí' : 'no'}</strong> (ventaja {pct(ventaja)}, mínimo {pct(minEdge)})
    </span>
  );
}

export function ClvPropio({ id }: { id: number }) {
  const [c, setC] = useState<Clv | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/bets/${id}/clv`).then((r) => (r.ok ? r.json() : null)).then((j) => vivo && setC(j)).catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [id]);
  if (!c) return null;
  if (c.clv == null) return <span className="text-(--ink-muted)" title={c.motivo ?? undefined}>CLV: sin cierre ({c.motivo})</span>;
  return (
    <span className="text-(--ink-soft)">
      CLV <strong style={{ color: c.clv >= 0 ? PROFIT_COLOR : LOSS_COLOR }}>{pct(c.clv)}</strong> contra el cierre {c.cierre?.toFixed(2)} ({c.casas} casas)
    </span>
  );
}

export function Sugerencia({ odds, prob }: { odds: number; prob: number | null }) {
  const [s, setS] = useState<{ fraccion: number; importe: number | null; nota: string; bancoPersonal: number | null } | null>(null);
  useEffect(() => {
    if (!(odds > 1) || prob == null || !(prob > 0 && prob < 1)) {
      setS(null);
      return;
    }
    let vivo = true;
    fetch(`/api/bets/sugerencia?odds=${odds}&prob=${prob}`).then((r) => (r.ok ? r.json() : null)).then((j) => vivo && setS(j)).catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [odds, prob]);
  if (!s) return null;
  return (
    <p className="text-[13px] text-(--ink-soft)" role="status">
      Sugerencia de la política: <strong className="text-(--ink-strong)">{(s.fraccion * 100).toFixed(2).replace('.', ',')} % del banco</strong>
      {s.importe != null ? ` (${s.importe.toFixed(2)} de ${s.bancoPersonal})` : ' (fija tu banco personal en Ajustes para ver el importe)'}. {s.nota}
    </p>
  );
}
