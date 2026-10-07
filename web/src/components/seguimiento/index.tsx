// Seguimiento (Fase 5.14): la estrella para seguir equipos, jugadores y partidos, y el hook
// que lee la lista una vez para toda la pantalla.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n';

export interface Seguido { id: number; kind: 'equipo' | 'jugador' | 'partido'; sport: string; league: string | null; ref_id: string; label: string; created_at: string }

const Ctx = createContext<{ seguidos: Seguido[]; recargar: () => void; disponible: boolean }>({ seguidos: [], recargar: () => {}, disponible: false });

export function SeguimientoProvider({ children }: { children: ReactNode }) {
  const [seguidos, setSeguidos] = useState<Seguido[]>([]);
  const [disponible, setDisponible] = useState(false);
  const recargar = useCallback(() => {
    fetch('/api/watchlist')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { seguidos: Seguido[] }) => {
        setSeguidos(j.seguidos);
        setDisponible(true);
      })
      .catch(() => setDisponible(false));
  }, []);
  useEffect(recargar, [recargar]);
  const v = useMemo(() => ({ seguidos, recargar, disponible }), [seguidos, recargar, disponible]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useSeguimiento() {
  return useContext(Ctx);
}

export function EstrellaSeguir({ kind, sport, league = null, refId, label, size = 16 }: { kind: Seguido['kind']; sport: string; league?: string | null; refId: string; label: string; size?: number }) {
  const { t } = useI18n();
  const { seguidos, recargar, disponible } = useSeguimiento();
  const actual = seguidos.find((s) => s.kind === kind && s.sport === sport && s.ref_id === refId);
  if (!disponible) return null;
  const alternar = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (actual) await fetch(`/api/watchlist/${actual.id}`, { method: 'DELETE' });
    else await fetch('/api/watchlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, sport, league, ref_id: refId, label }) });
    recargar();
  };
  return (
    <button onClick={(e) => void alternar(e)} aria-pressed={!!actual} aria-label={`${actual ? t('seguimiento.dejar') : t('seguimiento.seguir')}: ${label}`} title={actual ? t('seguimiento.dejar') : t('seguimiento.seguir')} className={`grid shrink-0 place-items-center rounded p-1 transition ${actual ? 'text-[#f5b544]' : 'text-(--ink-faint) hover:text-(--ink-body)'}`}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill={actual ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
        <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
      </svg>
    </button>
  );
}
