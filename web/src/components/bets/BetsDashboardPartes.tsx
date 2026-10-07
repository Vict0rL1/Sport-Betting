// Piezas de BetsDashboard.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { ClvPropio, Etiquetas, LoHabriaApostado } from './ExtrasApuesta';
import { useState } from 'react';
import { MARKET_LABEL, money, pctSigned, signed, SPORT_LABEL, STATUS_LABEL, type Bet, type BetStatus, type BetSummary } from '../../lib/bets';
import { BREAK_EVEN_COLOR, LOSS_COLOR, PROFIT_COLOR } from '../../lib/theme';
import { Card, SectionTitle } from '../ui';

export function Headline({ summary }: { summary: BetSummary }) {
  const t = summary.totals;
  const tone = t.profit > 0 ? PROFIT_COLOR : t.profit < 0 ? LOSS_COLOR : BREAK_EVEN_COLOR;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-(--ink-muted)">
            Beneficio
          </span>
          <span className="block text-[26px] font-bold leading-none tabular-nums" style={{ color: tone }}>
            {signed(t.profit)}
          </span>
        </div>
        <div className="text-right">
          <span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-(--ink-muted)">
            ROI
          </span>
          <span className="block text-[26px] font-bold leading-none tabular-nums" style={{ color: tone }}>
            {t.roi == null ? '—' : pctSigned(t.roi)}
          </span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-(--line) pt-3 sm:grid-cols-4">
        <Stat label="Apostado" value={money(t.staked)} hint={`${t.bets} apuesta${t.bets === 1 ? '' : 's'}`} />
        <Stat
          label="Acierto"
          value={t.hitRate == null ? '—' : `${(t.hitRate * 100).toFixed(0)}%`}
          hint={`${t.wins}-${t.losses}`}
        />
        <Stat
          label="Pendientes"
          value={String(summary.pending.bets)}
          hint={summary.pending.bets ? `${money(summary.pending.staked)} en juego` : 'nada en juego'}
        />
        <Stat
          label="Rachas"
          value={`${summary.longestWinStreak}W / ${summary.longestLoseStreak}L`}
          hint="la mejor y la peor"
        />
      </div>
      {/* ROI is over stake AT RISK, and saying so matters: a run of voids would
          otherwise look like it had quietly dragged the number down. */}
      <p className="mt-2 text-[11px] leading-relaxed text-(--ink-muted)">
        El ROI se calcula sobre lo que estuvo realmente en riesgo ({money(t.risked)}), así que las
        anuladas no lo diluyen. Las pendientes no cuentan hasta que se resuelven.
      </p>
    </>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-(--ink-muted)">{label}</div>
      <div className="mt-0.5 text-[16px] font-semibold tabular-nums text-(--ink-strong)">{value}</div>
      {hint && <div className="text-[11px] tabular-nums text-(--ink-muted)">{hint}</div>}
    </div>
  );
}

/**
 * Did following the model help?
 *
 * The one thing this log can say that a bookmaker's own history cannot. Withheld
 * below ten answerable bets by the server, because a split over four bets is noise
 * with a headline on it.
 */
export function ModelAgreement({ summary }: { summary: BetSummary }) {
  const a = summary.modelAgreement!;
  const row = (g: typeof a.with, label: string) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[14px] text-(--ink-soft)">
        {label} <span className="text-(--ink-faint)">· {g.bets} apuestas</span>
      </span>
      <span
        className="text-[16px] font-semibold tabular-nums"
        style={{ color: g.profit > 0 ? PROFIT_COLOR : g.profit < 0 ? LOSS_COLOR : BREAK_EVEN_COLOR }}
      >
        {signed(g.profit)}
        <span className="ml-2 text-[13px] font-normal text-(--ink-muted)">
          {g.roi == null ? '' : pctSigned(g.roi)}
        </span>
      </span>
    </div>
  );
  return (
    <Card className="p-4">
      <SectionTitle right="donde discrepaban">¿Te sirvió seguir al modelo?</SectionTitle>
      {row(a.with, 'Cuando fuiste CON el modelo')}
      {row(a.against, 'Cuando fuiste CONTRA el modelo')}
      <p className="mt-2 text-[11px] leading-relaxed text-(--ink-muted)">
        Solo entran las apuestas que elegiste desde un partido de la app y en las que el modelo se
        separaba al menos 2 puntos del mercado. Con pocas apuestas esto es ruido: míralo como una
        tendencia a los meses, no como un veredicto.
      </p>
    </Card>
  );
}

export function Breakdown({ summary }: { summary: BetSummary }) {
  const group = (
    title: string,
    rows: BetSummary['bySport'],
    label: (k: string) => string,
  ) => (
    <div className="min-w-0 flex-1">
      <SectionTitle>{title}</SectionTitle>
      <div className="space-y-1">
        {rows.map((g) => (
          <div key={g.key} className="flex items-baseline justify-between gap-3">
            <span className="break-words text-[14px] text-(--ink-soft)">
              {label(g.key)} <span className="text-(--ink-faint)">{g.bets}</span>
            </span>
            <span
              className="shrink-0 text-[14px] font-semibold tabular-nums"
              style={{ color: g.profit > 0 ? PROFIT_COLOR : g.profit < 0 ? LOSS_COLOR : BREAK_EVEN_COLOR }}
            >
              {signed(g.profit)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
        {summary.bySport.length > 1 && group('Por deporte', summary.bySport, (k) => SPORT_LABEL[k] ?? k)}
        {summary.byMarket.length > 1 && group('Por mercado', summary.byMarket, (k) => MARKET_LABEL[k] ?? k)}
      </div>
    </Card>
  );
}

export function DayTotal({ bets }: { bets: Bet[] }) {
  const settled = bets.filter((b) => b.profit != null);
  if (settled.length === 0) return <span className="text-[13px] text-(--ink-muted)">sin resolver</span>;
  const net = settled.reduce((s, b) => s + (b.profit as number), 0);
  return (
    <span
      className="text-[13px] font-semibold tabular-nums"
      style={{ color: net > 0 ? PROFIT_COLOR : net < 0 ? LOSS_COLOR : BREAK_EVEN_COLOR }}
    >
      {signed(net)}
    </span>
  );
}

export const SETTLE_OPTIONS: BetStatus[] = ['won', 'lost', 'void', 'half_won', 'half_lost', 'cashout'];

export function BetRow({
  bet,
  minEdge,
  onSettle,
  onEdit,
  onDelete,
}: {
  bet: Bet;
  minEdge: number | null;
  onSettle: (b: Bet, s: BetStatus) => void;
  onEdit: (b: Bet) => void;
  onDelete: (b: Bet) => void;
}) {
  const [open, setOpen] = useState(false);
  const tone =
    bet.profit == null
      ? BREAK_EVEN_COLOR
      : bet.profit > 0
        ? PROFIT_COLOR
        : bet.profit < 0
          ? LOSS_COLOR
          : BREAK_EVEN_COLOR;

  return (
    <Card className="p-3">
      {/* A 3px bar on the left carries win/loss redundantly with the number, so the
          list scans without relying on reading each figure. */}
      <div className="flex gap-3">
        <span
          aria-hidden
          className="w-[3px] shrink-0 self-stretch rounded-full"
          style={{ backgroundColor: bet.profit == null ? 'var(--line-strong)' : tone }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="break-words text-[16px] font-semibold leading-tight text-(--ink-strong)">
                {bet.selection}
              </div>
              <div className="mt-0.5 break-words text-[13px] text-(--ink-soft)">{bet.event}</div>
              <div className="mt-0.5 text-[11px] uppercase tracking-[0.06em] text-(--ink-faint)">
                {SPORT_LABEL[bet.sport] ?? bet.sport} · {MARKET_LABEL[bet.market] ?? bet.market}
                {bet.withModel != null && (
                  <span style={{ color: bet.withModel ? PROFIT_COLOR : LOSS_COLOR }}>
                    {' '}
                    · {bet.withModel ? 'con el modelo' : 'contra el modelo'}
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[16px] font-semibold tabular-nums" style={{ color: tone }}>
                {bet.profit == null ? STATUS_LABEL[bet.status] : signed(bet.profit)}
              </div>
              <div className="text-[13px] tabular-nums text-(--ink-muted)">
                {money(bet.stake)} @ {bet.odds}
              </div>
            </div>
          </div>

          {bet.status === 'pending' ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SETTLE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSettle(bet, s)}
                  className="rounded-md px-2.5 py-1 text-[13px] text-(--ink-body) ring-1 ring-inset ring-(--line) transition hover:bg-(--raised-2) hover:text-(--ink-strong)"
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-1.5 flex items-center gap-3 text-[13px]">
              <span className="text-(--ink-muted)">{STATUS_LABEL[bet.status]}</span>
              <button onClick={() => setOpen((o) => !o)} className="text-(--ink-soft) hover:text-(--ink-strong)">
                {open ? 'menos' : 'más'}
              </button>
            </div>
          )}

          {(open || bet.status === 'pending') && (
            <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-(--line) pt-2 text-[13px]">
              {bet.model_prob != null && (
                <span className="text-(--ink-muted)">
                  modelo {(bet.model_prob * 100).toFixed(0)}%
                  {bet.market_prob != null && ` · mercado ${(bet.market_prob * 100).toFixed(0)}%`}
                </span>
              )}
              {bet.notes && <span className="text-(--ink-soft)">{bet.notes}</span>}
              <Etiquetas tags={bet.tags} />
              <LoHabriaApostado bet={bet} minEdge={minEdge} />
              {open && <ClvPropio id={bet.id} />}
              <button onClick={() => onEdit(bet)} className="text-(--ink-soft) hover:text-(--ink-strong)">
                Editar
              </button>
              <button onClick={() => onDelete(bet)} className="text-(--ink-soft) hover:text-[#d95926]">
                Borrar
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
