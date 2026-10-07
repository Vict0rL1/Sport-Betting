import { useEffect, useState } from 'react';
import { activarPush, canales, desactivarPush, probar, pushDisponible, suscripcionActual, type CanalVista } from '../../lib/notificaciones';

const NOMBRES: Record<string, string> = { telegram: 'Telegram', webhook: 'Webhook (Discord/Slack)', email: 'Correo', webpush: 'Este navegador (push)' };

/**
 * Los canales de notificación: cuáles están configurados en el servidor (y qué variable les
 * falta), «enviar prueba» por cada uno, y el interruptor de push de este navegador.
 */
export default function NotificacionesPanel() {
  const [lista, setLista] = useState<CanalVista[] | null>(null);
  const [push, setPush] = useState<boolean | null>(null);
  const [resultado, setResultado] = useState<Record<string, string>>({});

  useEffect(() => {
    canales().then((r) => setLista(r.canales)).catch(() => setLista([]));
    suscripcionActual().then((s) => setPush(!!s)).catch(() => setPush(false));
  }, []);

  async function prueba(canal: string) {
    setResultado((r) => ({ ...r, [canal]: 'enviando…' }));
    try {
      const r = await probar(canal);
      setResultado((x) => ({ ...x, [canal]: r.ok ? 'enviada ✓' : `no: ${r.error ?? 'error'}` }));
    } catch {
      setResultado((x) => ({ ...x, [canal]: 'no se pudo enviar' }));
    }
  }

  async function alternarPush() {
    if (push) {
      await desactivarPush();
      setPush(false);
      return;
    }
    const r = await activarPush();
    setPush(r.ok);
    if (!r.ok) setResultado((x) => ({ ...x, webpush: r.motivo ?? 'no se pudo activar' }));
  }

  return (
    <div className="mt-2">
      <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-[#7b828d]">Notificaciones</p>
      {lista === null && <p className="px-1 text-[#7b828d]">Cargando…</p>}
      {lista && (
        <ul className="divide-y divide-white/[0.05]">
          {lista.map((c) => (
            <li key={c.nombre} className="flex items-center gap-2 px-1 py-1.5">
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[#c3c9d1]">{NOMBRES[c.nombre] ?? c.nombre}</div>
                <div className="truncate text-[11px] text-[#7b828d]">
                  {c.nombre === 'webpush'
                    ? push
                      ? 'activado en este navegador'
                      : pushDisponible()
                        ? c.configurado
                          ? 'desactivado'
                          : `falta ${c.falta.join(', ')} en el servidor`
                        : 'este navegador no lo soporta'
                    : c.configurado
                      ? 'configurado'
                      : `falta ${c.falta.join(', ')}`}
                  {resultado[c.nombre] ? ` · ${resultado[c.nombre]}` : ''}
                </div>
              </div>
              {c.nombre === 'webpush' ? (
                <button onClick={() => void alternarPush()} disabled={!pushDisponible() || !c.configurado} className="rounded-md px-2 py-1 text-[11px] text-[#9aa1ac] ring-1 ring-white/[0.1] hover:text-[#e8eaed] disabled:opacity-40">
                  {push ? 'desactivar' : 'activar'}
                </button>
              ) : (
                <button onClick={() => void prueba(c.nombre)} disabled={!c.configurado} className="rounded-md px-2 py-1 text-[11px] text-[#9aa1ac] ring-1 ring-white/[0.1] hover:text-[#e8eaed] disabled:opacity-40">
                  probar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 px-1 text-[11px] text-[#5c636c]">Avisos: valor encontrado, línea movida, apuesta de papel hecha o liquidada, trabajo fallido, deriva. Se configuran en el .env (ver docs/NOTIFICACIONES.md).</p>
    </div>
  );
}
