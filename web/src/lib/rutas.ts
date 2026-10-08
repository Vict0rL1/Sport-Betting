// Estado en la URL (Fase 5.2): la liga en el camino, los filtros en la query. Así un enlace
// copiado abre exactamente lo mismo, y «atrás» hace lo que se espera.

import { useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

/**
 * La liga (o el tour) seleccionada, leída del segmento de la ruta y cambiada navegando.
 * `recordar` guarda la última para cuando se entra sin liga en la URL.
 */
export function useLigaEnRuta(rutaBase: string, claveRecuerdo: string): [string | null, (id: string | null, reemplazar?: boolean) => void] {
  const { league } = useParams<{ league?: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const set = useCallback(
    (id: string | null, reemplazar = true) => {
      if (id) {
        try {
          localStorage.setItem(claveRecuerdo, id);
        } catch {
          // Sin almacenamiento, la URL sigue mandando.
        }
      }
      const q = params.toString();
      navigate(`${rutaBase}${id ? `/${encodeURIComponent(id)}` : ''}${q ? `?${q}` : ''}`, { replace: reemplazar });
    },
    [navigate, rutaBase, claveRecuerdo, params],
  );
  return [league ? decodeURIComponent(league) : null, set];
}

/** La liga recordada en el navegador, para el primer arranque sin liga en la URL. */
export function ligaRecordada(claveRecuerdo: string): string | null {
  try {
    return localStorage.getItem(claveRecuerdo);
  } catch {
    return null;
  }
}

/** Un filtro en la query (`?dia=2026-10-08`): null si no está; vacío lo quita. */
export function useFiltroQuery(clave: string): [string | null, (valor: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const valor = params.get(clave);
  const set = useCallback(
    (v: string | null) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (v == null || v === '') n.delete(clave);
          else n.set(clave, v);
          return n;
        },
        { replace: true },
      );
    },
    [clave, setParams],
  );
  return [valor, set];
}

/** Varios filtros a la vez, para pantallas con media docena (Destacados). */
export function useFiltrosQuery(): [URLSearchParams, (cambios: Record<string, string | null | undefined>) => void] {
  const [params, setParams] = useSearchParams();
  const set = useCallback(
    (cambios: Record<string, string | null | undefined>) => {
      setParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(cambios)) {
            if (v == null || v === '') n.delete(k);
            else n.set(k, v);
          }
          return n;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [params, set];
}
