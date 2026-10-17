// La barra inferior del móvil (Fase 5.3): cuatro destinos y nada fuera de pantalla a 390 px.
// «Deportes» abre una hoja con los siete; los demás llevan directamente.

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { SPORT_THEMES, type SportId } from '../../lib/theme';
import { DEPORTES, RUTA_DE_PESTANA, pestanaDeRuta, recordarPestana } from '../../rutas';
import { SportIcon } from '../icons';
import { useI18n, type Clave } from '../../i18n';
import { useDialogo } from '../ui/useDialogo';

const DESTINOS: { id: SportId | 'deportes'; etiqueta: Clave }[] = [
  { id: 'picks', etiqueta: 'nav.destacados' },
  { id: 'deportes', etiqueta: 'nav.deportes' },
  { id: 'bets', etiqueta: 'nav.apuestas' },
  { id: 'trust', etiqueta: 'nav.confianza' },
];

/** Cuánto hay que bajar la hoja con el dedo para que se cierre al soltarla (K7, lote K). */
const CIERRA_A_PX = 60;
/** Por debajo de esto es un toque, no un arrastre: el botón que hay debajo recibe su clic. */
const ARRASTRE_DESDE_PX = 8;

export default function MobileNav({ ocultos = [] }: { ocultos?: string[] }) {
  const { pathname, key } = useLocation();
  const tipo = useNavigationType();
  const navigate = useNavigate();
  const [hoja, setHoja] = useState(false);
  const { t } = useI18n();
  const activa = pestanaDeRuta(pathname);
  const enDeporte = activa != null && DEPORTES.includes(activa);
  // Se cierra al navegar (un enlace, «atrás»), no cuando la página reescribe su dirección: al
  // llegar las ligas, /futbol pasa a /futbol/epl con `replace`, y eso cerraba la hoja que se
  // acababa de abrir (K1, lote K).
  useEffect(() => {
    if (tipo !== 'REPLACE') setHoja(false);
  }, [key, tipo]);
  const dialogo = useRef<HTMLDivElement>(null);
  useDialogo(hoja, () => setHoja(false), dialogo);
  const ir = (id: SportId) => {
    setHoja(false);
    recordarPestana(id);
    navigate(RUTA_DE_PESTANA[id]);
  };
  // Tocar la pestaña en la que ya se está vuelve arriba, como en las apps del teléfono (K7).
  const arriba = () => window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  // Deslizar la hoja hacia abajo la cierra (K7). La hoja sigue al dedo; si no baja lo bastante,
  // vuelve a su sitio. El puntero se captura solo al empezar a arrastrar: capturarlo al tocar
  // le quitaría el clic al botón del deporte.
  const panel = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ y: number; id: number; activo: boolean } | null>(null);
  const alBajar = (e: PointerEvent) => {
    arrastre.current = { y: e.clientY, id: e.pointerId, activo: false };
  };
  const alMover = (e: PointerEvent) => {
    const a = arrastre.current;
    const el = panel.current;
    if (!a || !el || a.id !== e.pointerId) return;
    const dy = e.clientY - a.y;
    if (!a.activo && dy > ARRASTRE_DESDE_PX) {
      a.activo = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Sin captura, el arrastre sigue mientras el dedo esté encima de la hoja.
      }
    }
    if (a.activo) el.style.transform = `translateY(${Math.max(0, dy)}px)`;
  };
  const alSoltar = (e: PointerEvent) => {
    const a = arrastre.current;
    const el = panel.current;
    arrastre.current = null;
    if (!a || !el || !a.activo) return;
    if (e.clientY - a.y > CIERRA_A_PX) setHoja(false);
    else el.style.transform = '';
  };
  const alCancelar = () => {
    arrastre.current = null;
    if (panel.current) panel.current.style.transform = '';
  };

  return (
    <>
      {hoja && (
        <div ref={dialogo} className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.deportes')}>
          <button aria-label={t('comun.cerrar')} className="anim-aparece absolute inset-0 bg-black/50" onClick={() => setHoja(false)} />
          <div
            ref={panel}
            data-testid="hoja-deportes"
            onPointerDown={alBajar}
            onPointerMove={alMover}
            onPointerUp={alSoltar}
            onPointerCancel={alCancelar}
            className="anim-sube absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] touch-none rounded-t-2xl border-t border-(--line) bg-(--surface-card) px-3 pb-4 pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.25)]"
          >
            {/* El asa: dice que la hoja se puede bajar con el dedo. */}
            <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full bg-(--line-strong)" />
            <p className="mb-2 px-1 text-[12px] font-medium uppercase tracking-wide text-(--ink-muted)">{t('nav.deportes')}</p>
            {/* Siete deportes en cuatro columnas (4 + 3): en cinco quedaban 5 + 2, con dos solos
                abajo, y cada botón llegaba justo a 70 px de ancho. */}
            <div className="grid grid-cols-4 gap-1">
              {DEPORTES.filter((d) => !ocultos.includes(d)).map((id) => {
                const s = SPORT_THEMES[id];
                const on = activa === id;
                return (
                  <button
                    key={id}
                    data-deporte={id}
                    onClick={() => ir(id)}
                    aria-current={on ? 'page' : undefined}
                    className="flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[12px] text-(--ink-soft) hover:bg-(--raised)"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ color: on ? s.accent : 'currentColor', backgroundColor: on ? s.accentSoft : 'var(--raised)' }}>
                      <SportIcon sport={id} size={22} />
                    </span>
                    <span className={on ? 'font-medium text-(--ink-strong)' : ''}>{t(`deporte.${id}` as Clave)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <nav aria-label={t('nav.principal')} data-testid="barra-inferior" className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(3.5rem+env(safe-area-inset-bottom))] grid-cols-4 border-t border-(--line) bg-(--surface-page)/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {DESTINOS.map((d) => {
          const on = d.id === 'deportes' ? enDeporte || hoja : activa === d.id;
          const tema = d.id === 'deportes' ? (enDeporte && activa ? SPORT_THEMES[activa] : null) : SPORT_THEMES[d.id];
          return (
            <button
              key={d.id}
              onClick={() => (d.id === 'deportes' ? setHoja((h) => !h) : pathname === RUTA_DE_PESTANA[d.id] ? arriba() : ir(d.id))}
              aria-current={on && d.id !== 'deportes' ? 'page' : undefined}
              aria-expanded={d.id === 'deportes' ? hoja : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 text-[12px] font-medium ${on ? 'text-(--ink-strong)' : 'text-(--ink-muted)'}`}
            >
              {/* La píldora detrás del icono marca dónde se está, además del color (K7). */}
              <span aria-hidden className={`rounded-full px-4 py-0.5 transition-colors ${on ? 'bg-(--raised-2)' : ''}`} style={{ color: on && tema ? tema.accent : 'currentColor' }}>
                {d.id === 'deportes' ? <SportIcon sport={enDeporte && activa ? activa : 'football'} size={20} /> : <SportIcon sport={d.id} size={20} />}
              </span>
              {t(d.etiqueta)}
            </button>
          );
        })}
      </nav>
    </>
  );
}
