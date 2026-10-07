import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteBet, fetchBetSummary, fetchBets, patchBet, SPORT_LABEL, type Bet, type BetStatus, type BetSummary } from '../../lib/bets';
import { dayLabel, groupByDay } from '../../lib/format';
import { Card, DayHeading, EmptyState, Panel, SkeletonList, pillClass } from '../ui';
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
  const [sport, setSport] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Record<string, unknown> | null>(null);
  const [minEdge, setMinEdge] = useState<number | null>(null);
  const [q, setQ] = useSearchParams();
  const { t } = useI18n();
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
      })
      .catch(() => {
        setBets([]);
        setSummary(null);
      });
  }, [sport]);

  useEffect(load, [load]);

  const shown = useMemo(() => (day ? (bets ?? []).filter((b) => b.placed_on === day) : bets ?? []), [bets, day]);
  const groups = useMemo(() => groupByDay(shown, (b) => `${b.placed_on}T12:00:00`), [shown]);

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
    if (!confirm(`¿Borrar la apuesta «${b.selection}» de ${b.event}?`)) return;
    await deleteBet(b.id);
    load();
  };

  if (bets == null) return <SkeletonList />;

  return (
    <div className="space-y-4">
      <SubNav etiqueta={t('nav.subApuestas')} enlaces={subnav} />
      <div>
        <p className="mb-2 text-[15px] leading-relaxed text-(--ink-body)">
          Tus apuestas: cuánto pusiste, qué volvió y qué días te costaron dinero. Lo que registras
          aquí es tuyo — no sale de ningún modelo, y ningún modelo se puntúa con él.
        </p>
        {!adding && !editing && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-(--raised-2) px-3.5 py-2 text-[15px] font-medium text-(--ink-strong) ring-1 ring-inset ring-(--line-strong) transition hover:bg-(--raised-3)"
          >
            + Registrar apuesta
          </button>
        )}
        {!adding && !editing && (
          <span className="ml-2 inline-block">
            <ImportarCsv onHecho={load} />
          </span>
        )}
      </div>

      {/* El sizing de cartera vive aquí y no en la pestaña de fútbol porque es una
          pregunta sobre TU dinero, no sobre un partido: cuánto hay en juego a la vez y
          cuánto riesgo es eso de verdad. */}
      <ExposurePanel />

      {/* El banco del modelo va ANTES del formulario y separado del registro propio:
          son dos cuentas distintas y mezclarlas haría imposible leer ninguna de las dos. */}
      <PaperBankroll />

      {(adding || editing) && (
        <BetForm
          editing={editing}
          borrador={editing ? null : borrador}
          onDone={() => {
            setAdding(false);
            setEditing(null);
            setBorrador(null);
            load();
          }}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

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
            Todos
          </button>
          {summary.bySport.map((g) => (
            <button key={g.key} className={pillClass(sport === g.key)} onClick={() => setSport(g.key)}>
              {SPORT_LABEL[g.key] ?? g.key} <span className="ml-1 text-(--ink-muted)">{g.bets}</span>
            </button>
          ))}
        </div>
      )}

      {day && (
        <button
          onClick={() => setDay(null)}
          className="text-[14px] text-(--ink-soft) underline decoration-white/20 hover:text-(--ink-strong)"
        >
          Viendo solo {dayLabel(day)} — ver todo
        </button>
      )}

      {bets.length === 0 ? (
        <EmptyState title="Todavía no has registrado ninguna apuesta">
          Pulsa «Registrar apuesta». Si la eliges de un partido próximo, la app guarda también lo
          que pensaban el modelo y el mercado en ese momento, y con el tiempo podrá decirte si
          seguirlo te sirvió.
        </EmptyState>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="seccion-dia">
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
          </section>
        ))
      )}
    </div>
  );
}
