// Interruptores del servidor en la pantalla (Fase 8): una sola petición a /api/features por carga,
// compartida. Mientras no se sabe, null; si falla, todo apagado (lo prudente para lo opcional).
import { useEffect, useState } from 'react';

let pendiente: Promise<Record<string, boolean>> | null = null;

function leer(): Promise<Record<string, boolean>> {
  pendiente ??= fetch('/api/features')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((j: { features: Record<string, { on: boolean }> }) => Object.fromEntries(Object.entries(j.features).map(([k, v]) => [k, !!v.on])))
    .catch(() => ({}));
  return pendiente;
}

export function useFeature(nombre: string): boolean | null {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let vivo = true;
    void leer().then((f) => vivo && setOn(!!f[nombre]));
    return () => {
      vivo = false;
    };
  }, [nombre]);
  return on;
}
