// Mis estimaciones guardadas (E3/E4 de la revisión del PR 17). Cada una, tal como se guardó (la
// instantánea no se toca), al lado de la última registrada de ese partido con la diferencia en
// puntos porcentuales, y con una nota personal que se puede escribir, cambiar o borrar.
import { useState } from 'react';
import { Link } from 'react-router';
import { useI18n, formato, type Clave } from '../i18n';
import { useGuardadas, type Guardada } from '../components/guardadas';
import { FalloCarga } from '../components/ui/carga';
import { datosDe } from '../lib/remoto';
import { rutaPartido } from '../rutas';
import type { DeporteId } from '../lib/partidos';

export default function Guardadas() {
  const { t } = useI18n();
  const { estado, recargar } = useGuardadas();
  const lista = datosDe(estado);
  return (
    <div>
      <h1 className="mb-1 text-[24px] font-semibold text-(--ink-strong)">{t('guardadas.titulo')}</h1>
      <p className="mb-4 text-[14px] text-(--ink-muted)">{t('guardadas.nota')}</p>
      {estado.fase === 'apagado' && <p className="text-[14px] text-(--ink-muted)">{t('guardadas.apagado')}</p>}
      {estado.fase === 'error' && <FalloCarga que={t('guardadas.que')} onReintentar={recargar} />}
      {(estado.fase === 'cargando' || estado.fase === 'inicial') && <p className="text-[14px] text-(--ink-muted)">{t('comun.cargando')}</p>}
      {estado.fase === 'error-refresco' && <FalloCarga que={t('guardadas.que')} onReintentar={recargar} />}
      {lista && lista.length === 0 && <p className="rounded-xl bg-(--surface-card) p-5 text-[15px] text-(--ink-muted)">{t('guardadas.vacio')}</p>}
      {lista && lista.length > 0 && (
        <ul className="space-y-3">
          {lista.map((g) => (
            <Fila key={g.id} g={g} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Fila({ g }: { g: Guardada }) {
  const { t, idioma } = useI18n();
  const f = formato(idioma);
  const { quitar, anotar } = useGuardadas();
  const [borrador, setBorrador] = useState<string | null>(null);
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'error'>('listo');
  const outcomes = g.outcomes ?? [];
  const probs = g.probs ?? [];
  const nombre = outcomes.length ? `${outcomes[0]} – ${outcomes[outcomes.length - 1]}` : g.match_key;
  const fecha = (iso?: string) => (iso ? f.fecha(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : t('partido.desconocido'));
  const actual = g.actual ?? null;
  const misma = actual != null && actual.snapshot_id === g.snapshot_id;
  const comparable = actual != null && !misma && actual.probs.length === probs.length && actual.outcomes.every((o, i) => o === outcomes[i]);
  const enlace = g.event_id ? rutaPartido(g.sport, g.event_id) + `?clave=${encodeURIComponent(g.match_key)}` : null;
  const pp = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${f.numero(Math.abs(x), 1)} pp`;

  const guardarNota = async () => {
    if (borrador == null) return;
    setEstado('enviando');
    const ok = await anotar(g.id, borrador.trim() ? borrador : null);
    setEstado(ok ? 'listo' : 'error');
    if (ok) setBorrador(null);
  };

  return (
    <li className="rounded-xl border border-(--line) bg-(--surface-card) p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-(--ink-strong)">
          {enlace ? <Link to={enlace} className="underline-offset-2 hover:underline">{nombre}</Link> : nombre}
        </h2>
        <span className="text-[12px] text-(--ink-muted)">{t(`deporte.${g.sport as DeporteId}` as Clave)}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-(--ink-muted)">{t('guardadas.guardada', { cuando: fecha(g.captured_at) })}</dt>
        <dd className="tabular-nums text-(--ink-strong)">{outcomes.map((o, i) => `${o} ${f.porcentaje(probs[i], 1)}`).join(' · ')}</dd>
        <dt className="text-(--ink-muted)">{actual ? t('guardadas.ultima', { cuando: fecha(actual.captured_at) }) : t('guardadas.ultimaNo')}</dt>
        <dd className="tabular-nums text-(--ink-body)">
          {!actual
            ? t('partido.desconocido')
            : misma
              ? t('guardadas.misma')
              : comparable
                ? `${actual.outcomes.map((o, i) => `${o} ${f.porcentaje(actual.probs[i], 1)}`).join(' · ')} (${actual.probs.map((p, i) => pp((p - probs[i]) * 100)).join(' / ')})`
                : t('guardadas.noComparable')}
        </dd>
      </dl>
      <div className="mt-3">
        {borrador == null ? (
          <p className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
            <span className={g.nota ? 'whitespace-pre-wrap text-(--ink-body)' : 'text-(--ink-muted)'}>{g.nota ?? t('guardadas.sinNota')}</span>
            <button type="button" onClick={() => setBorrador(g.nota ?? '')} className="underline underline-offset-2 text-(--ink-soft) hover:text-(--ink-strong)">
              {g.nota ? t('guardadas.editarNota') : t('guardadas.escribirNota')}
            </button>
          </p>
        ) : (
          <div className="space-y-2">
            <label className="block text-[13px] text-(--ink-muted)">
              {t('guardadas.notaEtiqueta')}
              <textarea value={borrador} maxLength={1000} onChange={(e) => setBorrador(e.target.value)} rows={3} className="mt-1 block w-full rounded-lg border border-(--line-strong) bg-(--surface-page) px-3 py-2 text-[14px] text-(--ink-body)" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={estado === 'enviando'} onClick={() => void guardarNota()} className="rounded-lg bg-(--accent) px-3 py-1.5 text-[13px] font-medium text-(--accent-ink)">{t('guardadas.guardarNota')}</button>
              <button type="button" onClick={() => { setBorrador(null); setEstado('listo'); }} className="rounded-lg px-3 py-1.5 text-[13px] text-(--ink-body) ring-1 ring-(--line)">{t('comun.cancelar')}</button>
            </div>
            {estado === 'error' && <p role="alert" className="text-[13px] text-(--status-critical)">{t('guardadas.notaError')}</p>}
          </div>
        )}
        {g.notaEn && borrador == null && <p className="mt-1 text-[11px] text-(--ink-faint)">{t('guardadas.notaEn', { cuando: fecha(g.notaEn) })}</p>}
      </div>
      <p className="mt-3 text-[12px]">
        <button type="button" onClick={() => void quitar(g.id)} className="underline underline-offset-2 text-(--ink-soft) hover:text-(--ink-strong)">{t('guardadas.quitar')}</button>
      </p>
    </li>
  );
}
