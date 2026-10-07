// Diagnóstico (Fase 5.6): lo que antes estaba repartido —latencia del escáner en Apuestas,
// ingestas y errores en ninguna parte de la pantalla— junto, bajo Confianza. Una página para
// contestar «¿funciona todo?» sin abrir la terminal.

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import LatencyPanel from '../components/LatencyPanel';
import { STATUS } from '../lib/theme';
import { StatusMark } from '../components/icons';
import { useI18n } from '../i18n';
import { SubNav } from '../components/nav/SubNav';
import { useSubnavConfianza } from './subnav';

interface Ejecucion { id: number; source: string; started_at: string; finished_at: string | null; status: 'running' | 'ok' | 'error'; rows_added: number | null; rows_updated: number | null; error: string | null; detail: string | null }
interface Trabajo { nombre: string; descripcion: string; cadenciaMin: number; cadenciaPorDefecto: number; enabled: boolean; lastRunAt: string | null; lastDurationMs: number | null; lastStatus: 'ok' | 'error' | 'running' | null; lastError: string | null; nextRunAt: string | null; runsOk: number; runsError: number }
interface ErrorFila { id: number; created_at: string; request_id: string | null; method: string | null; url: string | null; status: number; message: string }
interface DatosEstado { layout: string; history: { ruta: string; mb: number | null }; ledger: { ruta: string; mb: number | null } | null; backup: Record<string, unknown>; retencion: { ultima: string | null; borradas: number } }
interface Cuota { remaining: number | null; used: number | null; hasKey: boolean; reserve: number; plan: number | null; lastError: string | null; autoRefreshMinutes: number; recommendedRefreshMinutes: number | null }

const fecha = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const colorEstado = (s: string | null) => (s === 'ok' ? STATUS.good : s === 'error' ? STATUS.critical : STATUS.warning);

function usarJson<T>(url: string): T | null | 'error' {
  const [d, setD] = useState<T | null | 'error'>(null);
  useEffect(() => {
    let vivo = true;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: T) => vivo && setD(j))
      .catch(() => vivo && setD('error'));
    return () => {
      vivo = false;
    };
  }, [url]);
  return d;
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-(--line) p-4">
      <h3 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{titulo}</h3>
      <div className="text-[13px] leading-relaxed text-(--ink-soft)">{children}</div>
    </section>
  );
}

export default function Diagnostico() {
  const { t } = useI18n();
  const subnav = useSubnavConfianza();
  const ingestas = usarJson<{ ultimas: Ejecucion[]; historial: Ejecucion[] }>('/api/ingestion-runs');
  const errores = usarJson<{ errores: ErrorFila[]; total24h: number }>('/api/errores?limite=30');
  const trabajos = usarJson<{ arrancado: boolean; trabajos: Trabajo[] }>('/api/scheduler');
  const datos = usarJson<DatosEstado>('/api/datos/estado');
  const cuota = usarJson<Cuota>('/api/odds-quota');
  const rendimiento = usarJson<{ cache: { entradas: number; aciertos: number; fallos: number; on: boolean; ttlSegundos: number }; compresion: boolean }>('/api/rendimiento');
  return (
    <div>
      <p className="mb-1 text-[12px] text-(--ink-muted)">
        <Link to="/confianza" className="underline-offset-2 hover:underline">Confianza</Link> › Diagnóstico
      </p>
      <SubNav etiqueta={t('nav.subConfianza')} enlaces={subnav} />
      <h2 className="mb-1 text-[20px] font-semibold text-(--ink-strong)">{t('nav.diagnostico')}</h2>
      <p className="mb-4 text-[13px] text-(--ink-muted)">{t('diag.intro')}</p>

      <Bloque titulo={t('ajustes.cadencias')}>
        {trabajos === 'error' && <p>{t('comun.error')}</p>}
        {trabajos && trabajos !== 'error' && (
          <>
            <p className="mb-2">{trabajos.arrancado ? t('diag.registroEnMarcha') : t('diag.registroParado')}</p>
            <ul className="space-y-1">
              {trabajos.trabajos.map((t) => (
                <li key={t.nombre} className="flex flex-wrap items-baseline gap-x-2">
                  <StatusMark estado={t.lastStatus === 'ok' ? 'ok' : t.lastStatus === 'error' ? 'error' : 'aviso'} color={colorEstado(t.lastStatus)} />
                  <span className="text-(--ink-body)">{t.nombre}</span>
                  <span>{t.enabled ? `cada ${t.cadenciaMin} min${t.cadenciaMin !== t.cadenciaPorDefecto ? ` (código: ${t.cadenciaPorDefecto})` : ''}` : 'apagado'}</span>
                  <span>· última {fecha(t.lastRunAt)}{t.lastDurationMs != null ? ` (${(t.lastDurationMs / 1000).toFixed(1)} s)` : ''} · {t.runsOk} ok / {t.runsError} error</span>
                  {t.lastError && <span style={{ color: STATUS.critical }}>{t.lastError}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Bloque>

      {rendimiento && rendimiento !== 'error' && (
        <Bloque titulo={t('diag.rendimiento')}>
          <p>
            {rendimiento.cache.on
              ? t('diag.cache', { aciertos: rendimiento.cache.aciertos, fallos: rendimiento.cache.fallos, entradas: rendimiento.cache.entradas, ttl: rendimiento.cache.ttlSegundos })
              : t('diag.cacheApagada')}
          </p>
          <p>{rendimiento.compresion ? t('diag.compresion') : t('diag.compresionApagada')}</p>
        </Bloque>
      )}

      <Bloque titulo={t('diag.ingestas')}>
        {ingestas === 'error' && <p>{t('comun.error')}</p>}
        {ingestas && ingestas !== 'error' && (ingestas.ultimas.length === 0 ? <p>{t('diag.sinIngestas')}</p> : (
          <ul className="space-y-1">
            {ingestas.ultimas.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                <StatusMark estado={e.status === 'ok' ? 'ok' : e.status === 'error' ? 'error' : 'aviso'} color={colorEstado(e.status)} />
                <span className="text-(--ink-body)">{e.source}</span>
                <span>{fecha(e.finished_at ?? e.started_at)}</span>
                {e.rows_added != null && <span>· {e.rows_added} añadidas{e.rows_updated != null ? `, ${e.rows_updated} actualizadas` : ''}</span>}
                {e.error && <span style={{ color: STATUS.critical }}>{e.error}</span>}
              </li>
            ))}
          </ul>
        ))}
      </Bloque>

      <Bloque titulo={t('diag.errores')}>
        {errores === 'error' && <p>{t('diag.erroresNoDisponibles')}</p>}
        {errores && errores !== 'error' && (
          <>
            <p className="mb-1">{t('diag.errores24h', { n: errores.total24h })}</p>
            {errores.errores.length === 0 ? <p>{t('diag.ningunError')}</p> : (
              <ul className="space-y-1">
                {errores.errores.map((e) => (
                  <li key={e.id} className="break-words">
                    <span className="text-(--ink-faint)">{fecha(e.created_at)}</span> {e.status} {e.method} {e.url} — {e.message}
                    {e.request_id && <span className="text-(--ink-faint)"> ({e.request_id})</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Bloque>

      <Bloque titulo={t('diag.base')}>
        {datos === 'error' && <p>{t('comun.error')}</p>}
        {datos && datos !== 'error' && (
          <>
            <p>Disposición: {datos.layout} · history.db {datos.history.mb != null ? `${datos.history.mb.toFixed(1)} MB` : ''}{datos.ledger ? ` · ledger.db ${datos.ledger.mb != null ? `${datos.ledger.mb.toFixed(1)} MB` : ''}` : ''}</p>
            <p>Última copia: {fecha(String((datos.backup as { ultima?: string | null }).ultima ?? '') || null)} · retención de snapshots: {datos.retencion.ultima ? `${fecha(datos.retencion.ultima)}, ${datos.retencion.borradas} borradas` : 'sin pasada'}</p>
          </>
        )}
      </Bloque>

      <Bloque titulo={t('diag.cuota')}>
        {cuota === 'error' && <p>{t('comun.error')}</p>}
        {cuota && cuota !== 'error' && (!cuota.hasKey ? <p>{t('diag.sinClave')}</p> : (
          <p>
            {cuota.remaining ?? '?'} peticiones restantes{cuota.plan ? ` de ${cuota.plan.toLocaleString('es')}` : ''}{cuota.used != null ? ` · ${cuota.used} usadas` : ''} · reserva {cuota.reserve} · refresco cada {cuota.recommendedRefreshMinutes ?? cuota.autoRefreshMinutes} min
            {cuota.lastError && <span style={{ color: STATUS.critical }}> · {cuota.lastError}</span>}
          </p>
        ))}
      </Bloque>

      <LatencyPanel />
    </div>
  );
}
