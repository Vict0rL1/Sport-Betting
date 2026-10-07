// Piezas compartidas de la interfaz: cards. Partido de ui/index.tsx en la Fase 5 (ningún import cambia: index.tsx reexporta).
import type { ReactNode } from 'react';
import { INK } from '../../lib/theme';
import { SeriesDot } from './marks';
// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------
// ONE surface level, ONE radius.
//
// The card used to be a box (rounded-2xl, border, inset highlight, drop shadow)
// holding panels that were boxes (rounded-xl, fill, inset ring) holding stat tiles
// that were boxes (rounded-xl, fill, inset ring). Three nested rectangles, each
// with its own edge, around numbers that a rule and some space would have grouped
// just as clearly. Every edge is ink the reader has to look past to reach the data.
//
// So: the card is the only filled box on the page. Inside it, sections are
// separated by a hairline and whitespace — which is what a printed table does.

/**
 * The one box. Everything inside it is flat.
 *
 * The only motion in the app is here: the edge brightens a little on hover. Not
 * a lift, not a shadow, not a scale — a card is a sheet of information, and
 * animating it as a button would be a promise the card does not keep. What the
 * brightening does say is "this row is the one you are reading", which on a page
 * of eight near-identical cards is worth one CSS transition.
 */
export function Card({
  children,
  className = '',
  as: As = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section';
}) {
  return (
    <As
      className={`rounded-xl border border-white/[0.07] bg-[#14161b] transition-colors duration-200 hover:border-white/[0.13] ${className}`}
    >
      {children}
    </As>
  );
}

/**
 * A section INSIDE a card.
 *
 * A rule above and space below — no fill, no ring, no radius. Stacked sections
 * read as one sheet divided into parts, instead of a pile of trays.
 */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`border-t border-white/[0.07] pt-3 ${className}`}>{children}</section>
  );
}

/** Section heading. Small, uppercase, recessive — it labels, it does not compete. */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7b828d]">
        {children}
      </h4>
      {right && <span className="text-[13px] text-[#7b828d]">{right}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------
/**
 * The headline number of a card.
 *
 * The value is INK, never the series colour — a 28px probability in
 * full-saturation blue next to another in full-saturation orange is a lot of
 * shouting for two figures that are simply "the answer", and a saturated hue is
 * harder to read at that weight than plain light grey. The colour still appears,
 * as a 6px dot in front of the label: enough to say WHICH side this is, which is
 * all the colour was ever needed for. The bar underneath carries the same two
 * colours at the size where they actually do work.
 *
 * Deliberately not a chart: one probability with a label is a figure, and turning
 * it into a donut would add ink without adding information.
 */
export function HeroStat({
  value,
  label,
  sub,
  color,
  align = 'left',
  size = 'lg',
}: {
  value: string;
  label: string;
  sub?: string;
  color: string;
  align?: 'left' | 'center' | 'right';
  size?: 'lg' | 'sm';
}) {
  const box = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
  const row =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <div className={box}>
      {/* The dot sits on the outside edge: leading on the left column, trailing on
          the right one, so the two labels mirror instead of both pointing left. */}
      <div className={`flex items-center gap-1.5 ${row}`}>
        {align !== 'right' && <SeriesDot color={color} />}
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7b828d]">
          {label}
        </span>
        {align === 'right' && <SeriesDot color={color} />}
      </div>
      <div
        className={`mt-1 font-bold leading-none tabular-nums ${size === 'lg' ? 'text-[26px]' : 'text-[20px]'}`}
        style={{ color: INK.primary }}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[13px] tabular-nums text-[#9aa1ac]">{sub}</div>}
    </div>
  );
}

/**
 * The row that holds a card's secondary figures.
 *
 * One pair of hairlines around the whole group instead of a rounded box around
 * each figure: four boxes said "four things", when what the reader needs is "one
 * group of four".
 */
export function StatRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid grid-cols-2 gap-x-4 gap-y-3 border-y border-white/[0.07] py-3 sm:grid-cols-4 ${className}`}
    >
      {children}
    </div>
  );
}

/** A small figure inside a StatRow. Value in ink, never in a series colour. */
export function StatTile({
  label,
  value,
  hint,
  title,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-[#7b828d]">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[16px] font-semibold tabular-nums text-[#e8eaed]">{value}</div>
      {hint != null && <div className="truncate text-[11px] tabular-nums text-[#7b828d]">{hint}</div>}
    </div>
  );
}
