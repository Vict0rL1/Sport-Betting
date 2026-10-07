import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { rutaJugador } from '../rutas';
import { useLigaEnRuta, ligaRecordada, useFiltroQuery } from '../lib/rutas';
import {
  api,
  type Meta,
  type Tour,
  type TournamentInfo,
  type UpcomingWithPrediction,
} from '../lib/api';
import MatchCard from './MatchCard';
import TrackRecordPanel from './TrackRecordPanel';
import TennisEloPanel from './TennisEloPanel';
import {
  DayFilter, DayHeading, pillClass, StaleHistoryWarning, PicksPanel, DashboardHeader,
  EmptySlate, SlateTable, VacioPorqueNoHayCuotas,
} from './ui';
import AskPanel from './AskPanel';
import { staleLabel, staleness } from '../lib/staleness';
import { CAVEATS, rankPicks, tennisPicks } from '../lib/picks';
import { tennisSlate } from '../lib/slate';
import { useStake } from '../lib/useStake';
import { dayChipLabel, groupByDay } from '../lib/format';
import { RefreshInfo, DataBadge, ShortSlateNote } from './TennisDashboardPartes';

export default function TennisDashboard() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [tours, setTours] = useState<Tour[]>([]);
  const [tournaments, setTournaments] = useState<TournamentInfo[]>([]);
  // El tour va en la ruta (/tenis/atp) y el torneo en la query (?torneo=): un enlace copiado
  // abre lo mismo.
  const [tourRuta, setTour] = useLigaEnRuta('/tenis', 'predictor.tennis.tour');
  const tour = tourRuta ?? ligaRecordada('predictor.tennis.tour') ?? 'atp';
  const [tournamentId, setTournamentId] = useFiltroQuery('torneo');
  const [matches, setMatches] = useState<UpcomingWithPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  // Un jugador abre su página (Fase 5.12).
  const setProfile = (x: { tour: string; id: number }) => navigate(rutaJugador(x.tour, x.id));
  const [refreshing, setRefreshing] = useState(false);
  // null = every day. See the note in the other dashboards.
  const [day, setDay] = useFiltroQuery('dia');

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await api.refresh();
      const [m, tt, up] = await Promise.all([
        api.meta(),
        api.tournaments(tour),
        api.upcoming(tour, tournamentId ?? undefined),
      ]);
      setMeta(m);
      setTournaments(tt.tournaments);
      setMatches(up);
    } catch (e) {
      setError(`No se pudo actualizar: ${e}`);
    } finally {
      setRefreshing(false);
    }
  }

  // Initial load: meta + tours.
  useEffect(() => {
    Promise.all([api.meta(), api.tours()])
      .then(([m, t]) => {
        setMeta(m);
        setTours(t);
      })
      .catch((e) => setError(`No se pudo conectar con la API. ¿Corriste "npm run seed"? (${e})`));
  }, []);

  // Tournaments depend on the selected tour (only those with upcoming matches).
  useEffect(() => {
    api
      .tournaments(tour)
      .then((tt) => setTournaments(tt.tournaments))
      .catch((e) => setError(String(e)));
  }, [tour]);

  // Tournaments that actually have upcoming matches for the selected tour.
  const dayGroups = useMemo(
    () => groupByDay(matches, (m) => m.match.commence_time),
    [matches],
  );
  const dayChips = useMemo(
    () => dayGroups.map((d) => ({ key: d.key, label: dayChipLabel(d.key), count: d.items.length })),
    [dayGroups],
  );
  const shownGroups = day ? dayGroups.filter((d) => d.key === day) : dayGroups;

  // Ranked markets, from the rows already fetched. Recomputed only when those
  // change: it is pure arithmetic over what is on screen, no extra request.
  const picks = useMemo(() => rankPicks(tennisPicks(matches)), [matches]);
  const slate = useMemo(() => tennisSlate(matches), [matches]);
  const [stake, setStake] = useStake();
  // Every price on screen invented by this app rather than fetched — see picks.ts.
  const demoOdds = matches.length > 0 && matches.every((r) => r.match.source === 'fixture');
  useEffect(() => {
    if (day && !dayGroups.some((d) => d.key === day)) setDay(null);
  }, [dayGroups, day]);

  const tourTournaments = useMemo(
    () => tournaments.filter((t) => t.tours.includes(tour) && t.hasUpcoming),
    [tournaments, tour],
  );

  // Keep a valid tournament selected when the tour changes.
  useEffect(() => {
    if (tourTournaments.length === 0) {
      setTournamentId(null);
    } else if (!tourTournaments.some((t) => t.id === tournamentId)) {
      setTournamentId(tourTournaments[0].id);
    }
  }, [tourTournaments, tournamentId]);

  // Load matches for tour + tournament.
  useEffect(() => {
    if (!tournamentId) {
      setMatches([]);
      return;
    }
    setLoading(true);
    api
      .upcoming(tour, tournamentId)
      .then((m) => setMatches(m))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [tour, tournamentId]);

  // Computed once: the collapsed header needs the short version and the expanded
  // one the full paragraph, and they must be the same judgement.
  const stale = staleness('tennis', meta?.historyThrough, meta?.dataSource === 'seed');

  return (
    <div>
      <DashboardHeader
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshTitle="Vuelve a consultar las odds de los partidos próximos"
        chips={meta && <>{meta.counts.matches.toLocaleString('es')} partidos · {meta.counts.players} jugadores</>}
        alert={staleLabel(stale)}
      >
          <p className="max-w-prose text-[15px] leading-relaxed text-(--ink-soft)">
            Predicción de partidos con Elo por superficie, forma reciente, head-to-head y odds del
            mercado.
          </p>
        {meta && <div className="mt-2"><DataBadge meta={meta} /></div>}
        {meta && <RefreshInfo meta={meta} />}
        <StaleHistoryWarning
          info={stale}
          what="Los Elo por superficie"
          fix="npm run update-data"
        />
        <TrackRecordPanel tour={tour} />
      </DashboardHeader>

      {/* The ranked-markets panel. Built from the SAME rows the cards below
          render, so the two can never disagree about a number. */}
      <PicksPanel {...picks} caveat={CAVEATS.tennis} demoOdds={demoOdds} stake={stake} onStakeChange={setStake} />

      <SlateTable rows={slate} demoOdds={demoOdds} refrescadas={meta?.oddsRefreshedAt} bands={meta?.bands} />

      <AskPanel />

      {matches.length === 0 && !loading && (
        <VacioPorqueNoHayCuotas
          reason={meta?.oddsFallbackReason}
          detail={meta?.oddsFallbackDetail}
          hasKey={meta?.hasOddsKey ?? false}
          demoFixtures={meta?.demoFixtures ?? true}
        />
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-[16px] text-rose-300">
          {error}
        </div>
      )}

      {/* Tour selector */}
      <div className="mb-4 flex gap-2">
        {tours.map((t) => (
          <button
            key={t.id}
            onClick={() => setTour(t.id)}
            className={pillClass(tour === t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Tournament selector */}
      {tourTournaments.length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {tourTournaments.map((t) => (
            <button
              key={t.id}
              onClick={() => setTournamentId(t.id)}
              className={pillClass(tournamentId === t.id)}
            >
              {t.name}
              <span className="ml-1.5 opacity-60">{t.upcomingCount}</span>
            </button>
          ))}
        </div>
      ) : meta && meta.counts.matches === 0 ? (
        <div className="mb-6 rounded-lg border border-rose-800/60 bg-rose-950/40 p-4 text-[16px] text-rose-200">
          <p className="font-medium">La base de datos está vacía.</p>
          <p className="mt-1 text-rose-300/90">
            Ejecuta <code className="rounded bg-rose-900/40 px-1">npm run update-data</code> para
            descargar el historial real, o{' '}
            <code className="rounded bg-rose-900/40 px-1">npm run seed</code> para ver la app con
            datos de ejemplo.
          </p>
        </div>
      ) : (
        <EmptySlate
          what={tour.toUpperCase()}
          reason={(meta?.byTour?.[tour]?.matches ?? 1) === 0 ? 'sin-fuente' : 'sin-partidos'}
          detail={
            (meta?.byTour?.[tour]?.matches ?? 1) === 0 ? (
              <>
                <p>
                  No es un fallo de descarga: las dos fuentes de tenis que había en GitHub dejaron de
                  servir este circuito.{' '}
                  <code className="rounded bg-(--raised) px-1">JeffSackmann/tennis_wta</code>{' '}
                  devuelve 404 —el repositorio ya no existe— y{' '}
                  <code className="rounded bg-(--raised) px-1">Tennismylife</code>, que lo
                  reemplazó, solo cubre ATP.
                </p>
                <p className="mt-1.5">
                  Lo que sí llega a la temporada en curso es{' '}
                  <strong className="text-(--ink-soft)">tennis-data.co.uk</strong>, con ATP y WTA y
                  además con las cuotas de cierre.{' '}
                  <code className="rounded bg-(--raised) px-1">npm run update-data</code> ya lo
                  intenta solo; desde una red que no lo bloquee debería completar este circuito sin
                  que toques nada.
                </p>
              </>
            ) : undefined
          }
        />
      )}

      {/* Matches */}
      {loading ? (
        <p className="text-(--ink-muted)">Cargando partidos…</p>
      ) : (
        <>
          <DayFilter days={dayChips} selected={day} onSelect={setDay} />
          <ShortSlateNote matches={matches} meta={meta} />
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
                {group.items.map((m) => (
                  <MatchCard
                    key={m.match.id}
                    item={m}
                    onOpenPlayer={(t, id) => setProfile({ tour: t, id })}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      <TennisEloPanel tour={tour} onOpenPlayer={(t, id) => setProfile({ tour: t, id })} />
    </div>
  );
}
