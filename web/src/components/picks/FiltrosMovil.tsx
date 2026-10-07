// Los filtros en el móvil (Fase 5.8): un chip con cuántos hay activos y una hoja inferior
// con los mismos controles. Desde 1024 px no sale: los filtros están a la vista.
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';

export default function FiltrosMovil({ activos, children }: { activos: number; children: ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const { search } = useLocation();
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto]);
  void search;
  return (
    <div className="mb-4 lg:hidden">
      <button onClick={() => setAbierto(true)} aria-expanded={abierto} data-testid="filtros-movil" className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] text-(--ink-body) ring-1 ring-(--line-strong)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        Filtros{activos > 0 ? ` · ${activos} activo${activos === 1 ? '' : 's'}` : ''}
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Filtros">
          <button aria-label="Cerrar filtros" className="absolute inset-0 bg-black/50" onClick={() => setAbierto(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-(--line) bg-(--surface-card) p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[15px] font-semibold text-(--ink-strong)">Filtros</p>
              <button onClick={() => setAbierto(false)} className="rounded-lg px-3 py-1 text-[13px] font-medium text-(--ink-strong) ring-1 ring-(--line)">Listo</button>
            </div>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
