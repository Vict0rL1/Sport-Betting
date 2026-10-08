// Sin conexión (Fase 5.26): cuándo fue la última respuesta buena de la API (para el banner
// «Sin conexión: datos de HH:MM») y el registro del service worker.
import { useEffect, useState } from 'react';

const CLAVE = 'predictor.ultimaRed';
let instalada = false;

/** Anota la hora de cada respuesta buena de /api/ (en el navegador; nada sale de él). */
export function instalarMarcaDeRed(): void {
  if (instalada || typeof window === 'undefined') return;
  instalada = true;
  const original = window.fetch.bind(window);
  window.fetch = async (entrada, init) => {
    const res = await original(entrada, init);
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (res.ok && url.includes('/api/') && navigator.onLine) {
      try {
        localStorage.setItem(CLAVE, new Date().toISOString());
      } catch {
        // Sin almacenamiento: el banner dirá «sin hora».
      }
    }
    return res;
  };
}

export function ultimaRed(): string | null {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}

export function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setEnLinea(true);
    const off = () => setEnLinea(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return enLinea;
}

/** Registra el service worker si el interruptor está encendido. Nunca lanza. */
export async function registrarServiceWorker(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const r = await fetch('/api/features');
    if (!r.ok) return;
    const j = (await r.json()) as { features: Record<string, { activa: boolean }> };
    if (j.features['interfaz.sinConexion']?.activa === false) return;
    await navigator.serviceWorker.register('/sw.js');
  } catch {
    // Sin service worker la app funciona igual, solo que no sin conexión.
  }
}
