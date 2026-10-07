import { useEffect, useState } from 'react';
import { fbApi, type FbFixtureWithPrediction, type FbPrediction } from '../../lib/football';
import { AWAY_COLOR, DRAW_COLOR, HOME_COLOR, pct } from '../../lib/theme';
import { Badge, Card, Disclosure, HeroStat, MatchTime, ProbabilityBar, ReliabilityChip, ResultBanner, StatRow, StatTile, MarketGap } from '../ui';
import { realMarket } from '../../lib/picks';
import { EnlacePartido } from '../ui';
import EventTrustPanel from '../trust/EventTrustPanel';
import { TeamName, MissingModel, Detail, topOutcome, actualOutcome } from './MatchCardPartes';

/**
 * One fixture.
 *
 * The card used to open with a nine-bullet paragraph: every number the model knew,
 * written out in prose, above the fold. That is the least scannable way to present
 * numbers, and it made every card look identical from a distance. Now the top of
 * the card carries the three probabilities and four figures, the one-line verdict
 * sits under them, and the prose moved into the breakdown for anyone who wants the
 * reasoning rather than the answer.
 */
export default function MatchCard({
  item,
  onOpenTeam,
}: {
  item: FbFixtureWithPrediction;
  onOpenTeam: (league: string, id: string) => void;
}) {
  // Players the user has marked unavailable, and the prediction the server
  // returns for that lineup. Held here rather than inside the squad panel because
  // EVERY figure on the card comes from the same distribution — mark a striker out
  // and the 1X2, the goals markets and the whole matrix have to move together.
  const [outHome, setOutHome] = useState<string[]>([]);
  const [outAway, setOutAway] = useState<string[]>([]);
  const [adjusted, setAdjusted] = useState<FbPrediction | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  const { fixture, marketOnly, teams } = item;
  const dirty = outHome.length > 0 || outAway.length > 0;

  useEffect(() => {
    if (!dirty) {
      setAdjusted(null);
      return;
    }
    let live = true;
    setAdjusting(true);
    fbApi
      .fixture(fixture.id, { home: outHome, away: outAway })
      .then((r) => live && setAdjusted(r.prediction))
      // Falling back to the unadjusted prediction is right: a failed re-predict
      // must never leave the card showing numbers for a lineup nobody asked for.
      .catch(() => live && setAdjusted(null))
      .finally(() => live && setAdjusting(false));
    return () => {
      live = false;
    };
  }, [fixture.id, outHome, outAway, dirty]);

  const prediction = adjusted ?? item.prediction;
  // La cabecera enseña la probabilidad PUBLICADA (post-procesada). La cruda no
  // desaparece: sale en su propio panel dentro del detalle, para que se puedan comparar.
  const probs = prediction?.final ?? marketOnly ?? null;
  const fromModel = !!prediction;

  const homeName = prediction?.teams.home.name ?? fixture.home_name;
  const awayName = prediction?.teams.away.name ?? fixture.away_name;

  return (
    <Card as="article" className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2 text-[13px] text-(--ink-muted)">
        <MatchTime iso={fixture.commence_time} />
        <div className="flex items-center gap-1.5">
          {dirty && <Badge tone="accent">{adjusting ? 'recalculando…' : 'con tus bajas'}</Badge>}
          {fixture.source === 'fixture' && <Badge tone="warning">partido demo</Badge>}
        </div>
      </div>

      {/* The result, when there is one. Above the forecast because once a match
          has been played the score is the headline and the prediction is history.
          Football is the one sport where a DRAW is a real third outcome, so
          "did the model call it" compares the winning side against whichever of
          the three the model rated highest — not just home against away. */}
      <ResultBanner
        started={item.outcome.started}
        score={
          item.outcome.result
            ? `${item.outcome.result.homeScore}-${item.outcome.result.awayScore}`
            : null
        }
        detail={
          item.outcome.result
            ? `${homeName} ${item.outcome.result.homeScore} · ${awayName} ${item.outcome.result.awayScore}`
            : null
        }
        modelCalledIt={
          prediction && item.outcome.result
            ? topOutcome(prediction.model) === actualOutcome(item.outcome.result)
            : null
        }
      />

      <div className="mb-3 flex items-start justify-between gap-3">
        <TeamName
          league={fixture.league}
          id={fixture.home_id}
          name={homeName}
          elo={prediction?.teams.home.elo ?? teams.home?.elo ?? null}
          eloRank={prediction?.teams.home.eloRank ?? teams.home?.eloRank ?? null}
          seededFrom={prediction?.teams.home.seededFrom ?? null}
          homeBadge
          onClick={fixture.home_id ? () => onOpenTeam(fixture.league, fixture.home_id!) : undefined}
        />
        <span className="shrink-0 pt-1 text-[13px] font-medium text-(--ink-faint)">vs</span>
        <TeamName
          league={fixture.league}
          id={fixture.away_id}
          name={awayName}
          elo={prediction?.teams.away.elo ?? teams.away?.elo ?? null}
          eloRank={prediction?.teams.away.eloRank ?? teams.away?.eloRank ?? null}
          seededFrom={prediction?.teams.away.seededFrom ?? null}
          alignRight
          onClick={fixture.away_id ? () => onOpenTeam(fixture.league, fixture.away_id!) : undefined}
        />
      </div>

      {probs ? (
        <>
          {/* 1X2 — three outcomes, so the draw gets equal billing */}
          <div className="flex items-end justify-between gap-3">
            <HeroStat
              value={pct(probs.home)}
              label="1 · Local"
              sub={fixture.odds_home ? `cuota ${fixture.odds_home}` : undefined}
              color={HOME_COLOR}
            />
            <div className="pb-0.5">
              <HeroStat
                value={pct(probs.draw)}
                label="X · Empate"
                sub={fixture.odds_draw ? `cuota ${fixture.odds_draw}` : undefined}
                color={DRAW_COLOR}
                align="center"
                size="sm"
              />
            </div>
            <HeroStat
              value={pct(probs.away)}
              label="2 · Visitante"
              sub={fixture.odds_away ? `cuota ${fixture.odds_away}` : undefined}
              color={AWAY_COLOR}
              align="right"
            />
          </div>

          <div className="mt-2.5">
            {/* El mercado, MARCADO SOBRE la barra del modelo. Antes la comparación
                —que es para lo que existe esta tarjeta— no estaba en ninguna parte:
                había que abrir el desglose y leer dos porcentajes. */}
            <div className="mb-1 flex items-center justify-end">
              <MarketGap model={probs.home} market={prediction?.market.market?.home} />
            </div>
            <ProbabilityBar
              segments={[
                { value: probs.home, color: HOME_COLOR, label: homeName },
                { value: probs.draw, color: DRAW_COLOR, label: 'Empate' },
                { value: probs.away, color: AWAY_COLOR, label: awayName },
              ]}
              marker={prediction?.market.market?.home}
            />
          </div>

          {!fromModel && (
            <p className="mt-2 text-center text-[13px] text-amber-300/90">
              Probabilidades implícitas del mercado, no del modelo.
            </p>
          )}

          {prediction && (
            <>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-[15px] leading-snug text-(--ink-body)">
                  {/* En un partido abierto la frase útil NO es cuál de tres treintaipicos
                      es el mayor: es la doble oportunidad, que en el 82,2 % de los
                      partidos abiertos del archivo pasa del 65 %. Antes la tarjeta
                      decía «X es solo el más probable» y se callaba el 70 %. */}
                  {prediction.verdict.open ? (
                    <>
                      Partido abierto —{' '}
                      <strong className="font-semibold text-(--ink-strong)">
                        {prediction.verdict.doubleChance.label}
                      </strong>{' '}
                      {pct(prediction.verdict.doubleChance.probability)}
                      <span className="text-(--ink-soft)">
                        {' '}
                        · suelto, {prediction.verdict.label.toLowerCase()}{' '}
                        {pct(prediction.verdict.probability)}
                      </span>
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
                  {realMarket(fixture.source) && prediction.market.verdict.startsWith('value_') && (
                    <Badge tone="good" title="El modelo da más probabilidad que el mercado">
                      Value:{' '}
                      {prediction.market.verdict === 'value_home'
                        ? homeName
                        : prediction.market.verdict === 'value_away'
                          ? awayName
                          : 'empate'}
                    </Badge>
                  )}
                  <ReliabilityChip
                    level={prediction.reliability.level}
                    label={prediction.reliability.label}
                    marginPp={prediction.reliability.marginPp}
                    title={[
                      `Margen de incertidumbre: ±${prediction.reliability.marginPp} pp.`,
                      `Partidos tras cada Elo: ${prediction.reliability.matchesBehind.home} y ${prediction.reliability.matchesBehind.away}.`,
                      ...prediction.reliability.reasons,
                    ].join('\n')}
                  />
                </div>
              </div>

              <div className="mt-2 flex justify-end">
                <EnlacePartido sport="football" id={fixture.id} clave={item.prePartido?.matchKey} />
              </div>
              <EventTrustPanel confianza={item.confianza} prePartido={item.prePartido} />
              <div className="mt-1">
                <Disclosure summary="¿Por qué? · goles, alineaciones, marcadores, Elo y mercado">
                  <StatRow>
                <StatTile
                  label="Goles esp."
                  value={`${prediction.goals.expectedHome} – ${prediction.goals.expectedAway}`}
                  hint={`total ${prediction.goals.expectedTotal}`}
                />
                <StatTile
                  label="Marcador"
                  value={prediction.goals.scorelines[0].label}
                  hint={`más probable · ${pct(prediction.goals.scorelines[0].probability)}`}
                />
                <StatTile
                  label="+2.5 goles"
                  value={pct(prediction.goals.over25)}
                  hint={`−2.5: ${pct(prediction.goals.under25)}`}
                />
                <StatTile
                  label="Ambos marcan"
                  value={pct(prediction.goals.bothScore)}
                  hint={`no: ${pct(1 - prediction.goals.bothScore)}`}
                />
              </StatRow>
                  <Detail
                    prediction={prediction}
                    league={fixture.league}
                    outHome={outHome}
                    outAway={outAway}
                    onOutHome={setOutHome}
                    onOutAway={setOutAway}
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
