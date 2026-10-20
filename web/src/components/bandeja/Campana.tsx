// La campana (Fase 6.4): cuántos avisos sin leer, con enlace a la bandeja. Se refresca cada
// minuto, al volver a la pestaña y cuando la bandeja marca algo. Si la bandeja está apagada, no sale.
//
// Mientras llega la cuenta, su sitio (N14, lote N). Llegaba a los 950 ms, y en el móvil la cabecera
// crecía 2 px (la campana es más alta que la fila) y 10 a 280 y 300 px, donde el nombre de la app
// bajaba de línea; en la barra lateral, la fila se partía en dos y los deportes bajaban. El sitio no
// se guarda si la vez anterior la bandeja estaba apagada: entonces no sale nada, como antes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n';
import { STATUS } from '../../lib/theme';

export const EVENTO_BANDEJA = 'predictor:bandeja';
const CLAVE = 'predictor.campana';

function apagadaLaUltimaVez(): boolean {
  try {
    return localStorage.getItem(CLAVE) === '0';
  } catch {
    return false;
  }
}

function recordar(sale: boolean) {
  try {
    localStorage.setItem(CLAVE, sale ? '1' : '0');
  } catch {
    // Sin almacenamiento, la próxima vez se guarda el sitio, como con la bandeja encendida.
  }
}

const CAJA = 'relative grid h-8 w-8 place-items-center rounded-lg';

export default function Campana() {
  const { t } = useI18n();
  // undefined: aún no se sabe; null: la bandeja está apagada (404).
  const [n, setN] = useState<number | null | undefined>(undefined);
  const [reservar] = useState(() => !apagadaLaUltimaVez());
  useEffect(() => {
    let vivo = true;
    const leer = () =>
      fetch('/api/bandeja/contador')
        .then((r) => {
          if (r.status === 404) return null;
          return r.ok ? (r.json() as Promise<{ noLeidas: number }>).then((j) => j.noLeidas) : Promise.reject();
        })
        .then((x) => {
          if (!vivo) return;
          setN(x);
          recordar(x != null);
        })
        // Un fallo de red no dice que esté apagada: se queda lo que había.
        .catch(() => {});
    void leer();
    const id = setInterval(leer, 60_000);
    window.addEventListener('focus', leer);
    window.addEventListener(EVENTO_BANDEJA, leer);
    return () => {
      vivo = false;
      clearInterval(id);
      window.removeEventListener('focus', leer);
      window.removeEventListener(EVENTO_BANDEJA, leer);
    };
  }, []);
  if (n === undefined) return reservar ? <span aria-hidden className={`invisible ${CAJA}`} /> : null;
  if (n === null) return null;
  return (
    <Link
      to="/bandeja"
      aria-label={t('bandeja.campana', { n })}
      data-testid="campana"
      className={`toque ${CAJA} text-(--ink-soft) ring-1 ring-(--line) hover:bg-(--raised) hover:text-(--ink-strong)`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 && (
        <span className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] rounded-full px-1 text-center text-[10px] font-semibold leading-[1.1rem]" style={{ backgroundColor: STATUS.critical, color: 'var(--ink-on-fill)' }}>
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
