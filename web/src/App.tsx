// El armazón (Fase 5): rutas reales, barra lateral desde 1024 px y barra inferior debajo, la
// píldora de estado una sola vez, y «Hoy / Cómo le fue al modelo» solo en los deportes y en
// Destacados. Cada pestaña sigue hablando solo con su trozo de la API.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { SPORT_THEMES, type SportId } from './lib/theme';
import TodayPanel from './components/TodayPanel';
import { AppMark, SportIcon } from './components/icons';
import Login from './components/auth/Login';
import AccountPanel from './components/auth/AccountPanel';
import { estadoAuth, EVENTO_AUTH, instalarDetector401, type EstadoAuth } from './lib/auth';
import { DEPORTES, PESTANAS, RUTA_AJUSTES, RUTA_DE_PESTANA, pestanaDeRuta, recordarPestana, ultimaPestana } from './rutas';
import StatusPill from './components/estado/StatusPill';
import MobileNav from './components/nav/MobileNav';
import NoEncontrada from './pages/NoEncontrada';
import Buscador from './components/busqueda/Buscador';
import Campana from './components/bandeja/Campana';
import Recorrido from './components/Recorrido';
import { SeguimientoProvider } from './components/seguimiento';
import { ultimaRed, useEnLinea } from './lib/sinConexion';

// Cada pantalla en su propio trozo (Fase 5 / 7): la primera carga solo trae el armazón y la
// pestaña que se abre.
const TennisDashboard = lazy(() => import('./components/TennisDashboard'));
const BasketballDashboard = lazy(() => import('./components/basketball/BasketballDashboard'));
const FootballDashboard = lazy(() => import('./components/football/FootballDashboard'));
const BaseballDashboard = lazy(() => import('./components/baseball/BaseballDashboard'));
const NflDashboard = lazy(() => import('./components/nfl/NflDashboard'));
const BetsDashboard = lazy(() => import('./components/bets/BetsDashboard'));
const SystemTrust = lazy(() => import('./components/trust/SystemTrust'));
const TopPicks = lazy(() => import('./components/picks/TopPicks'));
const Diagnostico = lazy(() => import('./pages/Diagnostico'));
const Ajustes = lazy(() => import('./pages/Ajustes'));
const Glosario = lazy(() => import('./pages/Glosario'));
const Partido = lazy(() => import('./pages/Partido'));
const Equipo = lazy(() => import('./pages/Equipo'));
const Jugador = lazy(() => import('./pages/Jugador'));
const Liga = lazy(() => import('./pages/Liga'));
const Muestras = lazy(() => import('./pages/Muestras'));
const Laboratorio = lazy(() => import('./pages/Laboratorio'));
const Bandeja = lazy(() => import('./pages/Bandeja'));
const Informes = lazy(() => import('./pages/Informes'));
const InformeDetalle = lazy(() => import('./pages/Informe'));
const Lineas = lazy(() => import('./pages/Lineas'));
const Archivo = lazy(() => import('./pages/Archivo'));
import { I18nProvider, idiomaGuardado, useI18n } from './i18n';
import { aplicarTema, temaGuardado, type Tema } from './lib/tema';

/**
 * Ancho máximo del armazón: 80rem (1280px), con las listas de tarjetas a dos columnas en
 * pantallas anchas. Declarado una vez y usado por cabecera, columna y pie: tres literales son
 * tres ocasiones de que la cabecera deje de alinearse con el contenido.
 */
const SHELL_WIDTH = 'max-w-[80rem]';

interface AjustesUsuario {
  deportesOcultos: string[];
  tema: Tema;
  idioma: 'es' | 'en';
  recorridoVisto?: boolean;
}

export default function App() {
  return (
    <I18nProvider>
      <SeguimientoProvider>
        <Armazon />
      </SeguimientoProvider>
    </I18nProvider>
  );
}

function Armazon() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t, setIdioma } = useI18n();
  const pestana = pestanaDeRuta(pathname);
  // La puerta: si el servidor pide contraseña y no hay sesión, se enseña la entrada y nada más.
  const [auth, setAuth] = useState<EstadoAuth | null>(null);
  const [ajustes, setAjustes] = useState<AjustesUsuario | null>(null);
  useEffect(() => {
    instalarDetector401();
    let vivo = true;
    estadoAuth().then((a) => vivo && setAuth(a));
    const alPedir = () => setAuth((a) => (a ? { ...a, dentro: false } : a));
    window.addEventListener(EVENTO_AUTH, alPedir);
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO_AUTH, alPedir);
    };
  }, []);
  // Los ajustes de la persona (tema, idioma, deportes visibles) una vez dentro.
  useEffect(() => {
    if (!auth || (auth.auth && !auth.dentro)) return;
    let vivo = true;
    fetch('/api/ajustes')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { ajustes: AjustesUsuario }) => {
        if (!vivo) return;
        setAjustes(j.ajustes);
        // El tema fijado en Ajustes manda; con «auto» en el servidor vale lo que este navegador recuerde.
        if (j.ajustes.tema !== 'auto' || temaGuardado() === 'auto') aplicarTema(j.ajustes.tema);
        if (idiomaGuardado() == null || j.ajustes.idioma !== 'es') setIdioma(j.ajustes.idioma);
      })
      .catch(() => vivo && setAjustes({ deportesOcultos: [], tema: 'auto', idioma: 'es', recorridoVisto: true }));
    return () => {
      vivo = false;
    };
  }, [auth, setIdioma]);
  const headerRef = useRef<HTMLElement>(null);

  // La altura de la barra superior, para que los encabezados pegajosos se coloquen debajo.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--header-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [auth]);

  useEffect(() => {
    if (pestana) recordarPestana(pestana);
  }, [pestana]);

  // Atajos (Fase 5.17): 1–8 cambian de pestaña fuera de un campo de texto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.metaKey || e.ctrlKey || e.altKey || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement | null)?.isContentEditable) return;
      const n = Number(e.key);
      if (n >= 1 && n <= PESTANAS.length) navigate(RUTA_DE_PESTANA[PESTANAS[n - 1]]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (auth === null) return <div className="min-h-screen bg-(--surface-page)" aria-busy="true" />;
  if (auth.auth && !auth.dentro) {
    return <Login totp={auth.totp} onEntrar={() => void estadoAuth().then(setAuth)} />;
  }
  const alSalir = () => setAuth((a) => (a ? { ...a, dentro: false } : a));
  const ocultos = ajustes?.deportesOcultos ?? [];
  const conHoy = pestana === 'picks' || (pestana != null && DEPORTES.includes(pestana) && !pathname.startsWith('/partido') && !pathname.startsWith('/equipo') && !pathname.startsWith('/liga') && !pathname.startsWith('/jugador'));

  return (
    <div className="min-h-screen lg:flex">
      {/* La barra lateral desde 1024 px; debajo, la barra inferior (MobileNav). */}
      <aside className="hidden shrink-0 border-r border-(--line) bg-(--surface-rail) lg:block lg:w-[15rem]">
        <div className="sticky top-0 flex h-screen flex-col pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-2.5 px-4 pb-3 pt-5">
            <AppMark size={34} className="shrink-0" />
            <div className="min-w-0">
              <h1 className="text-[16px] font-semibold leading-tight text-(--ink-strong)">{t('app.nombre')}</h1>
              <p className="text-[12px] leading-snug text-(--ink-muted)">{t('app.lema')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
            <StatusPill />
            <Buscador />
            <Campana />
          </div>
          <SportNav pestana={pestana} ocultos={ocultos} vertical />
          <div className="mt-auto px-2 pb-3">
            <EnlacesSecundarios pathname={pathname} />
            {auth.auth && auth.sesiones && <AccountPanel usuario={auth.usuario} onSalir={alSalir} />}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* La cabecera del móvil: marca y píldora. Las pestañas van en la barra inferior. */}
        <header ref={headerRef} className="sticky top-0 z-40 border-b border-(--line) bg-(--surface-page)/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
          <div className={`mx-auto ${SHELL_WIDTH} flex items-center justify-between gap-3 px-4 py-2.5 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]`}>
            <div className="flex min-w-0 items-center gap-2.5">
              <AppMark size={30} className="shrink-0" />
              <h1 className="text-[16px] font-semibold leading-tight text-(--ink-strong)">{t('app.nombre')}</h1>
            </div>
            <span className="flex items-center gap-2">
              <Buscador />
              <Campana />
              <StatusPill compacto />
            </span>
          </div>
          {pestana != null && DEPORTES.includes(pestana) && <SportNav pestana={pestana} ocultos={ocultos} soloDeportes />}
        </header>

        {/* min-h: el pie empieza fuera de la pantalla, así que no salta cuando llega la página
            (cada pantalla se carga aparte). Medido con Lighthouse: era el mayor desplazamiento. */}
        <main className={`mx-auto ${SHELL_WIDTH} min-h-[100svh] px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5 lg:pb-16`}>
          <BannerSinConexion />
          {conHoy && <TodayPanel />}
          <Suspense fallback={<p className="text-[13px] text-(--ink-muted)">{t('comun.cargando')}</p>}>
          <Routes>
            <Route path="/" element={<Navigate to={RUTA_DE_PESTANA[ultimaPestana()]} replace />} />
            <Route path="/destacados" element={<TopPicks />} />
            <Route path="/futbol/:league?" element={<FootballDashboard />} />
            <Route path="/baloncesto/:league?" element={<BasketballDashboard />} />
            <Route path="/beisbol/:league?" element={<BaseballDashboard />} />
            <Route path="/nfl/:league?" element={<NflDashboard />} />
            <Route path="/tenis/:league?" element={<TennisDashboard />} />
            <Route path="/apuestas" element={<BetsDashboard />} />
            <Route path="/apuestas/laboratorio" element={<Laboratorio />} />
            <Route path="/apuestas/lineas" element={<Lineas />} />
            <Route path="/confianza/archivo" element={<Archivo />} />
            <Route path="/bandeja" element={<Bandeja />} />
            <Route path="/informes" element={<Informes />} />
            <Route path="/informes/:id" element={<InformeDetalle />} />
            <Route path="/confianza" element={<SystemTrust />} />
            <Route path="/confianza/diagnostico" element={<Diagnostico />} />
            <Route path="/ajustes" element={<Ajustes />} />
            <Route path="/glosario" element={<Glosario />} />
            <Route path="/partido/:sport/:id" element={<Partido />} />
            <Route path="/equipo/:sport/:league/:id" element={<Equipo />} />
            <Route path="/jugador/:tour/:id" element={<Jugador />} />
            <Route path="/liga/:sport/:league" element={<Liga />} />
            <Route path="/_muestras" element={<Muestras />} />
            <Route path="*" element={<NoEncontrada />} />
          </Routes>
          </Suspense>
        </main>

        <footer className={`mx-auto ${SHELL_WIDTH} px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-[max(2.5rem,env(safe-area-inset-bottom))]`}>
          {auth.auth && auth.sesiones && (
            <div className="mb-3 rounded-xl border border-(--line) lg:hidden">
              <AccountPanel usuario={auth.usuario} onSalir={alSalir} compacto />
            </div>
          )}
          <div className="border-t border-(--line) pt-4 text-[13px] leading-relaxed text-(--ink-muted)">
            <p>{t('app.pie')}</p>
            <p className="mt-2 lg:hidden">
              <EnlacesSecundarios pathname={pathname} enLinea />
            </p>
          </div>
        </footer>
      </div>
      <MobileNav ocultos={ocultos} />
      <Recorrido vistoEnServidor={ajustes ? (ajustes.recorridoVisto ?? false) : null} onVisto={() => void fetch('/api/ajustes', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recorridoVisto: true }) }).catch(() => undefined)} />
    </div>
  );
}

/** «Sin conexión: datos de HH:MM» (Fase 5.26). */
function BannerSinConexion() {
  const enLinea = useEnLinea();
  const { t } = useI18n();
  if (enLinea) return null;
  const u = ultimaRed();
  const hora = u ? new Date(u).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  return (
    <p role="status" aria-live="polite" data-testid="sin-conexion" className="mb-4 rounded-lg border border-[#c98500]/50 px-3 py-2 text-[13px] text-(--ink-body)">
      {t('sinConexion', { hora })}
    </p>
  );
}

/** Ajustes, Diagnóstico y Glosario: fuera de las pestañas, siempre a mano. */
function EnlacesSecundarios({ pathname, enLinea = false }: { pathname: string; enLinea?: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const enlaces: [string, string][] = [
    ['/informes', t('nav.informes')],
    ['/bandeja', t('nav.bandeja')],
    [RUTA_AJUSTES, t('nav.ajustes')],
    ['/confianza/diagnostico', t('nav.diagnostico')],
    ['/glosario', t('nav.glosario')],
  ];
  return (
    <span className={enLinea ? 'flex flex-wrap gap-x-3' : 'flex flex-col gap-0.5'}>
      {enlaces.map(([ruta, etiqueta]) => (
        <button
          key={ruta}
          onClick={() => navigate(ruta)}
          aria-current={pathname === ruta ? 'page' : undefined}
          className={enLinea ? `underline-offset-2 hover:underline ${pathname === ruta ? 'text-(--ink-body)' : ''}` : `rounded-lg px-3 py-1.5 text-left text-[13px] ${pathname === ruta ? 'bg-(--raised) text-(--ink-strong)' : 'text-(--ink-muted) hover:bg-(--raised) hover:text-(--ink-body)'}`}
        >
          {etiqueta}
        </button>
      ))}
    </span>
  );
}

/**
 * La lista de pestañas, vertical (barra lateral) u horizontal (solo los deportes, en la
 * cabecera del móvil cuando ya se está en un deporte). Una sola lista: los mismos deportes,
 * el mismo orden, el mismo acento marcando la activa, los mismos roles.
 * Con flechas se recorre (Fase 5.24): roving tabindex.
 */
function SportNav({ pestana, ocultos, vertical = false, soloDeportes = false }: { pestana: SportId | null; ocultos: string[]; vertical?: boolean; soloDeportes?: boolean }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const lista = (soloDeportes ? DEPORTES : PESTANAS).filter((id) => !ocultos.includes(id));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [pestana]);
  const etiqueta = (id: SportId) => (id === 'picks' ? t('nav.destacados') : id === 'bets' ? t('nav.apuestas') : id === 'trust' ? t('nav.confianza') : SPORT_THEMES[id].label);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const sig = vertical ? 'ArrowDown' : 'ArrowRight';
    const ant = vertical ? 'ArrowUp' : 'ArrowLeft';
    let j = i;
    if (e.key === sig) j = (i + 1) % lista.length;
    else if (e.key === ant) j = (i - 1 + lista.length) % lista.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = lista.length - 1;
    else return;
    e.preventDefault();
    refs.current[j]?.focus();
    navigate(RUTA_DE_PESTANA[lista[j]]);
  };
  return (
    <nav role="tablist" aria-label={t('nav.deportes')} aria-orientation={vertical ? 'vertical' : 'horizontal'} className={vertical ? 'flex flex-col gap-0.5 px-2' : `mx-auto ${SHELL_WIDTH} -mb-px flex gap-0.5 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>
      {lista.map((id, i) => {
        const s = SPORT_THEMES[id];
        const active = pestana === id;
        const ref = (el: HTMLButtonElement | null) => {
          refs.current[i] = el;
          if (active) activeRef.current = el;
        };
        if (vertical) {
          return (
            <button key={id} ref={ref} role="tab" aria-selected={active} tabIndex={active || (pestana == null && i === 0) ? 0 : -1} onKeyDown={(e) => onKey(e, i)} onClick={() => navigate(RUTA_DE_PESTANA[id])} className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[15px] font-medium transition ${active ? 'bg-(--raised-2) text-(--ink-strong)' : 'text-(--ink-soft) hover:bg-(--raised) hover:text-(--ink-body)'}`}>
              <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full transition" style={{ backgroundColor: active ? s.accent : 'transparent' }} />
              <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition" style={{ color: active ? s.accent : 'currentColor', backgroundColor: active ? s.accentSoft : 'transparent' }}>
                <SportIcon sport={id} size={18} />
              </span>
              <span className="min-w-0">{etiqueta(id)}</span>
            </button>
          );
        }
        return (
          <button key={id} ref={ref} role="tab" aria-selected={active} tabIndex={active ? 0 : -1} onKeyDown={(e) => onKey(e, i)} onClick={() => navigate(RUTA_DE_PESTANA[id])} className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg px-3 py-2 text-[13px] font-medium transition ${active ? 'text-(--ink-strong)' : 'text-(--ink-muted) hover:text-(--ink-body)'}`}>
            <span className="inline-flex" aria-hidden style={{ color: active ? s.accent : 'currentColor' }}>
              <SportIcon sport={id} size={16} />
            </span>
            {etiqueta(id)}
            <span aria-hidden className="absolute inset-x-1 -bottom-px h-0.5 rounded-full transition" style={{ backgroundColor: active ? s.accent : 'transparent' }} />
          </button>
        );
      })}
    </nav>
  );
}
