// «Cuenta»: las sesiones abiertas, cerrar otra y salir. Solo cuando la puerta está activa.

import { useEffect, useState } from 'react';
import { revocar, salir, sesiones, type SesionVista } from '../../lib/auth';
import { CrossIcon, LogoutIcon, UserIcon } from '../icons';
import NotificacionesPanel from './NotificacionesPanel';

const cuando = (iso: string) => new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Un nombre legible del navegador, sin librería: lo justo para reconocer «el móvil». */
function dispositivo(ua: string | null): string {
  if (!ua) return 'Dispositivo desconocido';
  const so = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  const nav = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl/.test(ua) ? 'curl' : 'navegador';
  return `${nav} · ${so}`;
}

export default function AccountPanel({ usuario, onSalir, compacto = false }: { usuario?: string; onSalir: () => void; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState<SesionVista[] | null>(null);
  const [error, setError] = useState(false);

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
    <div className={compacto ? '' : 'mt-auto border-t border-white/[0.06] px-2 py-2'}>
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] text-[#9aa1ac] transition hover:bg-white/[0.04] hover:text-[#e8eaed]"
      >
        <UserIcon size={17} />
        <span className="min-w-0 flex-1 truncate">Cuenta{usuario ? ` · ${usuario}` : ''}</span>
        <span className="text-[11px] text-[#5c636c]">{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && (
        <div className="mx-1 mb-1 rounded-lg bg-white/[0.03] p-2 text-[12.5px] ring-1 ring-white/[0.06]">
          <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-[#7b828d]">Sesiones abiertas</p>
          {error && <p className="px-1 text-[#e66767]">No se pudieron leer las sesiones.</p>}
          {lista && (
            <ul className="divide-y divide-white/[0.05]">
              {lista.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-1 py-1.5">
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[#c3c9d1]">
                      {dispositivo(s.user_agent)}
                      {s.actual && <span className="ml-1.5 rounded bg-[#199e70]/15 px-1.5 py-px text-[10.5px] text-[#2cb585]">esta</span>}
                    </div>
                    <div className="text-[11px] text-[#7b828d]">
                      vista {cuando(s.last_seen_at)}
                      {s.ip ? ` · ${s.ip}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => void cerrar(s)}
                    title={s.actual ? 'Salir' : 'Cerrar esta sesión'}
                    aria-label={s.actual ? 'Salir' : `Cerrar sesión de ${dispositivo(s.user_agent)}`}
                    className="grid h-7 w-7 place-items-center rounded text-[#7b828d] hover:bg-white/[0.06] hover:text-[#e8eaed]"
                  >
                    {s.actual ? <LogoutIcon size={15} /> : <CrossIcon size={14} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={async () => {
              await salir();
              onSalir();
            }}
            className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-[#c3c9d1] ring-1 ring-white/10 hover:bg-white/[0.05]"
          >
            <LogoutIcon size={15} />
            Salir
          </button>
          <NotificacionesPanel />
        </div>
      )}
    </div>
  );
}
