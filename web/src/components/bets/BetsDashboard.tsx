import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteBet, deporteDe, fetchBetSummary, fetchBets, patchBet, type Bet, type BetStatus, type BetSummary } from '../../lib/bets';
import { dayLabel, groupByDay } from '../../lib/format';
import { Card, DayHeading, EmptyState, Panel, SkeletonList, pillClass, SeccionDia } from '../ui';
import ExposurePanel from '../ExposurePanel';
import BetCalendar from './BetCalendar';
import ProfitCurve from './ProfitCurve';
import BetForm from './BetForm';
import ImportarCsv from './ImportarCsv';
import { CLAVE_BORRADOR } from '../picks/acciones';
import { useSearchParams } from 'react-router';
import PaperBankroll from './PaperBankroll';
import { Headline, ModelAgreement, Breakdown, DayTotal, BetRow } from './BetsDashboardPartes';
import { SubNav } from '../nav/SubNav';
import { useSubnavApuestas } from '../../pages/subnav';
import { useI18n } from '../../i18n';

/**
 * The bet log.
 *
 * NOT a sixth sport. The five sport tabs show what the MODEL thinks; this shows
 * what YOU did, and the only thing it takes from the models is the probability
 * captured when a bet was logged.
 *
 * The order answers the questions in the order they get asked: how am I doing
 * (the four headline numbers), how did I get here (the curve), which days did it
 * (the calendar), and what exactly did I bet (the list).
 */
export default function BetsDashboard() {
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [summary, setSummary] = useState<BetSummary | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Bet | null>(null);
  // Los dos paneles del banco avisan cuando ya han cargado (L5, lote L).
  const [carteraLista, setCarteraLista] = useState(false);
  const [papelListo, setPapelListo] = useState(false);
  const alListaCartera = useCallback(() => setCarteraLista(true), []);
  const alListoPapel = useCallback(() => setPapelListo(true), []);
  // Abierto mientras cargan los paneles del banco, el formulario va encima de ellos hasta que se
  // cierra (N5, lote N). Debajo, al llegar los paneles, bajaba 500 px y salía de la pantalla con lo
  // escrito dentro, y pasaba siempre al llegar con un borrador desde «Mi selección». Abierto con
  // los paneles ya en pantalla, va donde siempre: después del banco del modelo.
  const [formArriba, setFormArriba] = useState(false);
  // Si no se pueden cargar las apuestas, se dice (N8, lote N). Con la lista vacía salía «Todavía no
  // has registrado ninguna apuesta», que no se sabe: la petición había fallado.
  const [errorCarga, setErrorCarga] = useState(false);
  const [sport, setSport] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Record<string, unknown> | null>(null);
  const [minEdge, setMinEdge] = useState<number | null>(null);
  const [q, setQ] = useSearchParams();
  const { t, idioma } = useI18n();
  const subnav = useSubnavApuestas();
  // Un borrador desde «Mi selección» (Fase 5.15): se abre el formulario con él, una vez.
  useEffect(() => {
    if (q.get('borrador') !== '1') return;
    try {
      const raw = localStorage.getItem(CLAVE_BORRADOR);
      if (raw) setBorrador(JSON.parse(raw) as Record<string, unknown>);
      localStorage.removeItem(CLAVE_BORRADOR);
    } catch {
      // Sin almacenamiento: el formulario sale vacío.
    }
    // Se llega con el borrador: los paneles del banco aún no han cargado.
    setFormArriba(true);
    setAdding(true);
    setQ((prev) => {
      const n = new URLSearchParams(prev);
      n.delete('borrador');
      return n;
    }, { replace: true });
  }, [q, setQ]);
  useEffect(() => {
    fetch('/api/policy').then((r) => (r.ok ? r.json() : null)).then((j: { vigente?: { config?: { staking?: { minEdge?: number } } } } | null) => setMinEdge(j?.vigente?.config?.staking?.minEdge ?? null)).catch(() => undefined);
  }, []);

  const load = useCallback(() => {
    const q: Record<string, string> = sport ? { sport } : {};
    Promise.all([fetchBets(q), fetchBetSummary(q)])
      .then(([b, s]) => {
        setBets(b);
        setSummary(s);
        setErrorCarga(false);
      })
      .catch(() => {
        setBets([]);
        setSummary(null);
        setErrorCarga(true);
      });
  }, [sport]);

  useEffect(load, [load]);

  const shown = useMemo(() => (day ? (bets ?? []).filter((b) => b.placed_on === day) : bets ?? []), [bets, day]);
  const groups = useMemo(() => groupByDay(shown, (b) => `${b.placed_on}T12:00:00`, idioma), [shown, idioma]);

  const settle = async (b: Bet, status: BetStatus) => {
    // A cashout needs an amount the odds cannot supply, so it is only settable
    // from the edit form — see the note in bets.ts.
    if (status === 'cashout') {
      setEditing(b);
      return;
    }
    await patchBet(b.id, { status });
    load();
  };

  const remove = async (b: Bet) => {
    if (!confirm(t('registro.confirmarBorrar', { sel: b.selection, evento: b.event }))) return;
    await deleteBet(b.id);
    load();
  };

  if (bets == null) return <SkeletonList etiqueta={t('comun.cargando')} />;
  // Los dos paneles del banco y el historial salen a la vez, cuando los dos paneles han cargado
  // (L5, lote L). Los paneles no pintan nada mientras cargan, y al llegar empujaban hacia abajo
  // lo que hubiera debajo: el historial, y luego el esqueleto que lo esperaba (0,16 con los datos
  // de verdad). Mientras, cargan ocultos y el esqueleto espera en su sitio.
  const panelesListos = carteraLista && papelListo;
  const formulario = (adding || editing) && (
    <BetForm
      editing={editing}
      borrador={editing ? null : borrador}
      onDone={() => {
        setAdding(false);
        setEditing(null);
        setFormArriba(false);
        setBorrador(null);
        load();
      }}
      onCancel={() => {
        setAdding(false);
        setEditing(null);
        setFormArriba(false);
      }}
    />
  );

  return (
    <div className="space-y-4">
      <SubNav etiqueta={t('nav.subApuestas')} enlaces={subnav} />
      <div>
        <p className="mb-2 text-[15px] leading-relaxed text-(--ink-body)">
          {t('registro.intro')}
        </p>
        {!adding && !editing && (
          <button
            onClick={() => {
              setFormArriba(!(carteraLista && papelListo));
              setAdding(true);
            }}
            className="rounded-lg bg-(--raised-2) px-3.5 py-2 text-[15px] font-medium text-(--ink-strong) ring-1 ring-inset ring-(--line-strong) transition hover:bg-(--raised-3)"
          >
            {t('registro.nueva')}
          </button>
        )}
        {!adding && !editing && (
          <span className="ml-2 inline-block">
            <ImportarCsv onHecho={load} />
          </span>
        )}
      </div>

      {formArriba && formulario}
      {!panelesListos && <SkeletonList count={1} etiqueta={t('comun.cargando')} />}
      <div hidden={!panelesListos} className="space-y-4">
        {/* El sizing de cartera vive aquí y no en la pestaña de fútbol porque es una
            pregunta sobre TU dinero, no sobre un partido: cuánto hay en juego a la vez y
            cuánto riesgo es eso de verdad. */}
        <ExposurePanel onListo={alListaCartera} />

        {/* El banco del modelo va ANTES del formulario y separado del registro propio:
            son dos cuentas distintas y mezclarlas haría imposible leer ninguna de las dos. */}
        <PaperBankroll onListo={alListoPapel} />
      </div>

      {!formArriba && formulario}

      {panelesListos && (
      <>
      {summary && summary.totals.bets > 0 ? (
        <>
          <Card className="p-4">
            <Headline summary={summary} />
            {summary.cumulative.length >= 3 && (
              <Panel>
                <ProfitCurve points={summary.cumulative} />
              </Panel>
            )}
          </Card>

          <Card className="p-4">
            <BetCalendar daily={summary.daily} onPickDay={setDay} selectedDay={day} />
          </Card>

          {summary.modelAgreement && <ModelAgreement summary={summary} />}
          {(summary.bySport.length > 1 || summary.byMarket.length > 1) && <Breakdown summary={summary} />}
        </>
      ) : null}

      {/* Sport filter, only once there is more than one to filter. */}
      {summary && summary.bySport.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button className={pillClass(sport == null)} onClick={() => setSport(null)}>
            {t('registro.todos')}
          </button>
          {summary.bySport.map((g) => (
            <button key={g.key} className={pillClass(sport === g.key)} onClick={() => setSport(g.key)}>
              {deporteDe(t, g.key)} <span className="ml-1 text-(--ink-muted)">{g.bets}</span>
            </button>
          ))}
        </div>
      )}

      {day && (
        <button
          onClick={() => setDay(null)}
          className="text-[14px] text-(--ink-soft) underline decoration-white/20 hover:text-(--ink-strong)"
        >
          {t('registro.viendoSolo', { dia: dayLabel(day, new Date(), idioma) })}
        </button>
      )}

      {errorCarga ? (
        <EmptyState tone="critical" title={t('registro.errorCargar')} />
      ) : bets.length === 0 ? (
        <EmptyState title={t('registro.vacioTitulo')}>
          {t('registro.vacio')}
        </EmptyState>
      ) : (
        groups.map((g) => (
          <SeccionDia key={g.key} clave={g.key}>
            <DayHeading
              label={g.label}
              count={g.items.length}
              right={<DayTotal bets={g.items} />}
            />
            <div className="space-y-2">
              {g.items.map((b) => (
                <BetRow key={b.id} bet={b} minEdge={minEdge} onSettle={settle} onEdit={setEditing} onDelete={remove} />
              ))}
            </div>
          </SeccionDia>
        ))
      )}
      </>
      )}
    </div>
  );
}
