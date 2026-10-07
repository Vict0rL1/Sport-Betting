// Piezas compartidas de la interfaz: days. Partido de ui/index.tsx en la Fase 5 (ningún import cambia: index.tsx reexporta).
import type { ReactNode } from 'react';
import { LOSS_COLOR, PROFIT_COLOR } from '../../lib/theme';
import { relativeTime, shortTime } from '../../lib/format';
import { CheckIcon, CrossIcon } from '../icons';
import { pillClass } from './states';
/**
 * The heading above one day's matches.
 *
 * Sticky, and just under the app's own sticky header — so however far you scroll
 * into a three-week schedule, the day you are looking at is still named. That is
 * the whole reason to group at all: without it, a card in the middle of the list
 * has to carry its own date, and thirty cards each stating their date is thirty
 * copies of information that changes four times.
 */
export function DayHeading({
  label,
  count,
  right,
}: {
  label: string;
  count?: number;
  right?: ReactNode;
}) {
  return (
    // The offset is the app header's MEASURED height, published as --header-h by
    // App. It used to be a hardcoded 86px, which was right until the type scale
    // grew and then silently let the heading slide under the tab bar. A magic
    // number that encodes the size of something else goes stale the moment that
    // something else changes; the fallback only covers the first paint.
    <div
      className="sticky z-20 -mx-1 mb-3 flex items-baseline justify-between gap-3 bg-[#0b0d11]/90 px-1 py-1.5 backdrop-blur-sm"
      style={{ top: 'var(--header-h, 96px)' }}
    >
      <h3 className="text-[15px] font-semibold text-[#e8eaed]">
        {label}
        {count != null && <span className="ml-2 text-[13px] font-normal text-[#7b828d]">{count}</span>}
      </h3>
      {right && <span className="text-[13px] text-[#7b828d]">{right}</span>}
    </div>
  );
}

/**
 * The day strip: a chip per day that has matches.
 *
 * This is the "calendar" — and deliberately not a month grid. A month grid is
 * mostly empty squares: the odds feed only knows about the next week or two, and
 * a schedule knows about a season but with nothing to say about most of it. A
 * strip of only the days that HAVE something shows the same information with no
 * blank space, scrolls with a thumb, and cannot mislead you into tapping a
 * Tuesday that was never going to have games.
 *
 * `null` selects every day, which is the default: a reader who has not asked to
 * filter should see everything.
 */
export function DayFilter({
  days,
  selected,
  onSelect,
}: {
  days: { key: string; label: string; count: number }[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  if (days.length < 2) return null;
  const total = days.reduce((a, d) => a + d.count, 0);
  return (
    <div
      className="mb-4 flex gap-2 overflow-x-auto pb-1"
      role="tablist"
      aria-label="Filtrar por día"
    >
      <button
        role="tab"
        aria-selected={selected === null}
        onClick={() => onSelect(null)}
        className={pillClass(selected === null)}
      >
        Todos
        <span className="ml-1.5 opacity-60">{total}</span>
      </button>
      {days.map((d) => (
        <button
          key={d.key}
          role="tab"
          aria-selected={selected === d.key}
          onClick={() => onSelect(selected === d.key ? null : d.key)}
          className={pillClass(selected === d.key)}
        >
          {d.label}
          <span className="ml-1.5 opacity-60">{d.count}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The time on a card: the clock, and how far away it is.
 *
 * "20:20" answers where in the day, "en 3 días" answers whether it matters yet.
 * Both in the reader's own time zone.
 */
export function MatchTime({ iso, extra }: { iso: string; extra?: ReactNode }) {
  return (
    <time dateTime={iso} className="tabular-nums">
      {shortTime(iso)}
      <span className="ml-1.5 text-[#5c636c]">{relativeTime(iso)}</span>
      {extra}
    </time>
  );
}

/**
 * The final score of a match that has already been played.
 *
 * WHY A CARD SHOWS THIS AT ALL. The schedule now keeps today's matches until
 * midnight instead of dropping them six hours after kick-off, so a game played
 * this morning is still on screen this afternoon — and the one thing you want from
 * it then is how it ended, not a forecast for something that already happened.
 *
 * THREE STATES, and conflating any two of them is a lie:
 *   · finished with a score  → show it, and whether the model called it
 *   · started, no score yet  → "en juego o sin resultado todavía". Scores arrive
 *     with `update-data`, so this is normal for a while and is NOT the model
 *     being wrong or the match not existing.
 *   · not started            → render nothing; the forecast below is the content.
 *
 * The verdict wears a word ("acertó" / "falló"), never colour alone.
 */
export function ResultBanner({
  started,
  score,
  detail,
  modelCalledIt,
}: {
  started: boolean;
  /** "24-17", or "Sinner" for a sport without two scores. Null when unknown. */
  score: string | null;
  detail?: string | null;
  /** Did the model favour the winner? null when there was no forecast to check. */
  modelCalledIt?: boolean | null;
}) {
  if (!started) return null;

  if (score == null) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-[14px] text-[#9aa1ac] ring-1 ring-inset ring-white/[0.08]">
        <span aria-hidden>⏳</span>
        <span>En juego, o el resultado aún no está descargado.</span>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-lg bg-white/[0.06] px-3 py-2 ring-1 ring-inset ring-white/[0.12]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#7b828d]">
            Final
          </span>
          <strong className="text-[20px] font-bold leading-none tabular-nums text-[#e8eaed]">
            {score}
          </strong>
        </span>
        {modelCalledIt != null && (
          <span
            className="text-[13px] font-medium"
            style={{ color: modelCalledIt ? PROFIT_COLOR : LOSS_COLOR }}
          >
            <span className="inline-flex items-center gap-1">
              {modelCalledIt ? <CheckIcon size={14} strokeWidth={2.4} /> : <CrossIcon size={14} strokeWidth={2.4} />}
              {modelCalledIt ? 'el modelo acertó' : 'el modelo falló'}
            </span>
          </span>
        )}
      </div>
      {detail && <div className="mt-0.5 text-[13px] text-[#9aa1ac]">{detail}</div>}
    </div>
  );
}
