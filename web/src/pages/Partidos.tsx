// Partidos: el explorador canónico (rediseño de noviembre, D1/D2). Una lista de todos los deportes,
// con el deporte, la fecha, la competición, la búsqueda, «Guardados» y el orden en la URL. Las
// pestañas de cada deporte quedan como «Análisis» y se llega desde aquí.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useI18n, localeDe, type Clave } from '../i18n';
import { useFiltrosQuery } from '../lib/rutas';
import { RUTA_AJUSTES, RUTA_DE_PESTANA, RUTA_GUARDADAS, rutaPartido } from '../rutas';
import { SportIcon } from '../components/icons';
import { SkeletonList } from '../components/ui';
import { useSeguimiento } from '../components/seguimiento';
import { useGuardadas } from '../components/guardadas';
import { conProblema, datosDe as datosRemotos } from '../lib/remoto';
import FilaPartido from '../components/partidos/FilaPartido';
import PanelPartido from '../components/partidos/PanelPartido';
import { contadorDePeticiones } from '../lib/carga';
import { relativeTime } from '../lib/format';
import type { Idioma } from '../i18n';
import {
  agrupar, contarPorDeporte, diaEn, diaSiguiente, filtrar, hayFiltros, ordenar,
  type Filtros, type Orden, type RespuestaExplorador,
} from '../lib/explorador';
import { leerZona } from '../lib/zona';
import { guardarDensidad, leerDensidad, type Densidad } from '../lib/densidad';
import { ErrorDeVista, guardarVista, leerVistas, quitarVista, renombrarVista, type Vista } from '../lib/vistas';
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
    seguidos: q.get('seguidos') === '1',
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
  // Densidad de la lista (fase C): preferencia de este navegador, aparte de los filtros.
  const [densidad, setDensidadState] = useState<Densidad>(leerDensidad);
  const setDensidad = (d: Densidad) => {
    setDensidadState(d);
    guardarDensidad(d);
  };
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
  // estimación guardada (FAV-3). La lista de guardadas es la compartida (B3): si no se pudo leer, se
  // dice en vez de filtrar en silencio con una lista incompleta.
  const { estado: estadoGuardadas, recargar: recargarGuardadas } = useGuardadas();
  const guardadas = datosRemotos(estadoGuardadas);
  const guardados = useMemo(() => {
    const s = new Set<string>((guardadas ?? []).map((g) => `${g.sport}|${g.match_key}`));
    for (const x of seguidos) s.add(x.kind === 'partido' ? `sig|${x.sport}|${x.ref_id}` : `sig|${x.sport}|eq|${x.ref_id}`);
    return s;
  }, [seguidos, guardadas]);

  const vigentes = datos && datosDe === dia ? datos : null;
  const filas = useMemo(() => vigentes?.filas ?? [], [vigentes]);
  const visibles = useMemo(() => ordenar(filtrar(filas, filtros, guardados), filtros.orden), [filas, filtros.deporte, filtros.liga, filtros.q, filtros.guardados, filtros.seguidos, filtros.minimo, filtros.orden, guardados]); // eslint-disable-line react-hooks/exhaustive-deps
  const cuentas = useMemo(() => contarPorDeporte(filas, filtros, guardados), [filas, filtros.q, filtros.guardados, filtros.seguidos, filtros.minimo, guardados]); // eslint-disable-line react-hooks/exhaustive-deps
  const ligas = useMemo(() => {
    if (!filtros.deporte) return [];
    const m = new Map<string, string>();
    for (const f of filas) if (f.sport === filtros.deporte && f.liga) m.set(f.liga.id, f.liga.nombre);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [filas, filtros.deporte]);
  // La competición activa, con su nombre si alguna fila lo da; si no (un enlace a una competición sin
  // partidos en esta fecha), su id tal cual: se ve y se puede quitar (B4).
  const nombreLiga = filtros.liga ? (ligas.find(([id]) => id === filtros.liga)?.[1] ?? filtros.liga) : null;
  // Las etiquetas de los filtros activos que no son la fecha ni el deporte (que ya se ven arriba).
  const activos: { clave: string; texto: string; quitar: Record<string, null> }[] = [];
  if (filtros.liga && nombreLiga) activos.push({ clave: 'liga', texto: t('partidos.chipLiga', { liga: nombreLiga }), quitar: { liga: null } });
  if (filtros.q.trim()) activos.push({ clave: 'q', texto: t('partidos.chipBusqueda', { q: filtros.q.trim() }), quitar: { q: null } });
  if (filtros.guardados) activos.push({ clave: 'guardados', texto: t('partidos.guardados'), quitar: { guardados: null } });
  if (filtros.seguidos) activos.push({ clave: 'seguidos', texto: t('partidos.seguidos'), quitar: { seguidos: null } });
  if (filtros.minimo != null) activos.push({ clave: 'minimo', texto: t('partidos.chipMinimo', { p: Math.round(filtros.minimo * 100) }), quitar: { minimo: null } });
  if (filtros.orden !== 'hora') activos.push({ clave: 'orden', texto: t('partidos.ordenProb'), quitar: { orden: null } });
  const grupos = useMemo(() => (filtros.orden === 'hora' ? agrupar(visibles, zona) : null), [visibles, filtros.orden, zona]);
  const hayDemo = visibles.some((f) => f.origen === 'demo');
  const errores = vigentes?.porDeporte.filter((d) => d.error) ?? [];

  const nombreDeporte = (d: DeporteId) => t(`deporte.${d}` as Clave);
  const textoFecha = dia === hoy ? t('partidos.fechaHoy') : dia === manana ? t('partidos.fechaManana') : dia ? t('partidos.fechaDia', { dia: fechaLarga(dia, locale) }) : t('partidos.fechaProximos');
  // Los cambios discretos se apilan en el historial (atrás los deshace); la búsqueda reemplaza.
  const set = (cambios: Record<string, string | null>) => setQ(cambios, { apilar: true });
  const setBusqueda = (q: string | null) => setQ({ q });
  const quitarFiltros = () => set({ deporte: null, liga: null, q: null, guardados: null, seguidos: null, minimo: null, orden: null });

  // El primer render con datos de otro día enseña el esqueleto, no la lista vieja.
  const inicial = vigentes == null && !error;

  // El panel lateral (D2): en pantallas anchas, abrir un partido no saca de la lista. Va en la URL
  // (?panel=deporte:id&panelClave=…), así que «atrás» lo cierra y el enlace se comparte.
  const panel = q.get('panel');
  const [panelSport, ...panelResto] = (panel ?? '').split(':');
  const panelId = panelResto.join(':');
  const panelValido = panel != null && DEPORTES.includes(panelSport as DeporteId) && panelId !== '';
  const navegar = useNavigate();
  const [abiertoAqui, setAbiertoAqui] = useState(false);
  const abrirEnPanel = (f: RespuestaExplorador['filas'][number]) => {
    if (typeof window === 'undefined' || !window.matchMedia?.('(min-width: 1280px)').matches) return false;
    setAbiertoAqui(true);
    setQ({ panel: `${f.sport}:${f.id}`, panelClave: f.matchKey }, { apilar: true });
    return true;
  };
  const cerrarPanel = () => {
    // Si se abrió desde la lista, cerrar es volver atrás (la entrada del panel no se queda en el
    // historial); si llegó en el enlace, se quita de la URL y el foco va al título (no hay fila de
    // la que venir).
    if (abiertoAqui) {
      setAbiertoAqui(false);
      navegar(-1);
    } else {
      setQ({ panel: null, panelClave: null });
      window.setTimeout(() => document.querySelector<HTMLElement>('main h1')?.focus(), 0);
    }
  };
  // Por debajo de 1280 px no hay panel: un enlace con ?panel= o una ventana que se estrecha con él
  // abierto pasan a la página completa del partido.
  useEffect(() => {
    if (!panelValido || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const aPagina = () => {
      if (!mq.matches) navegar(rutaPartido(panelSport, panelId) + (q.get('panelClave') ? `?clave=${encodeURIComponent(q.get('panelClave')!)}` : ''), { replace: true });
    };
    aPagina();
    mq.addEventListener('change', aPagina);
    return () => mq.removeEventListener('change', aPagina);
  }, [panelValido, panelSport, panelId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <header className="mb-4">
        <h1 tabIndex={-1} className="text-[24px] font-semibold leading-tight text-(--ink-strong) outline-none">{t('partidos.titulo')}</h1>
        <p className="mt-1 text-[14px] text-(--ink-muted)">
          {(filtros.deporte ? nombreDeporte(filtros.deporte) : t('partidos.todos'))} · {textoFecha} ·{' '}
          {t('partidos.zona', { zona })}{' '}
          <Link to={RUTA_AJUSTES + '#zona'} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:text-(--ink-body)">{t('partidos.cambiarZona')}</Link>
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
        {/* Búsqueda, competición, guardados y orden. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-[12rem] flex-1">
            <span className="sr-only">{t('partidos.buscar')}</span>
            <input
              type="search"
              value={filtros.q}
              onChange={(e) => setBusqueda(e.target.value || null)}
              placeholder={t('partidos.buscar')}
              className="h-10 w-full rounded-lg border border-(--line-strong) bg-(--surface-card) px-3 text-[15px] text-(--ink-body) placeholder:text-(--ink-faint)"
            />
          </label>
          {(ligas.length > 1 || (filtros.liga != null && filtros.deporte != null)) && (
            <label className="flex items-center gap-2 text-[14px] text-(--ink-muted)">
              <span className="sr-only">{t('partidos.liga')}</span>
              <select value={filtros.liga ?? ''} onChange={(e) => set({ liga: e.target.value || null })} className="h-10 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)">
                <option value="">{t('partidos.todasLigas')}</option>
                {ligas.map(([id, nombre]) => (
                  <option key={id} value={id}>{nombre}</option>
                ))}
                {filtros.liga && !ligas.some(([id]) => id === filtros.liga) && <option value={filtros.liga}>{t('partidos.ligaSinPartidos', { liga: filtros.liga })}</option>}
              </select>
            </label>
          )}
          <Chip activo={filtros.seguidos} onClick={() => set({ seguidos: filtros.seguidos ? null : '1' })} titulo={t('partidos.seguidosNota')}>
            {t('partidos.seguidos')}
          </Chip>
          <Chip activo={filtros.guardados} onClick={() => set({ guardados: filtros.guardados ? null : '1' })} titulo={t('partidos.guardadosNota')}>
            {t('partidos.guardados')}
          </Chip>
          <Link to={RUTA_GUARDADAS} className="inline-flex min-h-6 items-center text-[13px] text-(--ink-muted) underline underline-offset-2 hover:text-(--ink-body)">{t('partidos.verGuardadas')}</Link>
        </div>
        <details className="text-[14px] text-(--ink-muted)" open={filtros.minimo != null || filtros.orden !== 'hora' || undefined}>
          <summary className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3 ring-1 ring-(--line-strong) hover:bg-(--raised) hover:text-(--ink-body)">
            {t('partidos.masFiltros')}
            <span aria-hidden className="text-[11px]">▾</span>
          </summary>
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
        <VistasGuardadas q={q} aplicar={(consulta) => navegar({ pathname: '/partidos', search: consulta ? `?${consulta}` : '' })} />
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
      </section>

      {/* Los filtros activos, cada uno con su «quitar» (B4): un filtro que no se ve no puede explicar
          una lista vacía. */}
      {activos.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2" aria-label={t('partidos.filtrosActivos')}>
          {activos.map((a) => (
            <li key={a.clave}>
              <button
                type="button"
                onClick={() => set(a.quitar)}
                aria-label={t('partidos.quitarFiltro', { filtro: a.texto })}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-(--raised) px-3 text-[13px] text-(--ink-body) ring-1 ring-(--line-strong) hover:bg-(--raised-2)"
              >
                <span>{a.texto}</span>
                <span aria-hidden className="text-[15px] leading-none text-(--ink-muted)">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {filtros.guardados && conProblema(estadoGuardadas) && (
        <p className="mb-2 text-[13px] text-(--status-warning)" role="alert">
          {t(estadoGuardadas.fase === 'error-refresco' ? 'partidos.guardadasErrorRefresco' : 'partidos.guardadasError')}{' '}
          <button onClick={recargarGuardadas} className="toque underline underline-offset-2 [--toque-y:6px]">{t('partidos.reintentar')}</button>
        </p>
      )}

      {/* Estado: cuántos, de cuándo, y si se está actualizando. Sin bloques de mantenimiento. */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-(--ink-muted)" role="status" aria-live="polite">
        <span>
          {vigentes ? (visibles.length === 1 ? t('partidos.n1') : t('partidos.n', { n: visibles.length })) : cargando ? t('partidos.cargando') : ''}
          {hayFiltros(filtros) && (
            <>
              {' · '}
              <button onClick={quitarFiltros} className="toque inline-flex min-h-6 items-center underline underline-offset-2 [--toque-y:6px] hover:text-(--ink-body)">{t('partidos.quitarFiltros')}</button>
            </>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{cargando && vigentes ? t('partidos.actualizando') : vigentes ? t('partidos.actualizado', { cuando: haceCuanto(vigentes.generado, idioma, t) }) : ''}</span>
          <span role="group" aria-label={t('partidos.densidad')} className="inline-flex overflow-hidden rounded-md ring-1 ring-(--line-strong)">
            {(['comoda', 'compacta'] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={densidad === d}
                onClick={() => setDensidad(d)}
                className={`h-8 px-2.5 text-[12px] ${densidad === d ? 'bg-(--raised-2) font-medium text-(--ink-strong)' : 'text-(--ink-muted) hover:text-(--ink-body)'}`}
              >
                {t(d === 'comoda' ? 'partidos.densidadComoda' : 'partidos.densidadCompacta')}
              </button>
            ))}
          </span>
        </span>
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
            {/* Solo se dice «no hay partidos de X» cuando el deporte es el ÚNICO filtro (B4): con una
                competición puesta, lo que no hay es partidos de esa competición. */}
            {filtros.deporte && !filtros.liga && !filtros.q && !filtros.guardados && !filtros.seguidos && filtros.minimo == null
              ? t('partidos.vacioDeporte', { deporte: nombreDeporte(filtros.deporte), fecha: textoFecha })
              : filtros.deporte && filtros.liga && nombreLiga && !filtros.q && !filtros.guardados && !filtros.seguidos && filtros.minimo == null
                ? t('partidos.vacioLiga', { deporte: nombreDeporte(filtros.deporte), liga: nombreLiga, fecha: textoFecha })
                : t('partidos.vacioFiltros')}
          </p>
          <p className="mt-1">
            {filtros.deporte && filtros.liga && (cuentas[filtros.deporte] ?? 0) > 0
              ? t('partidos.vacioLigaHay', { n: cuentas[filtros.deporte] ?? 0, deporte: nombreDeporte(filtros.deporte) })
              : t('partidos.vacioFiltrosHay', { n: filas.length })}
          </p>
          <p className="mt-3 flex flex-wrap gap-2">
            {filtros.liga && <button onClick={() => set({ liga: null })} className="rounded-lg border border-(--line-strong) px-4 py-2 text-[14px] text-(--ink-body) hover:bg-(--raised)">{t('partidos.quitarLiga')}</button>}
            <button onClick={quitarFiltros} className="rounded-lg border border-(--line-strong) px-4 py-2 text-[14px] text-(--ink-body) hover:bg-(--raised)">{t('partidos.quitarFiltros')}</button>
          </p>
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
                      <FilaPartido key={`${f.sport}|${f.id}`} f={f} zona={zona} locale={locale} densidad={densidad} onAbrir={abrirEnPanel} />
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
            <FilaPartido key={`${f.sport}|${f.id}`} f={f} zona={zona} locale={locale} densidad={densidad} onAbrir={abrirEnPanel} />
          ))}
        </ul>
      )}

      {panelValido && <PanelPartido sport={panelSport as DeporteId} id={panelId} clave={q.get('panelClave')} onCerrar={cerrarPanel} />}

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

/**
 * Vistas guardadas (E2): la combinación de filtros de ahora, con nombre, en este navegador. Aplicar,
 * renombrar y quitar; «hoy» y «mañana» siguen siendo relativos (se guarda la consulta tal cual).
 */
function VistasGuardadas({ q, aplicar }: { q: URLSearchParams; aplicar: (consulta: string) => void }) {
  const { t } = useI18n();
  const [vistas, setVistas] = useState<Vista[]>(leerVistas);
  const [nombre, setNombre] = useState('');
  const [renombrando, setRenombrando] = useState<{ id: string; nombre: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intentar = (f: () => void) => {
    try {
      f();
      setError(null);
      setVistas(leerVistas());
      return true;
    } catch (e) {
      setError(e instanceof ErrorDeVista ? t(`vistas.error.${e.codigo}`) : t('vistas.error.otro'));
      return false;
    }
  };
  return (
    <details className="text-[14px] text-(--ink-muted)">
      <summary className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3 ring-1 ring-(--line-strong) hover:bg-(--raised) hover:text-(--ink-body)">
        {t('vistas.titulo', { n: vistas.length })}
        <span aria-hidden className="text-[11px]">▾</span>
      </summary>
      <div className="mt-2 space-y-2">
        {vistas.length === 0 && <p className="text-[13px]">{t('vistas.ninguna')}</p>}
        <ul className="space-y-1">
          {vistas.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              {renombrando?.id === v.id ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (intentar(() => renombrarVista(v.id, renombrando.nombre))) setRenombrando(null);
                  }}
                >
                  <label>
                    <span className="sr-only">{t('vistas.nuevoNombre')}</span>
                    <input value={renombrando.nombre} onChange={(e) => setRenombrando({ id: v.id, nombre: e.target.value })} className="h-9 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body)" />
                  </label>
                  <button type="submit" className="h-9 rounded-lg px-3 text-[13px] ring-1 ring-(--line-strong)">{t('vistas.guardarNombre')}</button>
                  <button type="button" onClick={() => setRenombrando(null)} className="h-9 rounded-lg px-3 text-[13px]">{t('comun.cancelar')}</button>
                </form>
              ) : (
                <>
                  <button type="button" onClick={() => aplicar(v.consulta)} className="h-9 rounded-lg px-3 text-[14px] font-medium text-(--ink-body) ring-1 ring-(--line-strong) hover:bg-(--raised)">{v.nombre}</button>
                  <button type="button" onClick={() => setRenombrando({ id: v.id, nombre: v.nombre })} className="text-[12px] underline underline-offset-2" aria-label={t('vistas.renombrarA', { nombre: v.nombre })}>{t('vistas.renombrar')}</button>
                  <button type="button" onClick={() => intentar(() => quitarVista(v.id))} className="text-[12px] underline underline-offset-2" aria-label={t('vistas.quitarA', { nombre: v.nombre })}>{t('vistas.quitar')}</button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (intentar(() => guardarVista(nombre, q))) setNombre('');
          }}
        >
          <label className="flex items-center gap-2">
            <span>{t('vistas.nombre')}</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={t('vistas.ejemplo')} className="h-9 rounded-lg border border-(--line-strong) bg-(--surface-card) px-2 text-[14px] text-(--ink-body) placeholder:text-(--ink-faint)" />
          </label>
          <button type="submit" className="h-9 rounded-lg px-3 text-[13px] text-(--ink-body) ring-1 ring-(--line-strong) hover:bg-(--raised)">{t('vistas.guardar')}</button>
        </form>
        <p className="text-[12px]">{t('vistas.relativa')}</p>
        {error && <p role="alert" className="text-[13px] text-(--status-critical)">{error}</p>}
      </div>
    </details>
  );
}

function Cuenta({ n }: { n: number }) {
  return <span className="tabular-nums text-(--ink-muted)">{n}</span>;
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl bg-(--surface-card) p-5 text-[15px] text-(--ink-muted)">{children}</div>;
}

