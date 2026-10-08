import { useEffect, useState } from 'react';
import { useI18n, type Clave } from '../../i18n';
import { activarPush, canales, desactivarPush, probar, pushDisponible, suscripcionActual, type CanalVista } from '../../lib/notificaciones';

const NOMBRES: Record<string, string | Clave> = { telegram: 'Telegram', webhook: 'Webhook (Discord/Slack)', email: 'notif.canal.email', webpush: 'notif.canal.webpush' };

/**
 * Los canales de notificación: cuáles están configurados en el servidor (y qué variable les
 * falta), «enviar prueba» por cada uno, y el interruptor de push de este navegador.
 */
export default function NotificacionesPanel() {
  const { t } = useI18n();
  const nombre = (n: string) => {
    const v = NOMBRES[n];
    return v == null ? n : v.startsWith('notif.') ? t(v as Clave) : v;
  };
  const [lista, setLista] = useState<CanalVista[] | null>(null);
  const [push, setPush] = useState<boolean | null>(null);
  const [resultado, setResultado] = useState<Record<string, string>>({});

  useEffect(() => {
    canales().then((r) => setLista(r.canales)).catch(() => setLista([]));
    suscripcionActual().then((s) => setPush(!!s)).catch(() => setPush(false));
  }, []);

  async function prueba(canal: string) {
    setResultado((r) => ({ ...r, [canal]: t('notif.enviando') }));
    try {
      const r = await probar(canal);
      setResultado((x) => ({ ...x, [canal]: r.ok ? t('notif.enviada') : t('notif.no', { error: r.error ?? 'error' }) }));
    } catch {
      setResultado((x) => ({ ...x, [canal]: t('notif.noEnviar') }));
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
    if (!r.ok) setResultado((x) => ({ ...x, webpush: r.motivo ?? t('notif.noActivar') }));
  }

  return (
    <div className="mt-2">
      <p className="mb-1.5 px-1 text-[11px] uppercase tracking-wide text-(--ink-muted)">{t('notif.titulo')}</p>
      {lista === null && <p className="px-1 text-(--ink-muted)">{t('comun.cargando')}</p>}
      {lista && (
        <ul className="divide-y divide-(--line)">
          {lista.map((c) => (
            <li key={c.nombre} className="flex items-center gap-2 px-1 py-1.5">
              <div className="min-w-0 flex-1 leading-tight">
                <div className="break-words text-(--ink-body)">{nombre(c.nombre)}</div>
                <div className="break-words text-[11px] text-(--ink-muted)">
                  {c.nombre === 'webpush'
                    ? push
                      ? t('notif.activado')
                      : pushDisponible()
                        ? c.configurado
                          ? t('notif.desactivado')
                          : t('notif.faltaServidor', { vars: c.falta.join(', ') })
                        : t('notif.noSoporta')
                    : c.configurado
                      ? t('notif.configurado')
                      : t('notif.falta', { vars: c.falta.join(', ') })}
                  {resultado[c.nombre] ? ` · ${resultado[c.nombre]}` : ''}
                </div>
              </div>
              {c.nombre === 'webpush' ? (
                <button onClick={() => void alternarPush()} disabled={!pushDisponible() || !c.configurado} className="rounded-md px-2 py-1 text-[11px] text-(--ink-soft) ring-1 ring-(--line) hover:text-(--ink-strong) disabled:opacity-40">
                  {push ? t('notif.desactivar') : t('notif.activar')}
                </button>
              ) : (
                <button onClick={() => void prueba(c.nombre)} disabled={!c.configurado} className="rounded-md px-2 py-1 text-[11px] text-(--ink-soft) ring-1 ring-(--line) hover:text-(--ink-strong) disabled:opacity-40">
                  {t('notif.probar')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 px-1 text-[11px] text-(--ink-faint)">{t('notif.avisos')}</p>
    </div>
  );
}
