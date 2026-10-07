import { useEffect, useMemo, useRef, useState } from 'react';
import { reportClientLatency } from '../../lib/liveOdds';
import {
  pillClass, SkeletonList, TeamCrest, DayFilter, DayHeading, StaleHistoryWarning, PicksPanel, DashboardHeader,
  EmptySlate, LeagueFlag, SlateTable, VacioPorqueNoHayCuotas} from '../ui';
import { staleLabel, staleness } from '../../lib/staleness';
import { CAVEATS, rankPicks, footballPicks } from '../../lib/picks';
import { footballSlate } from '../../lib/slate';
import { useStake } from '../../lib/useStake';
import {
  fbApi,
  type FbFixtureWithPrediction,
  type FbLeague,
  type FbMeta,
  type FbPowerTeam,
} from '../../lib/football';
import MatchCard from './MatchCard';
import EloRanking from '../EloRanking';
import { dayChipLabel, groupByDay } from '../../lib/format';
import { useNavigate } from 'react-router';
import { rutaEquipo } from '../../rutas';
import { useLigaEnRuta, ligaRecordada, useFiltroQuery } from '../../lib/rutas';
import { TrackRecordPanel } from './FootballDashboardPartes';

/**
 * The ⚽ tab.
 *
 * Leagues are SUB-TABS inside this tab rather than one long list, because a
 * combined feed of the Premier League, LaLiga, MLS and the Brasileirão is not
 * something anyone reads top to bottom — you come here for one competition. The
 * chosen league is remembered, so reopening lands where you left off.
 */
const STORAGE_KEY = 'predictor.football.league';

export default function FootballDashboard() {
  const [meta, setMeta] = useState<FbMeta | null>(null);
  const [leagues, setLeagues] = useState<FbLeague[]>([]);
  const [league, setLeague] = useLigaEnRuta('/futbol', STORAGE_KEY);
  const [fixtures, setFixtures] = useState<FbFixtureWithPrediction[]>([]);
  const [power, setPower] = useState<FbPowerTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  // Un equipo abre su página (Fase 5.12): una URL, no un modal.
  const setTeam = (t: { league: string; id: string }) => navigate(rutaEquipo('football', t.league, t.id));
  const [refreshing, setRefreshing] = useState(false);
  // null = every day, which is the default: someone who has not asked to filter
  // should see the whole schedule.
  const [day, setDay] = useFiltroQuery('dia');
  /**
   * Cuándo llegó la respuesta, para poder medir lo que tarda en verse.
   *
   * Un ref y no un estado a propósito: guardarlo en estado provocaría el render que
   * intenta medir, y la medición se perseguiría a sí misma.
   */
  const arrivedAt = useRef<number | null>(null);

  useEffect(() => {
    Promise.all([fbApi.meta(), fbApi.leagues()])
      .then(([m, l]) => {
        setMeta(m);
        setLeagues(l);
      })
      .catch((e) =>
        setError(`No se pudo cargar el fútbol. ¿Ejecutaste "npm run update-data:fb"? (${e})`),
      );
  }, []);

  // Only offer leagues that have something to show.
  const selectable = useMemo(
    () => leagues.filter((l) => l.hasUpcoming || l.matches > 0),
    [leagues],
  );

  useEffect(() => {
    // Hasta que no llegan las ligas no se toca la URL: un enlace profundo no puede perderse
    // en el primer render.
    if (leagues.length === 0) return;
    if (league && selectable.some((l) => l.id === league)) return;
    const saved = ligaRecordada(STORAGE_KEY);
    // `saved &&` would yield the empty string when nothing is stored, so the
    // lookup is written as an explicit null to keep the type a league or null.
    const remembered = saved ? selectable.find((l) => l.id === saved) : undefined;
    const pick = remembered ?? selectable.find((l) => l.hasUpcoming) ?? selectable[0];
    setLeague(pick?.id ?? null);
  }, [selectable, league, leagues.length, setLeague]);

  useEffect(() => {
    if (!league) return;
    setLoading(true);
    Promise.all([fbApi.upcoming(league), fbApi.power(league, 40)])
      .then(([f, p]) => {
        // La etapa «cliente» empieza AQUÍ: la respuesta ya está parseada y lo que queda
        // por medir es lo único que el servidor no puede ver — React montando las
        // tarjetas y el navegador pintándolas.
        arrivedAt.current = performance.now();
        setFixtures(f);
        setPower(p.teams);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [league]);

  /**
   * Cerrar la medición cuando esto está de verdad en pantalla.
   *
   * Dos `requestAnimationFrame` anidados y no uno: el primero se ejecuta ANTES del
   * pintado del fotograma, así que medir ahí daría un número sistemáticamente corto. El
   * segundo corre ya en el fotograma siguiente, o sea después de que el usuario lo haya
   * visto — que es lo que dice medir esta etapa.
   */
  useEffect(() => {
    const started = arrivedAt.current;
    if (started == null) return;
    arrivedAt.current = null;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => reportClientLatency(started, { sport: 'football' }));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [fixtures]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await fbApi.refresh();
      const [m, l, f] = await Promise.all([
        fbApi.meta(),
        fbApi.leagues(),
        league ? fbApi.upcoming(league) : Promise.resolve([]),
      ]);
      setMeta(m);
      setLeagues(l);
      setFixtures(f);
    } catch (e) {
      setError(`No se pudo actualizar: ${e}`);
    } finally {
      setRefreshing(false);
    }
  }

  // Grouped by the reader's own local day, and filtered to one of them if asked.
  const dayGroups = useMemo(
    () => groupByDay(fixtures, (f) => f.fixture.commence_time),
    [fixtures],
  );
  const dayChips = useMemo(
    () => dayGroups.map((d) => ({ key: d.key, label: dayChipLabel(d.key), count: d.items.length })),
    [dayGroups],
  );
  const shownGroups = day ? dayGroups.filter((d) => d.key === day) : dayGroups;

  // Ranked markets, from the rows already fetched. Recomputed only when those
  // change: it is pure arithmetic over what is on screen, no extra request.
  const picks = useMemo(() => rankPicks(footballPicks(fixtures)), [fixtures]);
  const [stake, setStake] = useStake();
  // Every price on screen invented by this app rather than fetched — see picks.ts.
  const slate = useMemo(() => footballSlate(fixtures), [fixtures]);
  const demoOdds = fixtures.length > 0 && fixtures.every((r) => r.fixture.source === 'fixture');
  // A day that no longer exists after switching league would filter everything
  // away and look like "no fixtures", so the choice is dropped rather than kept.
  useEffect(() => {
    if (day && !dayGroups.some((d) => d.key === day)) setDay(null);
  }, [dayGroups, day]);

  const active = leagues.find((l) => l.id === league) ?? null;
  const activeMeta = meta?.leagues.find((l) => l.id === league) ?? null;

  // Computed once: the collapsed header needs the short version and the
  // expanded one the full paragraph, and they must be the same judgement.
  const stale = staleness('football', activeMeta?.historyThrough, meta?.dataSource === 'seed');

  return (
    <div>
      <DashboardHeader
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshTitle="Vuelve a consultar los partidos próximos y sus cuotas"
        chips={meta && (<>{meta.counts.matches.toLocaleString('es')} partidos · {meta.counts.teams} equipos</>)}
        alert={staleLabel(stale)}
      >
          <p className="max-w-prose text-[15px] leading-relaxed text-(--ink-soft)">
            Predicción 1X2, goles y marcadores con Elo por equipo, ventaja de campo y odds del
            mercado.
          </p>
        <StaleHistoryWarning
          info={stale}
          what="Los Elo y los goles esperados"
          fix="npm run update-data:fb"
        />
        {league && <TrackRecordPanel league={league} />}
      </DashboardHeader>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-3 text-[15px] text-rose-200">
          {error}
        </div>
      )}

      {/* ---- LEAGUE SUB-TABS ---- */}
      {selectable.length > 0 ? (
        <nav
          // UNA FILA QUE SE DESLIZA EN EL MÓVIL, no nueve que se apilan.
          //
          // Con 17 ligas, `flex-wrap` en una pantalla de 390 px produce nueve filas de
          // pastillas: 700 píxeles de selector —más de una pantalla entera— antes de
          // llegar al primer partido. El selector acababa siendo el contenido.
          //
          // En ancho de teléfono se convierte en una sola fila con desplazamiento
          // horizontal; desde `sm` vuelve a envolver, porque ahí caben en dos filas y
          // verlas todas de golpe sí ayuda a elegir. `snap` para que al soltar el dedo
          // quede una pastilla entera a la vista y no cortada por la mitad.
          className="mb-4 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
          role="tablist" aria-label="Ligas">
          {selectable.map((l) => {
            const on = league === l.id;
            return (
              <button
                key={l.id}
                role="tab"
                aria-selected={on}
                onClick={() => setLeague(l.id)}
                title={l.label}
                className={pillClass(on)}
              >
                <LeagueFlag country={l.country} className="mr-1.5" />
              {l.name}
                {l.upcomingCount > 0 && <span className="ml-1.5 opacity-60">{l.upcomingCount}</span>}
                {!l.hasModel && (
                  <span className="ml-1.5 text-amber-400" title="Sin modelo Elo: solo mercado">
                    ◦
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      ) : (
        <div className="mb-6 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] p-5 text-[15px] text-rose-200">
          <p className="font-medium">No hay datos de fútbol todavía.</p>
          <p className="mt-1 text-rose-300/90">
            Ejecuta <code className="rounded bg-rose-900/40 px-1">npm run update-data:fb</code> para
            descargar equipos, resultados y partidos próximos.
          </p>
        </div>
      )}

      {active && !active.hasModel && (
        <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-[15px] leading-relaxed text-amber-200/90">
          <strong>{active.name} sin modelo Elo.</strong> Sus equipos vienen de ligas distintas y sus
          ratings viven en cada tabla doméstica, así que un Elo compartido necesitaría una
          calibración entre ligas que esta app no hace. Se muestran los partidos y las
          probabilidades <em>del mercado</em>.
        </div>
      )}

      <StaleHistoryWarning
        info={staleness('football', activeMeta?.historyThrough, meta?.dataSource === 'seed')}
        what="Los Elo y los goles esperados"
        fix="npm run update-data:fb"
      />
      {league && <TrackRecordPanel league={league} />}

      {/* The ranked-markets panel. Built from the SAME rows the cards below render,
          so the two can never disagree about a number. */}
      <PicksPanel {...picks} caveat={CAVEATS.football} demoOdds={demoOdds} stake={stake} onStakeChange={setStake} />

      <SlateTable rows={slate} demoOdds={demoOdds} refrescadas={meta?.oddsRefreshedAt} bands={meta?.bands} />

      {fixtures.length === 0 && !loading && (
        <VacioPorqueNoHayCuotas
          reason={meta?.oddsFallbackReason}
          detail={meta?.oddsFallbackDetail}
          hasKey={meta?.hasOddsKey ?? false}
          demoFixtures={meta?.demoFixtures ?? true}
        />
      )}

      {loading ? (
        <SkeletonList />
      ) : fixtures.length === 0 ? (
        <EmptySlate what={active?.name ?? 'esta liga'} reason="sin-partidos" />
      ) : (
        <>
          <DayFilter days={dayChips} selected={day} onSelect={setDay} />
          {shownGroups.map((group) => (
            <section key={group.key} className="seccion-dia mb-6">
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
                {group.items.map((f) => (
                  <MatchCard
                    key={f.fixture.id}
                    item={f}
                    onOpenTeam={(lg, id) => setTeam({ league: lg, id })}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {/* All teams in the league, ranked by Elo */}
      <EloRanking
        title={`Todos los equipos · ${active?.name ?? ''}`}
        rows={power.map((t) => ({
          id: t.id,
          name: t.name,
          elo: t.elo,
          matches: t.matches,
          badge: <TeamCrest league={league!} name={t.name} code={t.id} size={16} />,
          onOpen: () => setTeam({ league: league!, id: t.id }),
          extra: [
            { label: 'GF', value: t.gf?.toFixed(2) ?? '—', title: 'Goles a favor por partido' },
            { label: 'GC', value: t.ga?.toFixed(2) ?? '—', title: 'Goles en contra por partido' },
            {
              label: 'Dif.',
              value:
                t.gf != null && t.ga != null
                  ? `${t.gf - t.ga > 0 ? '+' : ''}${(t.gf - t.ga).toFixed(2)}`
                  : '—',
              title: 'Diferencia de goles por partido',
            },
          ],
        }))}
        extraHeaders={['GF', 'GC', 'Dif.']}
        footer={
          <>
            El Elo sale de los resultados, no de la clasificación: gana puntos quien gana a
            rivales fuertes y los pierde quien pierde con débiles, así que un equipo puede ir
            quinto en la tabla y primero aquí. Los goles a favor y en contra son por partido.
          </>
        }
      />
    </div>
  );
}
