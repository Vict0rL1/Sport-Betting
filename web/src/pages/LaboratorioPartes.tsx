// Piezas del laboratorio (Fase 6.1): el formulario de una estrategia nueva, «¿qué habría
// pasado?» y la vista de un resultado histórico.
import { useState } from 'react';
import { useI18n, formato, type Idioma, type Traducir } from '../i18n';
import { enviarJson } from '../lib/usarJson';
import { PLANTILLAS, formularioDesde, peticionDe, type ConfigEstrategia, type Formulario, type Historico, type RespuestaLab } from '../lib/estrategias';
import { LineChart, COLOR_BENEFICIO, COLOR_PERDIDA } from '../components/charts';
import { pillClass } from '../components/ui';

export function resumenConfig(c: ConfigEstrategia, t: Traducir, idioma: Idioma): string {
  const f = formato(idioma);
  const partes = [
    c.deportes.map((d) => t(`deporte.${d}` as never)).join(', '),
    t('lab.cfg.ventaja', { v: f.porcentaje(c.staking.minEdge, 1) }),
    t('lab.cfg.kelly', { k: c.staking.kellyFraction === 0.2 ? '1/5' : '1/4' }),
    t('lab.cfg.tope', { v: f.porcentaje(c.staking.maxPerEvent, 1) }),
  ];
  if (!c.confianza) partes.push(t('lab.cfg.sinConfianza'));
  if (!c.calibracion) partes.push(t('lab.cfg.sinFreno'));
  return partes.join(' · ');
}

const entrada = 'w-full rounded-lg bg-(--raised) px-3 py-2 text-[15px] text-(--ink-strong) ring-1 ring-inset ring-(--line) focus:outline-none focus:ring-(--line-strong)';

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-(--ink-muted)">{etiqueta}</span>
      {children}
    </label>
  );
}

export function NuevaEstrategia({ datos, onCreada }: { datos: RespuestaLab; onCreada: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState<Formulario>(() => formularioDesde(datos.politica, datos.limites.deportes));
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState<Historico | null>(null);
  const conHistorico = datos.historicos.filter((h) => h.partidos > 0).map((h) => h.sport);
  const [deportePrevia, setDeportePrevia] = useState(conHistorico[0] ?? '');
  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }));
  const crear = async () => {
    setOcupado(true);
    setError(null);
    try {
      await enviarJson('/api/estrategias', 'POST', peticionDe(f));
      setF(formularioDesde(datos.politica, datos.limites.deportes));
      setPrevia(null);
      onCreada();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };
  const verPrevia = async () => {
    setError(null);
    try {
      const p = peticionDe(f);
      setPrevia(await enviarJson<Historico>('/api/estrategias/historico', 'POST', { sport: deportePrevia, staking: p.staking, calibracion: p.calibracion }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const numero = (k: 'minEdge' | 'maxPerEvent' | 'maxTotalExposure' | 'dailyLossLimit' | 'weeklyLossLimit', etiqueta: string) => (
    <Campo etiqueta={etiqueta}>
      <input className={entrada} inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </Campo>
  );
  return (
    <section className="mb-6 rounded-xl border border-(--line) bg-(--surface-card) p-4" aria-labelledby="nueva-estrategia">
      <h3 id="nueva-estrategia" className="mb-1 text-[16px] font-semibold text-(--ink-strong)">{t('lab.nueva')}</h3>
      <p className="mb-3 text-[13px] text-(--ink-muted)">{t('lab.nuevaNota')}</p>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-(--ink-muted)">{t('lab.plantillas')}:</span>
        {(Object.keys(PLANTILLAS) as (keyof typeof PLANTILLAS)[]).map((k) => (
          <button key={k} type="button" className={pillClass(false)} onClick={() => setF((x) => PLANTILLAS[k](x))}>
            {t(`lab.plantilla.${k}`)}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta={t('lab.nombre')}>
          <input className={entrada} value={f.nombre} maxLength={60} onChange={(e) => set('nombre', e.target.value)} />
        </Campo>
        <Campo etiqueta={t('lab.nota')}>
          <input className={entrada} value={f.nota} maxLength={500} onChange={(e) => set('nota', e.target.value)} />
        </Campo>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-(--ink-muted)">{t('lab.deportes')}</legend>
          <div className="flex flex-wrap gap-1.5">
            {datos.limites.deportes.map((d) => {
              const on = f.deportes.includes(d);
              return (
                <button key={d} type="button" aria-pressed={on} className={pillClass(on)} onClick={() => set('deportes', on ? f.deportes.filter((x) => x !== d) : [...f.deportes, d])}>
                  {t(`deporte.${d}` as never)}
                </button>
              );
            })}
          </div>
        </fieldset>
        {numero('minEdge', t('lab.minEdge'))}
        <Campo etiqueta={t('lab.kelly')}>
          <select className={entrada} value={f.kellyFraction} onChange={(e) => set('kellyFraction', e.target.value as Formulario['kellyFraction'])}>
            <option value="0.25">1/4</option>
            <option value="0.2">1/5</option>
          </select>
        </Campo>
        {numero('maxPerEvent', t('lab.maxPorEvento'))}
        {numero('maxTotalExposure', t('lab.maxTotal'))}
        {numero('dailyLossLimit', t('lab.perdidaDiaria'))}
        {numero('weeklyLossLimit', t('lab.perdidaSemanal'))}
        <label className="flex items-start gap-2 text-[14px] text-(--ink-body) sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={f.confianza} onChange={(e) => set('confianza', e.target.checked)} />
          {t('lab.confianza')}
        </label>
        <label className="flex items-start gap-2 text-[14px] text-(--ink-body) sm:col-span-2">
          <input type="checkbox" className="mt-1" checked={f.calibracion} onChange={(e) => set('calibracion', e.target.checked)} />
          {t('lab.calibracion')}
        </label>
      </div>
      {error && <p className="mt-3 text-[13px]" role="alert" style={{ color: COLOR_PERDIDA }}>{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button onClick={() => void crear()} disabled={ocupado} className="rounded-lg bg-(--raised-2) px-3.5 py-2 text-[14px] font-medium text-(--ink-strong) ring-1 ring-inset ring-(--line-strong) hover:bg-(--raised-3) disabled:opacity-60">
          {ocupado ? t('lab.creando') : t('lab.crear')}
        </button>
        {conHistorico.length > 0 && (
          <>
            <select aria-label={t('lab.deporte')} className="rounded-lg bg-(--raised) px-2 py-2 text-[14px] text-(--ink-strong) ring-1 ring-(--line)" value={deportePrevia} onChange={(e) => setDeportePrevia(e.target.value)}>
              {conHistorico.map((d) => (
                <option key={d} value={d}>{t(`deporte.${d}` as never)}</option>
              ))}
            </select>
            <button onClick={() => void verPrevia()} className="rounded-lg px-3 py-2 text-[14px] text-(--ink-body) ring-1 ring-(--line) hover:bg-(--raised)">
              {t('lab.vistaPrevia')}
            </button>
          </>
        )}
      </div>
      {previa && <VistaHistorico h={previa} />}
    </section>
  );
}

export function QueHabriaPasado({ datos }: { datos: RespuestaLab }) {
  const { t } = useI18n();
  const conHistorico = datos.historicos.filter((h) => h.partidos > 0).map((h) => h.sport);
  const [sport, setSport] = useState(conHistorico[0] ?? '');
  const [id, setId] = useState('principal');
  const [r, setR] = useState<Historico | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const calcular = async () => {
    setOcupado(true);
    setError(null);
    try {
      const q = new URLSearchParams({ sport, id });
      const res = await fetch(`/api/estrategias/historico?${q}`);
      const j = (await res.json()) as Historico & { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setR(j);
    } catch (e) {
      setError((e as Error).message);
      setR(null);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <section className="mb-6 rounded-xl border border-(--line) p-4" aria-labelledby="que-habria-pasado">
      <h3 id="que-habria-pasado" className="mb-1 text-[16px] font-semibold text-(--ink-strong)">{t('lab.historico')}</h3>
      <p className="mb-3 text-[13px] text-(--ink-muted)">{t('lab.historicoNota')}</p>
      {conHistorico.length === 0 ? (
        <p className="text-[13px] text-(--ink-soft)">{t('lab.sinHistorico')}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Campo etiqueta={t('lab.deporte')}>
            <select className={entrada} value={sport} onChange={(e) => setSport(e.target.value)}>
              {conHistorico.map((d) => (
                <option key={d} value={d}>{t(`deporte.${d}` as never)}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta={t('lab.estrategia')}>
            <select className={entrada} value={id} onChange={(e) => setId(e.target.value)}>
              <option value="principal">{t('lab.politicaVigente')}</option>
              {datos.estrategias.map((e) => (
                <option key={e.id} value={String(e.id)}>{e.nombre}</option>
              ))}
            </select>
          </Campo>
          <button onClick={() => void calcular()} disabled={ocupado} className="rounded-lg bg-(--raised-2) px-3.5 py-2 text-[14px] font-medium text-(--ink-strong) ring-1 ring-inset ring-(--line-strong) hover:bg-(--raised-3) disabled:opacity-60">
            {ocupado ? t('lab.calculando') : t('lab.calcular')}
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-[13px]" role="alert" style={{ color: COLOR_PERDIDA }}>{error}</p>}
      {r && <VistaHistorico h={r} />}
    </section>
  );
}

export function VistaHistorico({ h }: { h: Historico }) {
  const { t, idioma } = useI18n();
  const f = formato(idioma);
  const color = (x: number | null) => (x == null ? undefined : x > 0 ? COLOR_BENEFICIO : x < 0 ? COLOR_PERDIDA : undefined);
  const celdas: [string, string, string | undefined][] = [
    [t('lab.apuestas'), String(h.apuestas), undefined],
    [t('lab.acierto'), h.acierto == null ? '—' : f.porcentaje(h.acierto, 1), undefined],
    [t('lab.roi'), h.roi == null ? '—' : f.porcentaje(h.roi, 1), color(h.roi)],
    [t('lab.bancoFinal'), f.numero(h.bancoFinal, 2), color(h.beneficio)],
    [t('lab.drawdown'), h.drawdown ? f.porcentaje(h.drawdown.pct, 1) : '—', undefined],
    [t('lab.clv'), h.clvMedio == null ? t('lab.desconocido') : f.porcentaje(h.clvMedio, 2), color(h.clvMedio)],
  ];
  return (
    <div className="mt-4 border-t border-(--line) pt-3" data-testid="resultado-historico">
      {h.desde && h.hasta && (
        <p className="mb-2 text-[12px] text-(--ink-muted)">
          {t('lab.partidos', { n: f.numero(h.partidos), desde: h.desde, hasta: h.hasta })}
          {h.temporadas ? ` · ${t('lab.temporadas', { desde: h.temporadas.desde, hasta: h.temporadas.hasta })}` : ''}
          {h.fuente ? ` · ${h.fuente}` : ''}
        </p>
      )}
      {h.motivo && <p className="mb-2 text-[13px] text-(--ink-body)">{h.motivo}</p>}
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6">
        {celdas.map(([k, v, c]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-(--ink-muted)">{k}</dt>
            <dd className="text-[15px] font-semibold tabular-nums text-(--ink-strong)" style={c ? { color: c } : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
      {h.aviso.texto && <p className="mt-2 text-[12px] text-(--ink-soft)">{h.aviso.texto}</p>}
      {h.curva.length > 1 && (
        <div className="mt-3">
          <LineChart
            titulo={t('lab.curva')}
            series={[{ nombre: t('lab.banco'), puntos: h.curva.map((p) => ({ x: Date.parse(p.fecha), y: p.banco })), color: h.beneficio >= 0 ? COLOR_BENEFICIO : COLOR_PERDIDA }]}
            formatoX={(x) => new Date(x).getUTCFullYear().toString()}
            referencia={{ y: 1000, etiqueta: '1.000' }}
          />
        </div>
      )}
      {h.porTemporada.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] text-(--ink-soft)">{t('lab.porTemporada')}</summary>
          <table className="mt-2 w-full text-[13px] tabular-nums">
            <thead>
              <tr className="text-left text-(--ink-muted)">
                <th className="py-1 font-medium">{t('lab.temporada')}</th>
                <th className="py-1 font-medium">{t('lab.apuestas')}</th>
                <th className="py-1 font-medium">{t('lab.roi')}</th>
              </tr>
            </thead>
            <tbody>
              {h.porTemporada.map((s) => (
                <tr key={s.temporada} className="border-t border-(--line)">
                  <td className="py-1 text-(--ink-body)">{s.temporada}</td>
                  <td className="py-1 text-(--ink-body)">{s.apuestas}</td>
                  <td className="py-1" style={{ color: color(s.roi) }}>{s.roi == null ? '—' : f.porcentaje(s.roi, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-(--ink-muted)">
        {h.notas.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
