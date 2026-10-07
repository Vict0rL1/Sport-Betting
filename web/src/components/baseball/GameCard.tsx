import { useEffect, useState } from 'react';
import { bsbApi, type BsbGameWithPrediction, type BsbPrediction } from '../../lib/baseball';
import { ClimaPanel } from '../ClimaPanel';
import { AWAY_COLOR, HOME_COLOR, pct } from '../../lib/theme';
import { Badge, Card, Disclosure, HeroStat, MatchTime, ProbabilityBar, ReliabilityChip, ResultBanner, StatRow, StatTile, MarketGap } from '../ui';
import { realMarket } from '../../lib/picks';
import { EnlacePartido } from '../ui';
import EventTrustPanel from '../trust/EventTrustPanel';
import { StadiumIcon } from '../icons';
import { StarterChip, TeamName, MissingModel, Detail } from './GameCardPartes';

export default function GameCard({
  item,
  onOpenTeam,
}: {
  item: BsbGameWithPrediction;
  onOpenTeam: (league: string, id: string) => void;
}) {
  // The starting pitchers the user has chosen, and the prediction the server
  // returns for them. Held here because EVERYTHING on the card comes out of the
  // same run distribution: change a starter and the winner, the total, the run
  // line and the whole matrix have to move together.
  const [homeSp, setHomeSp] = useState<string | null | undefined>(undefined);
  const [awaySp, setAwaySp] = useState<string | null | undefined>(undefined);
  const [adjusted, setAdjusted] = useState<BsbPrediction | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const { game, marketOnly, teams, startersAnnounced, bullpen } = item;
  const cansados = (bullpen?.home?.cansados.length ?? 0) + (bullpen?.away?.cansados.length ?? 0);
  const dirty = homeSp !== undefined || awaySp !== undefined;

  useEffect(() => {
    if (!dirty) {
      setAdjusted(null);
      return;
    }
    let live = true;
    setAdjusting(true);
    bsbApi
      .game(game.id, { home: homeSp, away: awaySp })
      .then((r) => live && setAdjusted(r.prediction))
      // Falling back to the unadjusted call is right: a failed re-predict must
      // never leave the card showing numbers for a matchup nobody asked for.
      .catch(() => live && setAdjusted(null))
      .finally(() => live && setAdjusting(false));
    return () => {
      live = false;
    };
  }, [game.id, homeSp, awaySp, dirty]);

  const prediction = adjusted ?? item.prediction;
  const probs = prediction?.model ?? marketOnly ?? null;
  const fromModel = !!prediction;

  return (
    <Card as="article" className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2 text-[13px] text-(--ink-muted)">
        <MatchTime iso={game.commence_time} />
        <div className="flex items-center gap-1.5">
          {dirty && <Badge tone="accent">{adjusting ? 'recalculando…' : 'con tu abridor'}</Badge>}
          {!startersAnnounced && prediction && (
            <Badge title="Ningún feed ha anunciado los abridores; se usa el número uno de cada rotación">
              abridores estimados
            </Badge>
          )}
          {cansados > 0 && (
            <Badge
              tone="warning"
              title={[bullpen?.home, bullpen?.away]
                .flatMap((b) => b?.cansados ?? [])
                .map((c) => `${c.nombre}: ${c.apariciones3d} salidas y ${c.lanzamientos3d} lanzamientos en 3 días`)
                .join(' · ')}
            >
              bullpen cargado · {cansados}
            </Badge>
          )}
          {game.source === 'fixture' && <Badge tone="warning">partido demo</Badge>}
        </div>
      </div>
      <ClimaPanel clima={item.clima} />

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

      {/* Away @ Home — baseball is written away-first, unlike the other three */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <TeamName
          league={game.league}
          id={game.away_id}
          name={prediction?.teams.away.name ?? game.away_name}
          elo={prediction?.teams.away.elo ?? teams.away?.elo ?? null}
          eloRank={prediction?.teams.away.eloRank ?? teams.away?.eloRank ?? null}
          odds={game.odds_away}
          onClick={game.away_id ? () => onOpenTeam(game.league, game.away_id!) : undefined}
        />
        <span className="shrink-0 pt-1 text-[13px] font-medium text-(--ink-faint)">@</span>
        <TeamName
          league={game.league}
          id={game.home_id}
          name={prediction?.teams.home.name ?? game.home_name}
          elo={prediction?.teams.home.elo ?? teams.home?.elo ?? null}
          eloRank={prediction?.teams.home.eloRank ?? teams.home?.eloRank ?? null}
          odds={game.odds_home}
          homeBadge
          alignRight
          onClick={game.home_id ? () => onOpenTeam(game.league, game.home_id!) : undefined}
        />
      </div>

      {probs ? (
        <>
          <div className="flex items-end justify-between gap-3">
            <HeroStat
              value={pct(probs.away)}
              label="Visitante"
              sub={[
                prediction ? `${prediction.runs.expectedAway} carreras esp.` : null,
                game.odds_away ? `cuota ${game.odds_away}` : null,
              ].filter(Boolean).join(' · ') || undefined}
              color={AWAY_COLOR}
            />
            <HeroStat
              value={pct(probs.home)}
              label="Local"
              sub={[
                prediction ? `${prediction.runs.expectedHome} carreras esp.` : null,
                game.odds_home ? `cuota ${game.odds_home}` : null,
              ].filter(Boolean).join(' · ') || undefined}
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
          {!fromModel && (
            <p className="mt-2 text-center text-[13px] text-amber-300/90">
              Probabilidades implícitas del mercado, no del modelo.
            </p>
          )}

          {prediction && (
            <>
              {/* The starting pitchers get top billing: in baseball nothing else
                  a single player does moves the number this much. */}
              <div className="mt-3 grid grid-cols-2 gap-x-4 border-t border-(--line) pt-3">
                <StarterChip side={prediction.teams.away} color={AWAY_COLOR} />
                <StarterChip side={prediction.teams.home} color={HOME_COLOR} />
              </div>

              {/* The stadium.
                  Only when it actually moves something — below 2 % it is noise
                  dressed as a finding, and a tile that says "+0 carreras" trains the
                  reader to skip the row. Coors reads +1.9; most parks say nothing. */}
              {prediction.park && Math.abs(prediction.park.factor - 1) >= 0.02 && (
                <p className="mt-2 text-[14px] leading-snug text-(--ink-soft)">
                  <span aria-hidden className="mr-1.5 inline-flex align-[-3px] text-(--ink-soft)"><StadiumIcon size={16} /></span>
                  <strong className="font-semibold text-(--ink-body)">{prediction.park.name}</strong>{' '}
                  {prediction.park.runsVsNeutral > 0 ? 'sube' : 'baja'} el total{' '}
                  <strong className="font-semibold tabular-nums text-(--ink-body)">
                    {prediction.park.runsVsNeutral > 0 ? '+' : ''}
                    {prediction.park.runsVsNeutral}
                  </strong>{' '}
                  carreras ({Math.round((prediction.park.factor - 1) * 100) > 0 ? '+' : ''}
                  {Math.round((prediction.park.factor - 1) * 100)} %, medido en{' '}
                  {prediction.park.games} partidos allí). Ya está dentro de las carreras esperadas.
                </p>
              )}

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
                                    {/* Gated on the odds being REAL. Without a key the app prices the
                      slate from its own model, so a green "Value" badge here was the
                      card claiming to have found an edge against its own output —
                      while the panel above it said, in words, that those odds come
                      from the model and comparing them says nothing. */}
                  {realMarket(game.source) && prediction.market.verdict.startsWith('value_') && (
                    <Badge tone="good" title="El modelo da más probabilidad que el mercado">
                      Value:{' '}
                      {prediction.market.verdict === 'value_home'
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
                      `Partidos tras cada Elo: ${prediction.reliability.gamesBehind.home} y ${prediction.reliability.gamesBehind.away}.`,
                      ...prediction.reliability.reasons,
                    ].join('\n')}
                  />
                </div>
              </div>

              <div className="mt-2 flex justify-end">
                <EnlacePartido sport="baseball" id={game.id} clave={item.prePartido?.matchKey} />
              </div>
              <EventTrustPanel confianza={item.confianza} prePartido={item.prePartido} />
              <div className="mt-1">
                <Disclosure summary="¿Por qué? · carreras, abridores, marcadores y mercado">
                  <StatRow>
                <StatTile
                  label="Carreras esp."
                  value={`${prediction.runs.expectedAway} – ${prediction.runs.expectedHome}`}
                  hint={`total ${prediction.runs.expectedTotal}`}
                />
                <StatTile
                  label="Marcador"
                  value={`${prediction.runs.scorelines[0].away}-${prediction.runs.scorelines[0].home}`}
                  hint={`más probable · ${pct(prediction.runs.scorelines[0].probability)}`}
                />
                <StatTile
                  label={`+${prediction.runs.totalLine} carreras`}
                  value={pct(prediction.runs.over)}
                  hint={`−${prediction.runs.totalLine}: ${pct(prediction.runs.under)}`}
                />
                <StatTile
                  label="Línea −1.5"
                  value={pct(prediction.runs.runLine.homeCovers)}
                  hint="local por 2+"
                />
              </StatRow>
                  <Detail
                    prediction={prediction}
                    league={game.league}
                    homeSp={homeSp}
                    awaySp={awaySp}
                    onHomeSp={setHomeSp}
                    onAwaySp={setAwaySp}
                    adjusting={adjusting}
                    adjusted={dirty}
                  />
                </Disclosure>
              </div>
            </>
          )}
        </>
      ) : (
        <MissingModel item={item} />
      )}
    </Card>
  );
}
