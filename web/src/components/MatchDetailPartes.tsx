// Piezas de MatchDetail.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { type FitnessSignals, type Prediction, type ServeStats } from '../lib/api';
import { pct } from '../lib/format';
import { P1_COLOR, P2_COLOR } from './ProbabilityBars';

export function Last5({ results, color }: { results: boolean[]; color: string }) {
  if (results.length === 0) return <span className="text-(--ink-muted)">—</span>;
  return (
    <span className="inline-flex gap-1">
      {results.map((w, i) => (
        <span
          key={i}
          title={w ? 'Victoria' : 'Derrota'}
          className="inline-flex h-4 w-4 items-center justify-center rounded text-[11px] font-bold"
          style={{
            backgroundColor: w ? color : 'transparent',
            color: w ? '#0a0f1e' : '#f87171',
            border: w ? 'none' : '1px solid #f87171',
          }}
        >
          {w ? 'V' : 'D'}
        </span>
      ))}
    </span>
  );
}

/**
 * How much evidence sits behind the probability, as a range plus the reasons it
 * isn't tighter. Placed at the top of the breakdown because it qualifies every
 * figure below: the same 62% means different things with 800 matches of history
 * than with 8.
 */
export function ReliabilityBlock({ prediction }: { prediction: Prediction }) {
  const rel = prediction.reliability;
  const { p1, p2 } = prediction.players;
  // Express the range from the favourite's side — that's the number the user
  // reads off the card, so the band has to qualify the same quantity.
  const favIsP1 = prediction.model.prob1 >= 0.5;
  const favProb = favIsP1 ? prediction.model.prob1 : prediction.model.prob2;
  const favName = favIsP1 ? p1.name : p2.name;
  const lo = Math.max(0, favProb - rel.marginPp / 100);
  const hi = Math.min(1, favProb + rel.marginPp / 100);

  const tone =
    rel.level === 'high'
      ? 'border-emerald-700/50 bg-emerald-950/30'
      : rel.level === 'medium'
        ? 'border-amber-700/50 bg-amber-950/30'
        : 'border-rose-700/50 bg-rose-950/30';

  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="mb-2 text-[14px] uppercase tracking-wide text-(--ink-muted)">
        Cuánta confianza merece este número
      </div>
      <p className="text-(--ink-body)">
        <strong className="capitalize">{rel.label}</strong> — {favName} entre{' '}
        <strong className="tabular-nums">{pct(lo, 1)}</strong> y{' '}
        <strong className="tabular-nums">{pct(hi, 1)}</strong>{' '}
        <span className="text-(--ink-soft)">(±{rel.marginPp} pp)</span>
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[14px]">
        <div className="min-w-0">
          <div className="break-words text-(--ink-soft)" title={p1.name}>
            {p1.name}
          </div>
          <div className="tabular-nums text-(--ink-body)">
            {rel.effectiveMatches.p1} partidos efectivos
          </div>
        </div>
        <div className="min-w-0">
          <div className="break-words text-(--ink-soft)" title={p2.name}>
            {p2.name}
          </div>
          <div className="tabular-nums text-(--ink-body)">
            {rel.effectiveMatches.p2} partidos efectivos
          </div>
        </div>
      </div>
      {rel.reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rel.reasons.map((r, i) => (
            <li key={i} className="flex gap-2 text-[14px] text-(--ink-body)">
              <span className="text-(--ink-faint)">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[14px] text-(--ink-muted)">
        «Partidos efectivos» pondera el historial igual que el Elo del partido: 70% los partidos en
        esta superficie, 30% el total. Menos partidos (o datos antiguos) ⇒ banda más ancha.
      </p>
    </div>
  );
}

export function FormBox({
  name,
  color,
  f,
  last5,
  rec,
}: {
  name: string;
  color: string;
  f: Prediction['form']['p1'];
  last5: boolean[];
  rec: { wins: number; losses: number };
}) {
  const streakTxt =
    f.streak > 0 ? `${f.streak}V seguidas` : f.streak < 0 ? `${-f.streak}D seguidas` : '—';
  return (
    <div>
      <div className="mb-1 font-medium" style={{ color }}>
        {name}
      </div>
      <div className="mb-1">
        <Last5 results={last5} color={color} />
      </div>
      <div className="text-[14px] text-(--ink-soft)">Racha: {streakTxt}</div>
      <div className="text-[14px] text-(--ink-soft)">
        En superficie: {rec.wins}V–{rec.losses}D
      </div>
    </div>
  );
}

/**
 * Physical availability. These are traces injuries leave in results (retirements,
 * walkovers, absences, workload) — evidence, not a medical report. Labelled that
 * way so nobody reads it as "player X is injured".
 */
export function FitnessBlock({
  p1Name,
  p2Name,
  f1,
  f2,
}: {
  p1Name: string;
  p2Name: string;
  f1: FitnessSignals;
  f2: FitnessSignals;
}) {
  const describe = (f: FitnessSignals) => {
    const items: string[] = [];
    if (f.retirements > 0) items.push(`${f.retirements} retiro${f.retirements > 1 ? 's' : ''}`);
    if (f.walkovers > 0) items.push(`${f.walkovers} W/O`);
    if (f.daysSinceLastMatch != null) items.push(`${f.daysSinceLastMatch} días sin jugar`);
    items.push(`${f.matchesLast30Days} partidos en 30 días`);
    return items;
  };

  return (
    <div className="rounded-lg bg-(--raised) p-3">
      <div className="mb-1 text-[14px] uppercase tracking-wide text-(--ink-muted)">
        Señales físicas (de resultados, no diagnóstico)
      </div>
      <p className="mb-2 text-[11px] leading-snug text-(--ink-muted)">
        Retiros, ausencias y carga de partidos. No existe una fuente abierta de lesiones actuales;
        esto son las huellas que dejan en los resultados.
      </p>
      <div className="grid grid-cols-2 gap-4 text-[14px]">
        {(
          [
            [p1Name, f1, P1_COLOR],
            [p2Name, f2, P2_COLOR],
          ] as [string, FitnessSignals, string][]
        ).map(([name, f, color]) => (
          <div key={name}>
            <div className="mb-0.5 font-medium" style={{ color }}>
              {name}
            </div>
            <ul className="text-(--ink-soft)">
              {describe(f).map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export const SERVE_ROWS: { label: string; key: keyof ServeStats; suffix: string }[] = [
  { label: 'Aces por partido', key: 'acesPerMatch', suffix: '' },
  { label: 'Ace %', key: 'acePct', suffix: '%' },
  { label: '1er saque dentro %', key: 'firstInPct', suffix: '%' },
  { label: '1er saque ganado %', key: 'firstWonPct', suffix: '%' },
  { label: '2do saque ganado %', key: 'secondWonPct', suffix: '%' },
  { label: 'Break points salvados %', key: 'bpSavedPct', suffix: '%' },
];

export function ServeCompare({
  p1Name,
  p2Name,
  s1,
  s2,
}: {
  p1Name: string;
  p2Name: string;
  s1: ServeStats;
  s2: ServeStats;
}) {
  if (s1.matches === 0 && s2.matches === 0) return null;
  const fmt = (v: number | null, suf: string) => (v == null ? '—' : `${v}${suf}`);
  return (
    <div className="rounded-lg bg-(--raised) p-3">
      <div className="mb-2 text-[14px] uppercase tracking-wide text-(--ink-muted)">
        Saque y quiebre (promedio histórico)
      </div>
      <div className="space-y-1.5">
        {SERVE_ROWS.map((row) => {
          const v1 = s1[row.key];
          const v2 = s2[row.key];
          const better = v1 != null && v2 != null ? (v1 > v2 ? 1 : v1 < v2 ? 2 : 0) : 0;
          return (
            <div key={row.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-[14px]">
              <span
                className="w-16 text-right tabular-nums"
                style={{ color: better === 1 ? P1_COLOR : '#cbd5e1', fontWeight: better === 1 ? 600 : 400 }}
              >
                {fmt(v1 as number | null, row.suffix)}
              </span>
              <span className="text-center text-(--ink-muted)">{row.label}</span>
              <span
                className="w-16 tabular-nums"
                style={{ color: better === 2 ? P2_COLOR : '#cbd5e1', fontWeight: better === 2 ? 600 : 400 }}
              >
                {fmt(v2 as number | null, row.suffix)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-(--ink-muted)">
        <span>{p1Name}</span>
        <span>{p2Name}</span>
      </div>
    </div>
  );
}
