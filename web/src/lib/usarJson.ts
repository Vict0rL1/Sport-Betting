// Leer y escribir JSON de la API desde las páginas nuevas (Fase 6), con el mensaje del servidor
// cuando falla —«apagado (features.json: …)» incluido— en vez de un «error» genérico.
import { useCallback, useEffect, useState } from 'react';

export interface Lectura<T> {
  datos: T | null;
  error: string | null;
  cargando: boolean;
  recargar: () => void;
}

export function useJson<T>(url: string | null): Lectura<T> {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let vivo = true;
    setCargando(true);
    fetch(url)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as T & { error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j;
      })
      .then((j) => {
        if (!vivo) return;
        setDatos(j);
        setError(null);
      })
      .catch((e: Error) => vivo && setError(e.message))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [url, n]);
  const recargar = useCallback(() => setN((x) => x + 1), []);
  return { datos, error, cargando, recargar };
}

/** POST/PATCH/PUT con cuerpo JSON (o sin cuerpo). Lanza con el mensaje del servidor. */
export async function enviarJson<T>(url: string, metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE', cuerpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: cuerpo === undefined ? undefined : { 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}
