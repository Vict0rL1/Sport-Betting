// Estimaciones guardadas (B3, revisión del PR 17): UNA lectura de /api/guardadas para toda la
// pantalla, con un estado que no miente (lib/remoto.ts). Antes cada fila del historial pedía la lista
// entera, y un fallo de lectura salía como «Guardar» (no guardada); Partidos perdía en silencio las
// guardadas de su filtro.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { REMOTO_INICIAL, alFallar, alPedir, alRecibir, type Remoto } from '../../lib/remoto';

export interface Guardada {
  id: number;
  sport: string;
  match_key: string;
  snapshot_id: number;
  guardada_en?: string;
  captured_at?: string;
  probs?: number[];
  outcomes?: string[];
  model_version?: string | null;
  commence_time?: string;
  event_id?: string | null;
  /** E3: nota personal (editable; la instantánea no se toca). */
  nota?: string | null;
  notaEn?: string | null;
  /** E4: la estimación más reciente de ese partido, para comparar. */
  actual?: { snapshot_id: number; captured_at: string; outcomes: string[]; probs: number[]; model_version: string | null } | null;
}

interface Valor {
  estado: Remoto<Guardada[]>;
  recargar: () => void;
  /** Guarda una instantánea; true si el servidor la guardó (y la lista ya está releída). */
  guardar: (sport: string, matchKey: string, snapshotId: number) => Promise<boolean>;
  quitar: (id: number) => Promise<boolean>;
  /** E3: escribe o borra (en blanco) la nota; true si el servidor la guardó. */
  anotar: (id: number, nota: string | null) => Promise<boolean>;
}

const Ctx = createContext<Valor>({ estado: REMOTO_INICIAL(), recargar: () => {}, guardar: async () => false, quitar: async () => false, anotar: async () => false });

export function GuardadasProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Remoto<Guardada[]>>(REMOTO_INICIAL);
  const turno = useRef(0);
  const leer = useCallback(async (): Promise<boolean> => {
    const n = ++turno.current;
    setEstado((e) => alPedir(e));
    try {
      const r = await fetch('/api/guardadas');
      if (n !== turno.current) return false;
      if (!r.ok) {
        setEstado((e) => alFallar(e, r.status));
        return false;
      }
      const j = (await r.json()) as { guardadas: Guardada[] };
      if (n === turno.current) setEstado((e) => alRecibir(e, j.guardadas, Date.now()));
      return true;
    } catch {
      if (n === turno.current) setEstado((e) => alFallar(e, 0));
      return false;
    }
  }, []);
  useEffect(() => {
    void leer();
  }, [leer]);
  const recargar = useCallback(() => void leer(), [leer]);
  const guardar = useCallback(
    async (sport: string, matchKey: string, snapshotId: number) => {
      const r = await fetch('/api/guardadas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sport, matchKey, snapshotId }) }).catch(() => null);
      if (!r || !r.ok) return false;
      await leer();
      return true;
    },
    [leer],
  );
  const quitar = useCallback(
    async (id: number) => {
      const r = await fetch(`/api/guardadas/${id}`, { method: 'DELETE' }).catch(() => null);
      if (!r || !r.ok) return false;
      await leer();
      return true;
    },
    [leer],
  );
  const anotar = useCallback(
    async (id: number, nota: string | null) => {
      const r = await fetch(`/api/guardadas/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nota }) }).catch(() => null);
      if (!r || !r.ok) return false;
      await leer();
      return true;
    },
    [leer],
  );
  const v = useMemo(() => ({ estado, recargar, guardar, quitar, anotar }), [estado, recargar, guardar, quitar, anotar]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useGuardadas(): Valor {
  return useContext(Ctx);
}
