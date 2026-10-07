// i18n (Fase 5.25): español como fuente de verdad, inglés al lado. `t(clave, vars)` sustituye
// {var}; una clave sin traducción cae al español, nunca a la clave. El idioma sale de Ajustes
// (servidor), si no del navegador, y se recuerda localmente.

import { createContext, createElement, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
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

/** El traductor puro, para lo que no es un componente (lib/format.ts): mismo resultado que `t`. */
export function tr(idioma: Idioma, clave: Clave, vars?: Record<string, string | number>): string {
  return traducir(idioma, clave, vars);
}

/** El locale de `Intl` / `toLocale*` para cada idioma. */
export const localeDe = (idioma: Idioma) => (idioma === 'en' ? 'en-GB' : 'es');

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

/**
 * Una frase traducida con elementos dentro (negritas, enlaces): las marcas `{nombre}` que tengan
 * nodo se sustituyen por él y el resto del texto queda tal cual. Así la frase entera vive en el
 * catálogo, en su orden de cada lengua, y no partida en trozos que no se pueden traducir.
 */
export function conNodos(texto: string, nodos: Record<string, ReactNode>): ReactNode[] {
  return texto.split(/(\{\w+\})/).map((trozo, i) => {
    const m = /^\{(\w+)\}$/.exec(trozo);
    // Sin JSX a propósito: los tests de la web cargan este módulo sin la configuración de JSX.
    return m && m[1] in nodos ? createElement(Fragment, { key: i }, nodos[m[1]]) : trozo;
  });
}

/**
 * Los códigos que manda el servidor (ALTA, BAJO, NO BET, SIN MERCADO…) en el idioma de la pantalla.
 * Un código sin entrada en el catálogo se enseña tal cual: nunca la clave.
 */
export function codigo(t: Traducir, c: string): string {
  const k = `codigo.${c}`;
  return k in es ? t(k as Clave) : c;
}

export type { Clave };
