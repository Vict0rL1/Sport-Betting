// Piezas de MatchCard.tsx (partido en la Fase 5: ningún fichero de la interfaz pasa de ~400 líneas).
import { type FbFixtureWithPrediction, type FbPrediction } from '../../lib/football';
import { formatDate } from '../../lib/format';
import { AWAY_COLOR, DRAW_COLOR, HOME_COLOR, pct } from '../../lib/theme';
import { BarRow, CompareRow, EmptyState, FactorValue, FormDots, Panel, SectionTitle, TeamCrest } from '../ui';
import ScoreMatrix from './ScoreMatrix';
import { PostprocessPanel } from '../PostprocessPanel';
import ThinMarkets from './ThinMarkets';
import NewsPanel from './NewsPanel';
import SquadPanel from './SquadPanel';

export function TeamName({
  league, id, name, elo, eloRank, seededFrom = null, alignRight = false, homeBadge = false, onClick,
}: {
  league: string; id: string | null; logo?: string | null;
  name: string; elo: number | null; eloRank: number | null; seededFrom?: string | null;
  alignRight?: boolean; homeBadge?: boolean; onClick?: () => void;
}) {
  const logo = null;
  return (
    <div className={`min-w-0 flex-1 ${alignRight ? 'text-right' : ''}`}>
      <span className={`flex items-center gap-1.5 ${alignRight ? 'justify-end' : ''}`}>
        {/* The crest, not the series dot: the dot's job is done one line below
            by the hero label, and two identity marks on one line is one too many. */}
        {!alignRight && <TeamCrest league={league} name={name} code={id} logo={logo} />}
        <button
          onClick={onClick}
          disabled={!onClick}
          // Wraps rather than truncates: at the larger type size the team name
          // no longer fits half a phone-width card, and an ellipsis eats the one
          // thing the card exists to tell you. See nfl/GameCard for the detail.
          className={`max-w-full text-[17px] font-semibold leading-tight break-words text-(--ink-strong) ${
            onClick ? 'hover:underline' : 'cursor-default'
          }`}
          title={onClick ? 'Ver ficha del equipo' : name}
        >
          {name}
        </button>
        {alignRight && <TeamCrest league={league} name={name} code={id} logo={logo} />}
      </span>
      <div className="text-[13px] text-(--ink-muted)">
        {homeBadge && 'local · '}
        {elo != null && (
          <>
            Elo {Math.round(elo)}
            {eloRank != null && ` (#${eloRank})`}
          </>
        )}
        {/* Said on the line that carries the number, because it changes what the
            number means: this club has not played a match in this division. */}
        {seededFrom && (
          <span className="ml-1 text-[#c08a2e]" title={`Elo trasladado desde ${seededFrom} con el salto de división medido para esta liga. El equipo aún no ha jugado aquí.`}>
            · recién ascendido
          </span>
        )}
      </div>
    </div>
  );
}

export function MissingModel({ item }: { item: FbFixtureWithPrediction }) {
  const { fixture } = item;
  const missing = [
    !fixture.home_id ? fixture.home_name : null,
    !fixture.away_id ? fixture.away_name : null,
  ].filter(Boolean) as string[];
  return (
    <EmptyState title="Sin modelo ni cuotas para este partido" tone="warning">
      {missing.length > 0 && (
        <>
          No encuentro en el historial a <strong>{missing.join(', ')}</strong>. Ocurre en
          competiciones sin fuente de resultados (Champions) o cuando la casa escribe el nombre del
          club de otra forma.
        </>
      )}
    </EmptyState>
  );
}

/** Full breakdown, all figures drawn from the same score distribution. */
export function Detail({
  prediction, league, outHome, outAway, onOutHome, onOutAway, adjusting, adjusted,
}: {
  prediction: FbPrediction;
  league: string;
  outHome: string[];
  outAway: string[];
  onOutHome: (ids: string[]) => void;
  onOutAway: (ids: string[]) => void;
  adjusting: boolean;
  adjusted: boolean;
}) {
  const { teams, goals, h2h, market, reasoning, reliability, squads, summary } = prediction;
  const home = teams.home;
  const away = teams.away;
  const hasSquads = squads.home !== null || squads.away !== null;
  const formColors = { W: HOME_COLOR, D: DRAW_COLOR, L: AWAY_COLOR };

  return (
    <div className="space-y-3">
      {hasSquads && (
        <Panel>
          <SectionTitle
            right={adjusting ? 'recalculando…' : adjusted ? 'ajustado a tus bajas' : undefined}
          >
            Quién juega
          </SectionTitle>
          <p className="mb-2.5 text-[13px] leading-relaxed text-(--ink-soft)">
            Las lesiones y sanciones conocidas ya vienen marcadas. Si sabes la alineación — se
            publica una hora antes — marca al resto y se recalcula todo.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row">
            <SquadPanel
              league={league} side="home" teamId={home.id} teamName={home.name}
              color={HOME_COLOR} availability={squads.home} out={outHome} onChange={onOutHome}
            />
            <SquadPanel
              league={league} side="away" teamId={away.id} teamName={away.name}
              color={AWAY_COLOR} availability={squads.away} out={outAway} onChange={onOutAway}
            />
          </div>
        </Panel>
      )}

      <NewsPanel prediction={prediction} />

      <ScoreMatrix prediction={prediction} />

      <Panel>
        <SectionTitle>Por qué</SectionTitle>
        <p className="mb-2 text-[15px] leading-relaxed text-(--ink-body)">{reasoning.text}</p>
        <dl className="space-y-1 text-[13px]">
          {reasoning.factors.map((f) => (
            <div key={f.key} className="flex justify-between gap-3">
              <dt className="text-(--ink-soft)">{f.label}</dt>
              <dd>
                <FactorValue
                  color={f.pointsForHome >= 0 ? HOME_COLOR : AWAY_COLOR}
                  neutral={f.pointsForHome === 0}
                >
                  {f.pointsForHome === 0
                    ? '0 (neutral)'
                    : `+${Math.abs(f.pointsForHome)} para ${f.pointsForHome > 0 ? home.name : away.name}`}
                </FactorValue>
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel>
        <SectionTitle>Marcadores más probables</SectionTitle>
        <div className="space-y-1">
          {goals.scorelines.map((s) => (
            <BarRow
              key={s.label}
              label={s.label}
              value={s.probability}
              max={goals.scorelines[0].probability}
              color={s.home > s.away ? HOME_COLOR : s.home === s.away ? DRAW_COLOR : AWAY_COLOR}
              valueLabel={pct(s.probability)}
            />
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Los dos equipos</SectionTitle>
        <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[13px]">
          <div />
          <div className="w-24 break-words text-right font-medium" style={{ color: HOME_COLOR }}>
            {home.name}
          </div>
          <div className="w-24 break-words text-right font-medium" style={{ color: AWAY_COLOR }}>
            {away.name}
          </div>
          <CompareRow label="Elo" left={Math.round(home.elo)} right={Math.round(away.elo)} />
          <CompareRow label="Goles a favor / partido" left={home.gf ?? '—'} right={away.gf ?? '—'} />
          <CompareRow label="Goles en contra / partido" left={home.ga ?? '—'} right={away.ga ?? '—'} />
          <CompareRow
            label="Balance (G-E-P)"
            left={`${home.record.wins}-${home.record.draws}-${home.record.losses}`}
            right={`${away.record.wins}-${away.record.draws}-${away.record.losses}`}
          />
          <CompareRow
            label="Últimos 5"
            title="Azul = ganado · turquesa = empatado · naranja = perdido"
            left={<FormDots results={home.last5} colors={formColors} />}
            right={<FormDots results={away.last5} colors={formColors} />}
          />
        </dl>
      </Panel>

      <Panel>
        <SectionTitle
          right={
            <>
              <span style={{ color: HOME_COLOR }}>{h2h.homeWins}</span>
              <span className="text-(--ink-faint)"> · {h2h.draws} · </span>
              <span style={{ color: AWAY_COLOR }}>{h2h.awayWins}</span>
              <span className="ml-1.5 text-(--ink-faint)">({h2h.total})</span>
            </>
          }
        >
          Historial directo
        </SectionTitle>
        {h2h.recent.length === 0 ? (
          <p className="text-[13px] text-(--ink-muted)">Sin enfrentamientos previos.</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {h2h.recent.map((m, i) => (
              <li key={i} className="flex justify-between gap-3 text-(--ink-body)">
                <span className="shrink-0 text-(--ink-muted)">{formatDate(m.date)}</span>
                <span className="break-words text-right">
                  {m.homeId === home.id ? home.name : away.name} {m.homeGoals}–{m.awayGoals}{' '}
                  {m.awayId === away.id ? away.name : home.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ThinMarkets prediction={prediction} />

      <Panel>
        <SectionTitle>De dónde sale este número</SectionTitle>
        <PostprocessPanel
          postprocess={prediction.postprocess}
          rows={[
            { label: '1 · Local', raw: prediction.model.home, final: prediction.final.home },
            { label: 'X · Empate', raw: prediction.model.draw, final: prediction.final.draw },
            { label: '2 · Visitante', raw: prediction.model.away, final: prediction.final.away },
          ]}
        />
      </Panel>

      {market.market && (
        <Panel>
          <SectionTitle right={`margen ${((market.market.overround - 1) * 100).toFixed(1)}%`}>
            Mercado
          </SectionTitle>
          <p className="text-[13px] leading-relaxed text-(--ink-body)">
            Cuotas {market.market.odds.home} / {market.market.odds.draw} / {market.market.odds.away}{' '}
            · implícitas sin vig {pct(market.market.home)} / {pct(market.market.draw)} /{' '}
            {pct(market.market.away)}
          </p>
        </Panel>
      )}

      <Panel>
        <SectionTitle>Lectura completa</SectionTitle>
        <ul className="space-y-1.5">
          {summary.bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-(--ink-soft)">
              <span aria-hidden className="text-(--ink-faint)">
                •
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <div
        className={`rounded-xl border p-3 text-[14px] ${
          reliability.level === 'high'
            ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
            : reliability.level === 'medium'
              ? 'border-amber-500/25 bg-amber-500/[0.06]'
              : 'border-rose-500/25 bg-rose-500/[0.06]'
        }`}
      >
        <p className="text-(--ink-body)">
          <strong className="capitalize">{reliability.label}</strong> — margen ±
          {reliability.marginPp} pp. Partidos tras cada Elo: {reliability.matchesBehind.home} y{' '}
          {reliability.matchesBehind.away}.
        </p>
        {reliability.reasons.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {reliability.reasons.map((r, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-(--ink-soft)">
                <span aria-hidden className="text-(--ink-faint)">
                  •
                </span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[13px] leading-relaxed text-(--ink-muted)">{prediction.disclaimer}</p>
    </div>
  );
}

/** Which of the three the model rated highest. */
export function topOutcome(m: { home: number; draw: number; away: number }): 'home' | 'draw' | 'away' {
  if (m.draw >= m.home && m.draw >= m.away) return 'draw';
  return m.home >= m.away ? 'home' : 'away';
}

/** Which of the three actually happened. */
export function actualOutcome(r: { homeScore: number; awayScore: number }): 'home' | 'draw' | 'away' {
  if (r.homeScore === r.awayScore) return 'draw';
  return r.homeScore > r.awayScore ? 'home' : 'away';
}
