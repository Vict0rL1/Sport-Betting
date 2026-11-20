// El panel lateral de Partidos (D2 de la revisión del PR 17): en una pantalla ancha, abrir un partido
// no saca de la lista. Es un diálogo modal (useDialogo): el foco entra, Tab da la vuelta dentro,
// Escape cierra, el fondo no se desplaza y el foco vuelve a la fila. La URL lleva el panel (?panel=),
// así que «atrás» lo cierra y el enlace se puede compartir. La página completa sigue existiendo.
import { lazy, Suspense, useRef } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n';
import { useDialogo } from '../ui/useDialogo';
import { rutaPartido } from '../../rutas';
import type { DeporteId } from '../../lib/partidos';

const Ficha = lazy(() => import('../../pages/Partido').then((m) => ({ default: m.FichaPartido })));

export default function PanelPartido({ sport, id, clave, onCerrar }: { sport: DeporteId; id: string; clave: string | null; onCerrar: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useDialogo(true, onCerrar, ref);
  const completa = rutaPartido(sport, id) + (clave ? `?clave=${encodeURIComponent(clave)}` : '');
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden className="absolute inset-0 bg-black/40" onClick={onCerrar} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ficha-titulo"
        className="relative flex h-full w-[min(46rem,100%)] flex-col border-l border-(--line) bg-(--surface-page) shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-(--line) px-4 py-2">
          <Link to={completa} className="text-[13px] text-(--ink-body) underline underline-offset-2 hover:text-(--ink-strong)">
            {t('partidos.panelCompleta')}
          </Link>
          <button type="button" onClick={onCerrar} className="rounded-lg px-3 py-1.5 text-[13px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised)">
            {t('partidos.panelCerrar')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <Suspense fallback={<p className="text-[13px] text-(--ink-muted)">{t('comun.cargando')}</p>}>
            <Ficha sport={sport} id={id} claveDada={clave} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
