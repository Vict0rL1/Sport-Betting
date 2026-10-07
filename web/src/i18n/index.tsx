// i18n (Fase 5.25): español como fuente de verdad, inglés al lado. `t(clave, vars)` sustituye
// {var}; una clave sin traducción cae al español, nunca a la clave. El idioma sale de Ajustes
// (servidor), si no del navegador, y se recuerda localmente.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { es, type Clave } from './es';
import { en } from './en';

export type Idioma = 'es' | 'en';
const CLAVE = 'predictor.idioma';

export function idiomaGuardado(): Idioma | null {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === 'en' || v === 'es' ? v : null;
  } catch {
    return null;
  }
}

export function idiomaDelNavegador(): Idioma {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export type Traducir = (clave: Clave, vars?: Record<string, string | number>) => string;

function traducir(idioma: Idioma, clave: Clave, vars?: Record<string, string | number>): string {
  let s: string = (idioma === 'en' ? en[clave] : undefined) ?? es[clave];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return s;
}

const Ctx = createContext<{ idioma: Idioma; setIdioma: (i: Idioma) => void; t: Traducir }>({ idioma: 'es', setIdioma: () => {}, t: (c, v) => traducir('es', c, v) });

export function I18nProvider({ children, inicial }: { children: ReactNode; inicial?: Idioma }) {
  const [idioma, setIdiomaState] = useState<Idioma>(inicial ?? idiomaGuardado() ?? idiomaDelNavegador());
  useEffect(() => {
    document.documentElement.lang = idioma;
  }, [idioma]);
  const setIdioma = useCallback((i: Idioma) => {
    setIdiomaState(i);
    try {
      localStorage.setItem(CLAVE, i);
    } catch {
      // Vale para esta visita.
    }
  }, []);
  const t = useCallback<Traducir>((c, v) => traducir(idioma, c, v), [idioma]);
  const valor = useMemo(() => ({ idioma, setIdioma, t }), [idioma, setIdioma, t]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

/** Formato de números, fechas y moneda según el idioma (Fase 5.25). */
export function formato(idioma: Idioma) {
  const loc = idioma === 'en' ? 'en-GB' : 'es-ES';
  return {
    numero: (n: number, digitos = 0) => new Intl.NumberFormat(loc, { minimumFractionDigits: digitos, maximumFractionDigits: digitos }).format(n),
    porcentaje: (p: number, digitos = 0) => new Intl.NumberFormat(loc, { style: 'percent', minimumFractionDigits: digitos, maximumFractionDigits: digitos }).format(p),
    moneda: (n: number, moneda = 'EUR') => new Intl.NumberFormat(loc, { style: 'currency', currency: moneda }).format(n),
    fecha: (iso: string, opciones: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) => new Intl.DateTimeFormat(loc, opciones).format(new Date(iso)),
  };
}

export type { Clave };
