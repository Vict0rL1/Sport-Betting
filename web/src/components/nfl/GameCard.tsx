import type { NflGameWithPrediction } from '../../lib/nfl';
import { AWAY_COLOR, HOME_COLOR, pct } from '../../lib/theme';
import { EnlacePartido } from '../ui';
import EventTrustPanel from '../trust/EventTrustPanel';

import { Badge, Card, Disclosure, EmptyState, HeroStat, MatchTime, ProbabilityBar, ReliabilityChip, ResultBanner, StatRow, StatTile, MarketGap } from '../ui';
import { fmtLine, KeyNumbers, TeamName, Detail } from './GameCardPartes';

/**
 * One NFL game.
 *
 * The card is ordered the way a sportsbook orders its markets for this sport,
 * which is NOT the order the other four tabs use: the HANDICAP comes first,
 * because in American football the spread is the market and the moneyline is the
 * afterthought. A −7 favourite is described by the seven, not by the 72%.
 *
 * The panel that exists only here is "los números clave". Everything else in the
 * app prices a handicap off a smooth curve; this sport cannot, because 15% of
 * games end with a 3-point margin and 1.6% with a 9-point one. Showing those
 * probabilities is showing the one thing the model knows that a normal curve
 * does not.
 */
export default function GameCard({
  item,
  onOpenTeam,
}: {
  item: NflGameWithPrediction;
  onOpenTeam: (league: string, id: string) => void;
}) {
  const { game, prediction, marketOnly, teams } = item;
  const probs = prediction?.model ?? marketOnly ?? null;

  return (
    <Card as="article" className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-(--ink-muted)">
        {/* Only the clock: the day is in the heading above this group, and thirty
            cards each restating their own date is thirty copies of a fact that
            changes four times. */}
        <MatchTime
          iso={game.commence_time}
          extra={game.week != null ? <span className="ml-1.5">· semana {game.week}</span> : undefined}
        />
        <div className="flex items-center gap-1.5">
          {game.neutral === 1 && <Badge>campo neutral</Badge>}
          {game.source === 'schedule' && <Badge>calendario oficial</Badge>}
          {game.source === 'fixture' && <Badge tone="warning">partido demo</Badge>}
        </div>
      </div>

      {/* The result, when there is one. Above the forecast because once a game
          has been played the score is the headline and the prediction is
          history — see ResultBanner for the three states it distinguishes. */}
      <ResultBanner
        started={item.outcome.started}
        score={
          item.outcome.result
            ? `${item.outcome.result.awayScore}-${item.outcome.result.homeScore}`
            : null
        }
        detail={
          item.outcome.result
            ? `${game.away_name} ${item.outcome.result.awayScore} · ${game.home_name} ${item.outcome.result.homeScore}`
            : null
        }
        modelCalledIt={
          item.prediction && item.outcome.result
            ? item.outcome.result.homeScore === item.outcome.result.awayScore
              ? null
              : (item.outcome.result.homeScore > item.outcome.result.awayScore) ===
                (item.prediction.model.home >= 0.5)
            : null
        }
      />

      {/* Away @ Home — the order American football is always written in. */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <TeamName
          league={game.league}
          id={game.away_id}
          name={prediction?.teams.away.name ?? game.away_name}
          elo={prediction?.teams.away.elo ?? teams.away?.elo ?? null}
          eloRank={prediction?.teams.away.eloRank ?? teams.away?.eloRank ?? null}
          record={prediction?.teams.away.record ?? teams.away?.record ?? null}
          onClick={game.away_id ? () => onOpenTeam(game.league, game.away_id!) : undefined}
        />
        <span className="shrink-0 pt-1 text-[13px] font-medium text-(--ink-faint)">@</span>
        <TeamName
          league={game.league}
          id={game.home_id}
          name={prediction?.teams.home.name ?? game.home_name}
          elo={prediction?.teams.home.elo ?? teams.home?.elo ?? null}
          eloRank={prediction?.teams.home.eloRank ?? teams.home?.eloRank ?? null}
          record={prediction?.teams.home.record ?? teams.home?.record ?? null}
          alignRight
          homeBadge={game.neutral !== 1}
          onClick={game.home_id ? () => onOpenTeam(game.league, game.home_id!) : undefined}
        />
      </div>

      {probs ? (
        <>
          <div className="flex items-end justify-between gap-3">
            <HeroStat
              value={pct(probs.away)}
              label="Visitante"
              sub={game.odds_away ? `cuota ${game.odds_away}` : undefined}
              color={AWAY_COLOR}
            />
            <HeroStat
              value={pct(probs.home)}
              label="Local"
              sub={game.odds_home ? `cuota ${game.odds_home}` : undefined}
              color={HOME_COLOR}
              align="right"
            />
          </div>
          <div className="mt-2.5">
            {/* El mercado, MARCADO SOBRE la barra del modelo. Antes la comparación
                —que es para lo que existe esta tarjeta— no estaba en ninguna parte:
                había que abrir el desglose y leer dos porcentajes. */}
            <div className="mb-1 flex items-center justify-end">
              <MarketGap model={probs.away} market={prediction?.market.market?.away} />
            </div>
            <ProbabilityBar
              segments={[
                { value: probs.away, color: AWAY_COLOR, label: game.away_name },
                { value: probs.home, color: HOME_COLOR, label: game.home_name },
              ]}
              marker={prediction?.market.market?.away}
            />
          </div>

          {!prediction && (
            <p className="mt-2 text-center text-[13px] text-amber-300/90">
              Probabilidades implícitas del mercado, no del modelo.
            </p>
          )}

          {prediction && (
            <>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-[15px] leading-snug text-(--ink-body)">
                  {prediction.verdict.close ? (
                    <>
                      Muy igualado —{' '}
                      <strong className="font-semibold text-(--ink-strong)">
                        {prediction.verdict.label}
                      </strong>{' '}
                      solo por poco
                    </>
                  ) : (
                    <>
                      Lo más probable:{' '}
                      <strong className="font-semibold text-(--ink-strong)">
                        {prediction.verdict.label}
                      </strong>
                    </>
                  )}
                </p>
                {/* WRAPS, and must: this group holds a "Value: <team name>" badge, and
                      with `shrink-0` it could neither shrink nor wrap, so a long name
                      pushed the whole page 10px wide. */}
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  {prediction.market.verdict.startsWith('differs_') && (
                    // Neutral tone on purpose. This used to be a green "Value:" badge,
                    // which read as "here is an edge" on the one tab where the app has
                    // measured that there is none.
                    <Badge
                      tone="neutral"
                      title={
                        'El modelo da más probabilidad que el mercado a este equipo. ' +
                        'En la NFL eso NO es una ventaja: medido sobre 7.276 partidos, ' +
                        'la línea de cierre acierta más que el modelo (Brier 0.2115 ' +
                        'frente a 0.2180), así que lo más probable es que se equivoque ' +
                        'el modelo.'
                      }
                    >
                      Discrepa:{' '}
                      {prediction.market.verdict === 'differs_home'
                        ? prediction.teams.home.name
                        : prediction.teams.away.name}
                    </Badge>
                  )}
                  <ReliabilityChip
                    level={prediction.reliability.level}
                    label={prediction.reliability.label}
                    marginPp={prediction.reliability.marginPp}
                    title={[
                      `Margen de incertidumbre: ±${prediction.reliability.marginPp} pp.`,
                      'Calibrado contra la línea de cierre real: el modelo se separa 7.3 pp de media de ella.',
                      ...prediction.reliability.reasons,
                    ].join('\n')}
                  />
                </div>
              </div>

              <div className="mt-2 flex justify-end">
                <EnlacePartido sport="nfl" id={game.id} clave={item.prePartido?.matchKey} />
              </div>
              <EventTrustPanel confianza={item.confianza} prePartido={item.prePartido} />
              <div className="mt-1">
                <Disclosure summary="¿Por qué? · hándicap, total, números clave, márgenes y mercado">
                  <StatRow>
                <StatTile
                  label={`Hándicap ${fmtLine(prediction.spread.line)}`}
                  value={pct(prediction.spread.home.cover)}
                  hint={
                    prediction.spread.home.push > 0.005
                      ? `nulo ${pct(prediction.spread.home.push)}`
                      : 'lo cubre el local'
                  }
                  title={
                    prediction.spread.fromMarket
                      ? 'Línea tomada del mercado. Probabilidad de que el local la cubra.'
                      : 'Sin línea del mercado: se usa la del propio modelo, redondeada.'
                  }
                />
                <StatTile
                  label={`Total ${prediction.total.line}`}
                  value={pct(prediction.total.over)}
                  hint={`under ${pct(prediction.total.under)}`}
                />
                <StatTile
                  label="Margen esperado"
                  value={prediction.spread.label}
                  hint={`${prediction.points.home}-${prediction.points.away}`}
                />
                <StatTile
                  label="Marcador"
                  value={prediction.scorelines[0]?.label ?? '—'}
                  hint={`más probable · ${pct(prediction.scorelines[0]?.probability ?? 0)}`}
                />
              </StatRow>
                  <KeyNumbers prediction={prediction} />
                  <Detail prediction={prediction} clima={item.clima} />
                </Disclosure>
              </div>
            </>
          )}
        </>
      ) : (
        <EmptyState title="Sin modelo ni cuotas para este partido" tone="warning">
          No encuentro a estos equipos en el historial, así que no puedo calcular nada para este
          partido.
        </EmptyState>
      )}
    </Card>
  );
}
