// «Cuenta»: las sesiones abiertas, cerrar otra (o todas las demás) y salir. Solo cuando la puerta
// está activa.

import { useEffect, useRef, useState } from 'react';
import { cerrarLasDemas, revocar, salir, sesiones, type SesionVista } from '../../lib/auth';
import { CrossIcon, LogoutIcon, UserIcon } from '../icons';
import NotificacionesPanel from './NotificacionesPanel';
import { useI18n, type Traducir } from '../../i18n';
import { STATUS, tenido } from '../../lib/theme';

const cuando = (iso: string, loc: string) => new Date(iso).toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Un nombre legible del navegador, sin librería: lo justo para reconocer «el móvil». */
function dispositivo(t: Traducir, ua: string | null): string {
  if (!ua) return t('cuenta.dispositivoDesconocido');
  const so = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : t('cuenta.otro');
  const nav = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : t('cuenta.navegador');
  return `${nav} · ${so}`;
}

export default function AccountPanel({ usuario, onSalir, compacto = false }: { usuario?: string; onSalir: () => void; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<SesionVista[] | null>(null);
  const [error, setError] = useState(false);
  // Aparte del error de leer la lista: `cargar()` lo limpia al volver a leerla, y un fallo al cerrar
  // las demás no puede borrarse solo (quien lo pulsa cree que la sesión robada ya está cerrada).
  const [errorAlCerrar, setErrorAlCerrar] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  // Al cerrar las demás, el botón desaparece: el foco va a «Salir» y no se pierde en la página.
  const salirRef = useRef<HTMLButtonElement>(null);
  const { t, idioma } = useI18n();
  const loc = idioma === 'en' ? 'en-GB' : 'es';

  async function cargar() {
    try {
      setLista((await sesiones()).sesiones);
      setError(false);
    } catch {
      setError(true);
    }
  }
  useEffect(() => {
    if (abierto) void cargar();
  }, [abierto]);

  async function cerrar(s: SesionVista) {
    const r = await revocar(s.id);
    if (r.eraLaActual) onSalir();
    else void cargar();
  }

  return (
    <div className={compacto ? '' : 'mt-auto border-t border-(--line) px-2 py-2'}>
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] text-(--ink-soft) transition hover:bg-(--raised) hover:text-(--ink-strong)"
      >
        <UserIcon size={17} />
        <span className="min-w-0 flex-1 break-words">{t('cuenta.titulo')}{usuario ? ` · ${usuario}` : ''}</span>
        <span className="text-[11px] text-(--ink-faint)">{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && (
        <div className="mx-1 mb-1 rounded-lg bg-(--tint) p-2 text-[12.5px] ring-1 ring-(--line)">
          <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-(--ink-muted)">{t('cuenta.sesiones')}</p>
          {error && <p role="alert" className="px-1" style={{ color: STATUS.critical }}>{t('cuenta.errorSesiones')}</p>}
          {errorAlCerrar && <p role="alert" className="px-1" style={{ color: STATUS.critical }}>{t('cuenta.errorCerrarLasDemas')}</p>}
          {lista && (
            <ul className="divide-y divide-(--line)">
              {lista.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-1 py-1.5">
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="break-words text-(--ink-body)">
                      {dispositivo(t, s.user_agent)}
                      {s.actual && (
                        <span className="ml-1.5 rounded px-1.5 py-px text-[10.5px]" style={{ color: STATUS.good, background: tenido(STATUS.good, 15) }}>
                          {t('cuenta.esta')}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-(--ink-muted)">
                      {t('cuenta.vista', { cuando: cuando(s.last_seen_at, loc) })}
                      {s.ip ? ` · ${s.ip}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => void cerrar(s)}
                    title={s.actual ? t('cuenta.salir') : t('cuenta.cerrarEsta')}
                    aria-label={s.actual ? t('cuenta.salir') : t('cuenta.cerrarDe', { dispositivo: dispositivo(t, s.user_agent) })}
                    className="grid h-7 w-7 place-items-center rounded text-(--ink-muted) hover:bg-(--raised) hover:text-(--ink-strong)"
                  >
                    {s.actual ? <LogoutIcon size={15} /> : <CrossIcon size={14} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Tras cambiar una contraseña filtrada (lote I, I4): una sesión robada que no se use
              mientras tanto sigue viva hasta que se cierra. */}
          {/* Solo con «esta» en la lista: sin ella (entrada por Basic Auth) el servidor dice que no. */}
          {lista && lista.some((s) => s.actual) && lista.some((s) => !s.actual) && (
            <button
              disabled={cerrando}
              onClick={async () => {
                setCerrando(true);
                let ok = false;
                try {
                  await cerrarLasDemas();
                  ok = true;
                } catch {
                  // Se dice abajo y se queda.
                }
                setErrorAlCerrar(!ok);
                setCerrando(false);
                await cargar();
                if (ok) salirRef.current?.focus();
              }}
              className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised) disabled:opacity-60"
            >
              <CrossIcon size={14} />
              {t('cuenta.cerrarLasDemas')}
            </button>
          )}
          <button
            ref={salirRef}
            onClick={async () => {
              await salir();
              onSalir();
            }}
            className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised)"
          >
            <LogoutIcon size={15} />
            {t('cuenta.salir')}
          </button>
          <NotificacionesPanel />
        </div>
      )}
    </div>
  );
}
