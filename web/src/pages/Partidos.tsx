// Partidos: el explorador canónico (rediseño de noviembre, D1/D2). Una lista de todos los deportes,
// con el deporte, la fecha, la competición, la búsqueda, «Guardados» y el orden en la URL. Las
// pestañas de cada deporte quedan como «Análisis» y se llega desde aquí.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useI18n, localeDe, type Clave } from '../i18n';
import { useFiltrosQuery } from '../lib/rutas';
import { RUTA_AJUSTES, RUTA_DE_PESTANA } from '../rutas';
import { SportIcon } from '../components/icons';
import { SkeletonList } from '../components/ui';
import { useSeguimiento } from '../components/seguimiento';
import FilaPartido from '../components/partidos/FilaPartido';
import { contadorDePeticiones } from '../lib/carga';
import { relativeTime } from '../lib/format';
import type { Idioma } from '../i18n';
import {
  agrupar, contarPorDeporte, diaEn, diaSiguiente, filtrar, hayFiltros, ordenar,
  type Filtros, type Orden, type RespuestaExplorador,
} from '../lib/explorador';
import { leerZona } from '../lib/zona';
import type { DeporteId } from '../lib/partidos';

const DEPORTES: DeporteId[] = ['football', 'basketball', 'baseball', 'nfl', 'nhl', 'ufc', 'tennis'];
const MINIMOS = [0.5, 0.6, 0.7, 0.8];
const REFRESCO_MS = 5 * 60_000;

export default function Partidos() {
  const { t, idioma } = useI18n();
  const locale = localeDe(idioma);
  const [q, setQ] = useFiltrosQuery();
  const zona = leerZona();
  const { seguidos } = useSeguimiento();

  // El estado de la vista, entero en la URL: compartir el enlace abre lo mismo.
  const filtros: Filtros = {
    deporte: DEPORTES.includes(q.get('deporte') as DeporteId) ? (q.get('deporte') as DeporteId) : null,
    liga: q.get('liga'),
    q: q.get('q') ?? '',
    guardados: q.get('guardados') === '1',
    minimo: MINIMOS.includes(Number(q.get('minimo'))) ? Number(q.get('minimo')) : null,
    orden: q.get('orden') === 'prob' ? 'probabilidad' : 'hora',
  };
  const diaParam = q.get('dia');
  const hoy = diaEn(new Date(), zona);
  const manana = diaSiguiente(hoy);
  const dia: string | null = diaParam === 'hoy' ? hoy : diaParam === 'manana' ? manana : diaParam && /^\d{4}-\d{2}-\d{2}$/.test(diaParam) ? diaParam : null;

  // ---- datos ----
  const [datos, setDatos] = useState<RespuestaExplorador | null>(null);
  // De qué día son los datos que se ven: al cambiar de día no se enseñan los del anterior como si fueran de este.
  const [datosDe, setDatosDe] = useState<string | null | undefined>(undefined);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [peticiones] = useState(contadorDePeticiones);
  const [vuelta, setVuelta] = useState(0);
  const pedir = useCallback(() => setVuelta((n) => n + 1), []);

  useEffect(() => {
    const n = peticiones.nueva();
    const ctl = new AbortController();
    setCargando(true);
    const params = new URLSearchParams({ zona });
    if (dia) params.set('dia', dia);
    fetch(`/api/partidos?${params}`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<RespuestaExplorador>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        // T17: solo la última petición escribe; una respuesta tardía de otro día no pisa la actual.
        if (!peticiones.esUltima(n)) return;
        setDatos(j);
        setDatosDe(dia);
        setError(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError' || !peticiones.esUltima(n)) return;
        setError(true);
      })
      .finally(() => peticiones.esUltima(n) && setCargando(false));
    return () => ctl.abort();
  }, [dia, zona, vuelta, peticiones]);

  // Refresco tranquilo cada 5 minutos con la pestaña visible; la lista no se vacía mientras.
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === 'visible' && pedir(), REFRESCO_MS);
    return () => window.clearInterval(id);
  }, [pedir]);

  // «Guardados»: partidos seguidos, partidos de equipos o jugadores seguidos y partidos con una
  // estimación guardada (FAV-3).
  const [conEstimacion, setConEstimacion] = useState<string[]>([]);
  useEffect(() => {
    fetch('/api/guardadas')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { guardadas: { sport: string; match_key: string }[] }) => setConEstimacion(j.guardadas.map((g) => `${g.sport}|${g.match_key}`)))
      .catch(() => setConEstimacion([]));
  }, []);
  const guardados = useMemo(() => {
    const s = new Set<string>(conEstimacion);
    for (const x of seguidos) s.add(x.kind === 'partido' ? `${x.sport}|${x.ref_id}` : `${x.sport}|eq|${x.ref_id}`);
    return s;
  }, [seguidos, conEstimacion]);

  const vigentes = datos && datosDe === dia ? datos : null;
  const filas = useMemo(() => vigentes?.filas ?? [], [vigentes]);
  const visibles = useMemo(() => ordenar(filtrar(filas, filtros, guardados), filtros.orden), [filas, filtros.deporte, filtros.liga, filtros.q, filtros.guardados, filtros.minimo, filtros.orden, guardados]); // eslint-disable-line react-hooks/exhaustive-deps
  const cuentas = useMemo(() => contarPorDeporte(filas, filtros, guardados), [filas, filtros.q, filtros.guardados, filtros.minimo, guardados]); // eslint-disable-line react-hooks/exhaustive-deps
  const ligas = useMemo(() => {
    if (!filtros.deporte) return [];
    const m = new Map<string, string>();
    for (const f of filas) if (f.sport === filtros.deporte && f.liga) m.set(f.liga.id, f.torneo && f.sport === 'tennis' ? f.liga.nombre : f.liga.nombre);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [filas, filtros.deporte]);
  const grupos = useMemo(() => (filtros.orden === 'hora' ? agrupar(visibles, zona) : null), [visibles, filtros.orden, zona]);
  const hayDemo = visibles.some((f) => f.origen === 'demo');
  const errores = vigentes?.porDeporte.filter((d) => d.error) ?? [];

  const nombreDeporte = (d: DeporteId) => t(`deporte.${d}` as Clave);
  const textoFecha = dia === hoy ? t('partidos.fechaHoy') : dia === manana ? t('partidos.fechaManana') : dia ? t('partidos.fechaDia', { dia: fechaLarga(dia, locale) }) : t('partidos.fechaProximos');
  const set = (cambios: Record<string, string | null>) => setQ(cambios);
  const quitarFiltros = () => set({ deporte: null, liga: null, q: null, guardados: null, minimo: null, orden: null });

  // El primer render con datos de otro día enseña el esqueleto, no la lista vieja.
  const inicial = vigentes == null && !error;

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-[24px] font-semibold leading-tight text-(--ink-strong)">{t('partidos.titulo')}</h1>
        <p className="mt-1 text-[14px] text-(--ink-muted)">
          {(filtros.deporte ? nombreDeporte(filtros.deporte) : t('partidos.todos'))} · {textoFecha} ·{' '}
          {t('partidos.zona', { zona })}{' '}
          <Link to={RUTA_AJUSTES + '#zona'} className="underline underline-offset-2 hover:text-(--ink-body)">{t('partidos.cambiarZona')}</Link>
        </p>
      </header>

      <section aria-label={t('partidos.filtros')} className="mb-4 space-y-3">
        {/* Fecha */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('partidos.cuando')}>
          <Chip activo={dia === hoy} onClick={() => set({ dia: 'hoy' })}>{t('partidos.hoy')}</Chip>
          <Chip activo={dia === manana} onClick={() => set({ dia: 'manana' })}>{t('partidos.manana')}</Chip>
          <Chip activo={dia == null} onClick={() => set({ dia: null })}>{t('partidos.proximos')}</Chip>
          <label className="flex items-center gap-2 text-[14px] text-(--ink-muted)">
            <span className="sr-only">{t('partidos.fecha')}</span>
            <input
              type="date"
              value={dia ?? ''}
              onChange={(e) => set({ dia: e.target.value || null })}
              className="h-10 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body) [color-scheme:inherit]"
            />
          </label>
        </div>
        {/* Deporte: solo los que tienen algo con los demás filtros (y el elegido, aunque se quede a 0). */}
        <div className="flex gap-2 overflow-x-auto pb-1 desliza-x [scrollbar-width:thin]" role="group" aria-label={t('partidos.deportes')}>
          <Chip activo={filtros.deporte == null} onClick={() => set({ deporte: null, liga: null })}>
            {t('partidos.todos')} <Cuenta n={cuentas.total ?? 0} />
          </Chip>
          {DEPORTES.filter((d) => (cuentas[d] ?? 0) > 0 || filtros.deporte === d).map((d) => (
            <Chip key={d} activo={filtros.deporte === d} onClick={() => set({ deporte: d, liga: null })}>
              <SportIcon sport={d} size={16} /> {nombreDeporte(d)} <Cuenta n={cuentas[d] ?? 0} />
            </Chip>
          ))}
        </div>
        {/* Búsqueda, competición, guardados y orden. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-[12rem] flex-1">
            <span className="sr-only">{t('partidos.buscar')}</span>
            <input
              type="search"
              value={filtros.q}
              onChange={(e) => set({ q: e.target.value || null })}
              placeholder={t('partidos.buscar')}
              className="h-10 w-full rounded-lg border border-(--line-strong) bg-(--surface-card) px-3 text-[15px] text-(--ink-body) placeholder:text-(--ink-faint)"
            />
          </label>
          {ligas.length > 1 && (
            <label className="flex items-center gap-2 text-[14px] text-(--ink-muted)">
              <span className="sr-only">{t('partidos.liga')}</span>
              <select value={filtros.liga ?? ''} onChange={(e) => set({ liga: e.target.value || null })} className="h-10 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)">
                <option value="">{t('partidos.todasLigas')}</option>
                {ligas.map(([id, nombre]) => (
                  <option key={id} value={id}>{nombre}</option>
                ))}
              </select>
            </label>
          )}
          <Chip activo={filtros.guardados} onClick={() => set({ guardados: filtros.guardados ? null : '1' })} titulo={t('partidos.guardadosNota')}>
            {t('partidos.guardados')}
          </Chip>
        </div>
        <details className="text-[14px] text-(--ink-muted)" open={filtros.minimo != null || filtros.orden !== 'hora' || undefined}>
          <summary className="inline-flex min-h-10 cursor-pointer items-center hover:text-(--ink-body)">{t('partidos.masFiltros')}</summary>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-[14px] text-(--ink-muted)">
            <span>{t('partidos.orden')}</span>
            <select value={filtros.orden} onChange={(e) => set({ orden: (e.target.value as Orden) === 'probabilidad' ? 'prob' : null })} className="h-10 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)">
              <option value="hora">{t('partidos.ordenHora')}</option>
              <option value="probabilidad">{t('partidos.ordenProb')}</option>
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span>{t('partidos.minimo')}</span>
            <select value={filtros.minimo ?? ''} onChange={(e) => set({ minimo: e.target.value || null })} className="h-10 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)">
              <option value="">{t('partidos.sinMinimo')}</option>
              {MINIMOS.map((m) => (
                <option key={m} value={m}>{`≥ ${Math.round(m * 100)} %`}</option>
              ))}
            </select>
          </label>
          </div>
        </details>
      </section>

      {/* Estado: cuántos, de cuándo, y si se está actualizando. Sin bloques de mantenimiento. */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-(--ink-muted)" role="status" aria-live="polite">
        <span>
          {vigentes ? (visibles.length === 1 ? t('partidos.n1') : t('partidos.n', { n: visibles.length })) : cargando ? t('partidos.cargando') : ''}
          {hayFiltros(filtros) && (
            <>
              {' · '}
              <button onClick={quitarFiltros} className="toque underline underline-offset-2 [--toque-y:6px] hover:text-(--ink-body)">{t('partidos.quitarFiltros')}</button>
            </>
          )}
        </span>
        <span>{cargando && vigentes ? t('partidos.actualizando') : vigentes ? t('partidos.actualizado', { cuando: haceCuanto(vigentes.generado, idioma, t) }) : ''}</span>
      </div>
      {filtros.orden === 'probabilidad' && <p className="mb-2 text-[13px] text-(--ink-muted)">{t('partidos.ordenProbNota')}</p>}
      {hayDemo && <p className="mb-2 text-[13px] text-(--status-warning)">{t('partidos.demoNota')}</p>}
      {error && vigentes && (
        <p className="mb-2 text-[13px] text-(--status-critical)">
          {t('partidos.errorConDatos')} <button onClick={pedir} className="toque underline underline-offset-2 [--toque-y:6px]">{t('partidos.reintentar')}</button>
        </p>
      )}
      {errores.map((d) => (
        <p key={d.sport} className="mb-2 text-[13px] text-(--status-critical)">{t('partidos.errorDeporte', { deporte: nombreDeporte(d.sport) })}</p>
      ))}

      {inicial ? (
        <SkeletonList etiqueta={t('partidos.cargando')} />
      ) : error && !vigentes ? (
        <Vacio>
          <p className="font-medium text-(--ink-strong)">{t('partidos.error')}</p>
          <button onClick={pedir} className="mt-3 rounded-lg bg-(--accent) px-4 py-2 text-[14px] font-medium text-(--accent-ink)">{t('partidos.reintentar')}</button>
        </Vacio>
      ) : filas.length === 0 ? (
        <Vacio>
          <p className="font-medium text-(--ink-strong)">{t('partidos.vacio', { fecha: textoFecha })}</p>
          <p className="mt-1">{t('partidos.vacioNota')}</p>
          <p className="mt-3 flex flex-wrap gap-2">
            {dia !== manana && <Chip activo={false} onClick={() => set({ dia: 'manana' })}>{t('partidos.verManana')}</Chip>}
            {dia != null && <Chip activo={false} onClick={() => set({ dia: null })}>{t('partidos.verProximos')}</Chip>}
          </p>
        </Vacio>
      ) : visibles.length === 0 ? (
        <Vacio>
          <p className="font-medium text-(--ink-strong)">
            {filtros.deporte && !filtros.q && !filtros.guardados && filtros.minimo == null
              ? t('partidos.vacioDeporte', { deporte: nombreDeporte(filtros.deporte), fecha: textoFecha })
              : t('partidos.vacioFiltros')}
          </p>
          <p className="mt-1">{t('partidos.vacioFiltrosHay', { n: filas.length })}</p>
          <button onClick={quitarFiltros} className="mt-3 rounded-lg border border-(--line-strong) px-4 py-2 text-[14px] text-(--ink-body) hover:bg-(--raised)">{t('partidos.quitarFiltros')}</button>
        </Vacio>
      ) : grupos ? (
        <div aria-label={t('partidos.lista')}>
          {grupos.map((d) => (
            <section key={d.dia} className="mb-5">
              {(dia == null || grupos.length > 1) && (
                <h2 className="sticky top-[var(--header-h,0px)] z-20 -mx-1 mb-1 bg-(--surface-page)/95 px-1 py-2 text-[13px] font-semibold uppercase tracking-wide text-(--ink-muted) backdrop-blur lg:top-0">
                  {d.dia === hoy ? `${t('partidos.hoy')} · ` : d.dia === manana ? `${t('partidos.manana')} · ` : ''}
                  {fechaLarga(d.dia, locale)}
                </h2>
              )}
              {d.grupos.map((g) => (
                <section key={g.clave} className="mb-3 rounded-xl bg-(--surface-card) px-2 pt-2 sm:px-3">
                  <h3 className="flex items-center gap-2 px-1 pb-1 text-[14px] font-medium text-(--ink-body)">
                    <SportIcon sport={g.sport} size={16} />
                    <span className="min-w-0 truncate">{g.titulo}</span>
                    <span className="ml-auto shrink-0 text-[12px] font-normal text-(--ink-muted)">{etiquetaMercado(g.filas[0], t)}</span>
                  </h3>
                  <ul>
                    {g.filas.map((f) => (
                      <FilaPartido key={`${f.sport}|${f.id}`} f={f} zona={zona} locale={locale} />
                    ))}
                  </ul>
                </section>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <ul aria-label={t('partidos.lista')} className="rounded-xl bg-(--surface-card) px-2 sm:px-3">
          {visibles.map((f) => (
            <FilaPartido key={`${f.sport}|${f.id}`} f={f} zona={zona} locale={locale} />
          ))}
        </ul>
      )}

      {filtros.deporte && (
        <p className="mt-6 text-[14px]">
          <Link to={RUTA_DE_PESTANA[filtros.deporte]} className="font-medium text-(--ink-body) underline underline-offset-2 hover:text-(--ink-strong)">
            {t('partidos.analisis', { deporte: nombreDeporte(filtros.deporte) })} →
          </Link>{' '}
          <span className="text-(--ink-muted)">{t('partidos.analisisNota')}</span>
        </p>
      )}
    </div>
  );
}

/** «ahora mismo» o «hace 5 min»: nunca «en 0 min» por un reloj un poco adelantado. */
function haceCuanto(iso: string, idioma: Idioma, t: ReturnType<typeof useI18n>['t']): string {
  const ms = Date.now() - Date.parse(iso);
  if (!(ms > 60_000)) return t('partidos.ahora');
  return relativeTime(iso, new Date(), idioma);
}

function etiquetaMercado(f: RespuestaExplorador['filas'][number], t: ReturnType<typeof useI18n>['t']): string {
  const m = f.mercado.resultados.length === 3 ? t('partidos.mercado1x2') : f.mercado.prorroga === 'incluida' ? t('partidos.mercadoGanadorProrroga') : t('partidos.mercadoGanador');
  return f.sede === 'local' ? `${m} · ${t('partidos.localArriba')}` : m;
}

/** «jueves, 20 de noviembre» de un día YYYY-MM-DD, sin que la zona lo mueva. */
function fechaLarga(dia: string, locale: string): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function Chip({ activo, onClick, children, titulo }: { activo: boolean; onClick: () => void; children: React.ReactNode; titulo?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      title={titulo}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[14px] font-medium transition ${
        activo ? 'bg-(--accent-soft) text-(--ink-strong) ring-1 ring-(--accent)' : 'text-(--ink-soft) ring-1 ring-(--line-strong) hover:bg-(--raised) hover:text-(--ink-body)'
      }`}
    >
      {children}
    </button>
  );
}

function Cuenta({ n }: { n: number }) {
  return <span className="tabular-nums text-(--ink-muted)">{n}</span>;
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl bg-(--surface-card) p-5 text-[15px] text-(--ink-muted)">{children}</div>;
}

