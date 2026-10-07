import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { rutaEquipo } from '../../rutas';
import { useLigaEnRuta, ligaRecordada, useFiltroQuery } from '../../lib/rutas';
import {
  pillClass, SkeletonList, TeamCrest, DayFilter, DayHeading, StaleHistoryWarning, PicksPanel, DashboardHeader,
  EmptySlate, LeagueFlag, SlateTable, VacioPorqueNoHayCuotas} from '../ui';
import { staleLabel, staleness } from '../../lib/staleness';
import { CAVEATS, rankPicks, basketballPicks } from '../../lib/picks';
import { basketballSlate } from '../../lib/slate';
import { useStake } from '../../lib/useStake';
import { dayChipLabel, groupByDay } from '../../lib/format';
import {
  bbApi,
  type BbGameWithPrediction,
  type BbLeague,
  type BbMeta,
  type BbPowerTeam,
  type BbTrackRecord,
} from '../../lib/basketball';
import GameCard from './GameCard';
import EloRanking from '../EloRanking';
import { CheckIcon, CrossIcon } from '../icons';

/**
 * The whole basketball tab. Holds its own state and talks only to
 * /api/basketball/*, so switching sports never mixes the two — the tennis view is
 * untouched while this one is mounted, and vice versa.
 */
export default function BasketballDashboard() {
  const [meta, setMeta] = useState<BbMeta | null>(null);
  const [leagues, setLeagues] = useState<BbLeague[]>([]);
  const [league, setLeague] = useLigaEnRuta('/baloncesto', 'predictor.basketball.league');
  const [games, setGames] = useState<BbGameWithPrediction[]>([]);
  const [power, setPower] = useState<BbPowerTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  // Un equipo abre su página (Fase 5.12): una URL, no un modal.
  const setTeam = (t: { league: string; id: string }) => navigate(rutaEquipo('basketball', t.league, t.id));
  const [refreshing, setRefreshing] = useState(false);
  // null = every day, which is the default: someone who has not asked to filter
  // should see the whole schedule.
  const [day, setDay] = useFiltroQuery('dia');

  useEffect(() => {
    Promise.all([bbApi.meta(), bbApi.leagues()])
      .then(([m, l]) => {
        setMeta(m);
        setLeagues(l);
      })
      .catch((e) =>
        setError(
          `No se pudo cargar el baloncesto. ¿Ejecutaste "npm run update-data:bb"? (${e})`,
        ),
      );
  }, []);

  // Prefer a league that actually has games to show; fall back to one with data.
  const selectable = useMemo(
    () => leagues.filter((l) => l.hasUpcoming || l.games > 0),
    [leagues],
  );
  useEffect(() => {
    if (leagues.length === 0) return;
    if (league && selectable.some((l) => l.id === league)) return;
    const recordada = ligaRecordada('predictor.basketball.league');
    if (recordada && selectable.some((l) => l.id === recordada)) {
      setLeague(recordada);
      return;
    }
    const withGames = selectable.find((l) => l.hasUpcoming) ?? selectable[0];
    setLeague(withGames?.id ?? null);
  }, [selectable, league, leagues.length, setLeague]);

  useEffect(() => {
    if (!league) {
      setGames([]);
      setPower([]);
      return;
    }
    setLoading(true);
    Promise.all([bbApi.upcoming(league), bbApi.power(league, 40)])
      .then(([g, p]) => {
        setGames(g);
        setPower(p.teams);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [league]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await bbApi.refresh();
      const [m, l, g] = await Promise.all([
        bbApi.meta(),
        bbApi.leagues(),
        league ? bbApi.upcoming(league) : Promise.resolve([]),
      ]);
      setMeta(m);
      setLeagues(l);
      setGames(g);
    } catch (e) {
      setError(`No se pudo actualizar: ${e}`);
    } finally {
      setRefreshing(false);
    }
  }

  // Grouped by the reader's own local day, and filtered to one of them if asked.
  const dayGroups = useMemo(() => groupByDay(games, (g) => g.game.commence_time), [games]);
  const dayChips = useMemo(
    () => dayGroups.map((d) => ({ key: d.key, label: dayChipLabel(d.key), count: d.items.length })),
    [dayGroups],
  );
  const shownGroups = day ? dayGroups.filter((d) => d.key === day) : dayGroups;

  // Ranked markets, from the rows already fetched. Recomputed only when those
  // change: it is pure arithmetic over what is on screen, no extra request.
  const picks = useMemo(() => rankPicks(basketballPicks(games)), [games]);
  const [stake, setStake] = useStake();
  // Every price on screen invented by this app rather than fetched — see picks.ts.
  const slate = useMemo(() => basketballSlate(games), [games]);
  const demoOdds = games.length > 0 && games.every((r) => r.game.source === 'fixture');
  // A day that no longer exists after switching league would filter everything
  // away and look like "no games", so the choice is dropped rather than kept.
  useEffect(() => {
    if (day && !dayGroups.some((d) => d.key === day)) setDay(null);
  }, [dayGroups, day]);

  const activeLeague = leagues.find((l) => l.id === league) ?? null;
  const leagueMeta = meta?.leagues.find((l) => l.id === league) ?? null;

  // Computed once: the collapsed header needs the short version and the
  // expanded one the full paragraph, and they must be the same judgement.
  const stale = staleness('basketball', leagueMeta?.historyThrough, meta?.dataSource === 'seed');

  return (
    <div>
      <DashboardHeader
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshTitle="Vuelve a consultar los partidos próximos y sus cuotas"
        chips={meta && (<>{meta.counts.games.toLocaleString('es')} partidos · {meta.counts.teams} equipos</>)}
        alert={staleLabel(stale)}
      >
          <p className="max-w-prose text-[15px] leading-relaxed text-(--ink-soft)">
            Predicción de partidos con Elo por equipo, ventaja de campo, margen de puntos, descanso
            y odds del mercado.
          </p>
        {meta && <DataLine meta={meta} />}
        <StaleHistoryWarning
          info={stale}
          what="Los Elo, el margen y el total"
          fix="npm run update-data:bb"
        />
        {league && <BbTrackRecordPanel league={league} />}
      </DashboardHeader>

      {/* The ranked-markets panel. Built from the SAME rows the cards below
          render, so the two can never disagree about a number. */}
      <PicksPanel {...picks} caveat={CAVEATS.basketball} demoOdds={demoOdds} stake={stake} onStakeChange={setStake} />

      <SlateTable rows={slate} demoOdds={demoOdds} refrescadas={meta?.oddsRefreshedAt} bands={meta?.bands} />

      {games.length === 0 && !loading && (
        <VacioPorqueNoHayCuotas
          reason={meta?.oddsFallbackReason}
          detail={meta?.oddsFallbackDetail}
          hasKey={meta?.hasOddsKey ?? false}
          demoFixtures={meta?.demoFixtures ?? true}
        />
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3 text-[15px] text-rose-200">
          {error}
        </div>
      )}

      {/* League selector */}
      {selectable.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {selectable.map((l) => (
            <button
              key={l.id}
              onClick={() => setLeague(l.id)}
              title={l.label}
              className={pillClass(league === l.id)}
            >
                <LeagueFlag country={l.country} className="mr-1.5" />
              {l.name}
              {l.upcomingCount > 0 && <span className="ml-1.5 opacity-60">{l.upcomingCount}</span>}
              {!l.hasModel && <span className="ml-1.5 text-amber-400" title="Sin modelo Elo">◦</span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-5 text-[15px] text-rose-200">
          <p className="font-medium">No hay datos de baloncesto todavía.</p>
          <p className="mt-1 text-rose-300/90">
            Ejecuta <code className="rounded bg-rose-900/40 px-1">npm run update-data:bb</code> para
            descargar equipos, resultados y partidos próximos.
          </p>
        </div>
      )}

      {activeLeague && !activeLeague.hasModel && (
        <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-[15px] leading-relaxed text-amber-200/90">
          <strong>{activeLeague.name} sin modelo Elo.</strong> No hay una fuente abierta de
          resultados para esta liga, así que se muestran los partidos y las probabilidades{' '}
          <em>implícitas del mercado</em>, no una predicción propia. Se indica en cada tarjeta.
        </div>
      )}

      {/* Games */}
      {loading ? (
        <SkeletonList />
      ) : games.length === 0 ? (
        <EmptySlate what={activeLeague?.name ?? 'esta liga'} reason="sin-partidos" />
      ) : (
        <>
          <DayFilter days={dayChips} selected={day} onSelect={setDay} />
          {shownGroups.map((group) => (
            <section key={group.key} className="mb-6">
              <DayHeading label={group.label} count={group.items.length} />
              {/* Two-up from 1280px. The shell got wider (see SHELL_WIDTH in
                  App.tsx) and a card does not want to BE wider — it wants a
                  neighbour. `items-start` so a card with its breakdown open does
                  not stretch the one beside it.

                  minmax(0,1fr) and NOT grid-cols-1/2: a grid track is `minmax(auto,
                  1fr)` by default, and `auto` means "at least the widest thing that
                  cannot shrink". One nowrap badge inside a card was enough to push
                  the track past the viewport — 5px of horizontal page scroll on a
                  390px phone. Block flow (the `space-y-4` this replaced) clamped the
                  card and let the content overflow internally instead, so the bug
                  arrived with the grid. */}
              <div className="grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[repeat(2,minmax(0,1fr))] xl:items-start">
                {group.items.map((g) => (
                  <GameCard key={g.game.id} item={g} onOpenTeam={(lg, id) => setTeam({ league: lg, id })} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {/* All teams, by Elo — "la información de todos los equipos" */}
      <EloRanking
        title={`Todos los equipos · ${activeLeague?.name ?? ''}`}
        rows={power.map((t) => ({
          id: t.id,
          name: t.name,
          elo: t.elo,
          matches: t.games,
          badge: <TeamCrest league={league!} name={t.name} code={t.id} size={16} />,
          onOpen: () => setTeam({ league: league!, id: t.id }),
          extra: [
            { label: 'Anota', value: t.ppg?.toFixed(1) ?? '—', title: 'Puntos anotados por partido' },
            { label: 'Recibe', value: t.papg?.toFixed(1) ?? '—', title: 'Puntos recibidos por partido' },
            {
              label: 'Dif.',
              value:
                t.ppg != null && t.papg != null
                  ? `${t.ppg - t.papg > 0 ? '+' : ''}${(t.ppg - t.papg).toFixed(1)}`
                  : '—',
              title: 'Diferencial de puntos por partido',
            },
          ],
        }))}
        extraHeaders={['Anota', 'Recibe', 'Dif.']}
        footer={
          <>
            El Elo sale de los resultados, no del balance: gana puntos quien gana a rivales
            fuertes. El diferencial de puntos suele ir en la misma dirección, y cuando NO va es
            la señal interesante — un equipo con buen diferencial y peor Elo gana mucho a los
            malos y pierde con los buenos.
          </>
        }
      />
    </div>
  );
}

function DataLine({ meta }: { meta: BbMeta }) {
  const when = meta.oddsRefreshedAt ?? meta.updatedAt;
  const whenTxt = when
    ? new Date(when).toLocaleString('es', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
  return (
    <p className="mt-1 text-[14px] text-(--ink-muted)">
      {meta.counts.games} partidos · {meta.counts.teams} equipos · actualizado {whenTxt}
      {meta.hasOddsKey
        ? meta.autoRefreshMinutes > 0
          ? ` · auto cada ${Math.round(meta.autoRefreshMinutes / 60)}h`
          : ''
        : ' · configura ODDS_API_KEY para partidos y cuotas reales'}
    </p>
  );
}

/**
 * Ratings are only as current as the results behind them. In basketball this
 * matters even more than in tennis: a roster can change completely over one
 * summer, so a rating from a past season describes a team that no longer exists.
 */

/**
 * The app's own scorecard for basketball. Unlike tennis it can also report how far
 * off the predicted MARGIN was, which is the figure a handicap bet depends on.
 */
function BbTrackRecordPanel({ league }: { league: string }) {
  const [data, setData] = useState<BbTrackRecord | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    bbApi
      .trackRecord(league)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [league]);

  if (!data || (data.resolved === 0 && data.pending === 0)) return null;
  const thin = data.resolved > 0 && data.resolved < 30;

  return (
    <div className="mt-3 rounded-lg border border-(--line) bg-(--raised) p-3">
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
              <strong className="tabular-nums">{((data.accuracy ?? 0) * 100).toFixed(1)}%</strong> de
              acierto en <strong className="tabular-nums">{data.resolved}</strong> partidos jugados
              {data.marginMae != null && (
                <span className="text-(--ink-soft)"> · error de margen {data.marginMae} pts</span>
              )}
              {thin && <span className="text-amber-400"> · muestra pequeña</span>}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[14px] text-(--ink-faint)">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4 border-t border-(--line) pt-3 text-[14px]">
          <p className="text-(--ink-soft)">
            Cada predicción se guarda <strong>antes</strong> del partido y se puntúa cuando llega el
            resultado real (al ejecutar{' '}
            <code className="rounded bg-(--tint) px-1">npm run update-data:bb</code>). No es el
            backtest histórico: son los partidos que viste aquí.
          </p>
          {data.resolved > 0 && (
            <div className="grid grid-cols-4 gap-x-4 gap-y-3 border-y border-(--line) py-3">
              <Cell label="Acierto" value={`${((data.accuracy ?? 0) * 100).toFixed(1)}%`} />
              <Cell label="Brier" value={data.brier?.toFixed(4) ?? '—'} />
              <Cell label="Error margen" value={data.marginMae != null ? `${data.marginMae} pts` : '—'} />
              <Cell
                label="Sesgo margen"
                value={
                  data.marginBias != null
                    ? `${data.marginBias > 0 ? '+' : ''}${data.marginBias}`
                    : '—'
                }
                hint="+ = sobreestima al local"
              />
            </div>
          )}
          {data.vsMarket && (
            <div>
              <div className="mb-1 uppercase tracking-wide text-(--ink-muted)">
                Modelo vs mercado ({data.vsMarket.n} partidos con cuotas)
              </div>
              <table className="w-full text-left tabular-nums">
                <thead className="text-(--ink-muted)">
                  <tr>
                    <th className="py-1 font-normal">&nbsp;</th>
                    <th className="py-1 font-normal">Acierto</th>
                    <th className="py-1 font-normal">Brier</th>
                  </tr>
                </thead>
                <tbody className="text-(--ink-body)">
                  <tr>
                    <td className="py-1 text-(--ink-soft)">Modelo</td>
                    <td>{fmtPct(data.vsMarket.modelAccuracy)}</td>
                    <td>{data.vsMarket.modelBrier?.toFixed(4) ?? '—'}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-(--ink-soft)">Mercado</td>
                    <td>{fmtPct(data.vsMarket.marketAccuracy)}</td>
                    <td>{data.vsMarket.marketBrier?.toFixed(4) ?? '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {data.recent.length > 0 && (
            <div>
              <div className="mb-1 uppercase tracking-wide text-(--ink-muted)">Últimas resueltas</div>
              <ul className="space-y-1">
                {data.recent.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`mt-[3px] inline-flex ${r.hit ? 'text-emerald-400' : 'text-rose-400'}`} aria-label={r.hit ? 'acertó' : 'falló'}>
                      {r.hit ? <CheckIcon size={15} strokeWidth={2.4} /> : <CrossIcon size={15} strokeWidth={2.4} />}
                    </span>
                    <span className="text-(--ink-body)">
                      {r.away} @ {r.home}
                      <span className="text-(--ink-muted)">
                        {' '}
                        — dijo {fmtPct(Math.max(r.probHome, 1 - r.probHome))} para{' '}
                        {r.probHome >= 0.5 ? r.home : r.away}; acabó {r.awayPts}–{r.homePts}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-(--ink-muted)">{label}</div>
      <div className="tabular-nums text-(--ink-strong)">{value}</div>
      {hint && <div className="text-[11px] text-(--ink-faint)">{hint}</div>}
    </div>
  );
}

function fmtPct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(1)}%`;
}
