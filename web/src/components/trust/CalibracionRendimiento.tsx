// Fase E del seguimiento del PR #18: la calibración POR PARTIDO y el rendimiento POR PERIODO
// (server/src/evaluation/calibracion.ts, definiciones de quant-reviewer). Cada vista tiene su tabla:
// el gráfico y la tabla salen de la misma respuesta y dicen lo mismo. Lo que no tiene muestra se dice
// y no se dibuja; los puntos llevan su intervalo y no se unen con una línea (cada periodo es ruido
// propio, y unirlos sugiere una tendencia que la muestra no sostiene).

import { useEffect, useState } from 'react';
import { HOME_COLOR } from '../../lib/theme';
import { useI18n, type Clave } from '../../i18n';
import { num as numF, pct as pctF } from '../../lib/formato';

type Deporte = 'football' | 'basketball' | 'baseball' | 'nfl' | 'nhl' | 'ufc' | 'tennis';
type Cohorte = 'final' | 'legado';
type IC = { lo: number; hi: number } | null;

interface Cubeta { desde: number; hasta: number; n: number; predichaMedia: number | null; observada: number | null; ic95: IC; nivel: string }
interface Panel {
  clase: 'local' | 'empate' | 'visitante';
  n: number;
  cubetas: Cubeta[];
  conjunto: { n: number; predichaMedia: number | null; observada: number | null; ic95: IC; citlZ: number | null; spiegelhalterZ: number | null; veredicto: 'insuficiente' | 'descalibrado' | 'sin-evidencia'; nivel: string };
}
interface Calibracion {
  resultados: number;
  partidos: number;
  excluidas: Record<string, number>;
  versiones: { version: string; n: number }[];
  paneles: Panel[];
  umbrales: { cubetaMin: number; conjuntoMin: number; zCritico: number };
  motivo: 'zona-invalida' | null;
}
interface Mercado { n: number; brierModelo: number | null; brierMercado: number | null; delta: number | null; ic95: IC }
interface Punto { periodo: string; parcial: boolean; n: number; brier: number | null; ic95: IC; logLoss: number | null; mercado: Mercado | null; nivel: string; motivo: string | null }
interface Rendimiento {
  zona: string | null;
  referencia: { uniforme: number };
  umbrales: { puntoMin: number; insuficiente: number };
  series: { cohorte: Cohorte; version: string; puntos: Punto[] }[];
  resumen: { cohorte: Cohorte; version: string; n: number; brier: number | null; ic95: IC; logLoss: number | null; mercado: Mercado | null; nivel: string }[];
  excluidas: Record<string, Record<string, number>>;
  motivo: 'zona-invalida' | null;
}

function usar<T>(url: string): T | null | 'error' {
  const [d, setD] = useState<T | null | 'error'>(null);
  useEffect(() => {
    let vivo = true;
    setD(null);
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

/** Un selector de dos o más opciones, como los demás de la página (botones con aria-pressed). */
function Selector<T extends string>({ etiqueta, valor, opciones, cambiar }: { etiqueta: string; valor: T; opciones: { v: T; texto: string }[]; cambiar: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={o.v}
          aria-pressed={valor === o.v}
          onClick={() => cambiar(o.v)}
          className={`toque rounded-full px-3 py-1 text-[13px] ring-1 ${valor === o.v ? 'bg-(--raised-2) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-soft) ring-(--line) hover:bg-(--raised)'}`}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

const fmtP = (x: number | null | undefined, d = 1) => (x == null ? '—' : pctF(x, d));
const fmtN = (x: number | null | undefined, d = 3) => (x == null ? '—' : numF(x, d));

// ---------------------------------------------------------------------------------------------------
// E1 · calibración por partido
// ---------------------------------------------------------------------------------------------------

function PanelCalibracion({ panel, titulo }: { panel: Panel; titulo: string }) {
  const { t } = useI18n();
  const L = 260;
  const m = { l: 36, r: 22, t: 10, b: 30 };
  const x = (v: number) => m.l + v * (L - m.l - m.r);
  const y = (v: number) => L - m.b - v * (L - m.t - m.b);
  const dibujadas = panel.cubetas.filter((c) => c.observada != null && c.predichaMedia != null);
  const resumen = dibujadas.length
    ? dibujadas.map((c) => t('cal.punto', { desde: pctF(c.desde, 0), hasta: pctF(c.hasta, 0), p: fmtP(c.predichaMedia), o: fmtP(c.observada), lo: fmtP(c.ic95?.lo), hi: fmtP(c.ic95?.hi), n: c.n })).join('; ')
    : t('cal.sinDatos');
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-[12px] font-medium text-(--ink-body)">{titulo}</figcaption>
      <svg viewBox={`0 0 ${L} ${L}`} width="100%" style={{ maxWidth: 300 }} role="img" aria-label={`${titulo}. ${resumen}`}>
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--ink-faint)" strokeDasharray="4 4" />
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <text x={x(v)} y={L - 14} textAnchor="middle" fontSize="11" fill="var(--ink-muted)">{pctF(v, 0)}</text>
            <text x={m.l - 5} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-muted)">{pctF(v, 0)}</text>
          </g>
        ))}
        <text x={(x(0) + x(1)) / 2} y={L - 2} textAnchor="middle" fontSize="10" fill="var(--ink-faint)">{t('cal.ejeX')}</text>
        {dibujadas.map((c) => (
          <g key={c.desde}>
            <title>{t('cal.punto', { desde: pctF(c.desde, 0), hasta: pctF(c.hasta, 0), p: fmtP(c.predichaMedia), o: fmtP(c.observada), lo: fmtP(c.ic95?.lo), hi: fmtP(c.ic95?.hi), n: c.n })}</title>
            {c.ic95 && <line x1={x(c.predichaMedia as number)} x2={x(c.predichaMedia as number)} y1={y(c.ic95.lo)} y2={y(c.ic95.hi)} stroke={HOME_COLOR} strokeWidth={2} strokeLinecap="round" />}
            <circle cx={x(c.predichaMedia as number)} cy={y(c.observada as number)} r={4.5} fill={HOME_COLOR} stroke="var(--surface-card)" strokeWidth={2} />
            {/* Un blanco mayor que la marca, para el puntero. */}
            <circle cx={x(c.predichaMedia as number)} cy={y(c.observada as number)} r={12} fill="transparent" />
          </g>
        ))}
      </svg>
    </figure>
  );
}

function TextoConjunto({ panel, umbrales }: { panel: Panel; umbrales: Calibracion['umbrales'] }) {
  const { t } = useI18n();
  const c = panel.conjunto;
  return (
    <p className="text-[12px] text-(--ink-soft)">
      {/* Con menos de 30 no se da lo observado (el servidor lo manda vacío): solo n y que no basta. */}
      {c.observada != null && t('cal.conjunto', { n: c.n, p: fmtP(c.predichaMedia), o: fmtP(c.observada), lo: fmtP(c.ic95?.lo), hi: fmtP(c.ic95?.hi) })}{' '}
      {c.veredicto === 'insuficiente'
        ? t('cal.veredicto.insuficiente', { n: c.n, min: umbrales.conjuntoMin })
        : c.veredicto === 'descalibrado'
          ? t('cal.veredicto.descalibrado', { citl: fmtN(c.citlZ, 2), z: fmtN(c.spiegelhalterZ, 2), zc: fmtN(umbrales.zCritico, 2) })
          : t('cal.veredicto.sinEvidencia', { zc: fmtN(umbrales.zCritico, 2) })}
      {c.nivel === 'orientativa' && c.veredicto !== 'insuficiente' ? ` ${t('cal.orientativa')}` : ''}
    </p>
  );
}

function TablaCalibracion({ panel }: { panel: Panel }) {
  const { t } = useI18n();
  return (
    <table className="w-full text-[12px] tabular-nums">
      <thead>
        <tr className="text-left text-(--ink-muted)">
          <th className="py-0.5 pr-2 font-medium">{t('cal.col.cubeta')}</th>
          <th className="py-0.5 pr-2 text-right font-medium">{t('cal.col.n')}</th>
          <th className="py-0.5 pr-2 text-right font-medium">{t('cal.col.predicha')}</th>
          <th className="py-0.5 pr-2 text-right font-medium">{t('cal.col.observada')}</th>
          <th className="py-0.5 text-right font-medium">{t('cal.col.ic')}</th>
        </tr>
      </thead>
      <tbody>
        {panel.cubetas.filter((c) => c.n > 0).map((c) => (
          <tr key={c.desde} className="border-t border-(--line)">
            <td className="py-0.5 pr-2">{pctF(c.desde, 0)}–{pctF(c.hasta, 0)}</td>
            <td className="py-0.5 pr-2 text-right">{c.n}</td>
            <td className="py-0.5 pr-2 text-right">{fmtP(c.predichaMedia)}</td>
            <td className="py-0.5 pr-2 text-right">{c.observada == null ? t('cal.menosDe', { n: 30 }) : fmtP(c.observada)}</td>
            <td className="py-0.5 text-right">{c.ic95 ? `${fmtP(c.ic95.lo)}–${fmtP(c.ic95.hi)}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const lista = (o: Record<string, number>, t: (k: Clave) => string) =>
  Object.entries(o)
    .map(([k, n]) => `${t(`partido.motivo.${k}` as Clave)} (${n})`)
    .join('; ');

export function CalibracionPorPartido({ sport }: { sport: Deporte }) {
  const { t } = useI18n();
  const [cohorte, setCohorte] = useState<Cohorte>('final');
  const d = usar<Calibracion>(`/api/evaluation/calibracion?sport=${sport}&cohorte=${cohorte}`);
  return (
    <section className="mt-4" aria-labelledby="cal-titulo">
      <h4 id="cal-titulo" className="mb-1 text-[13px] font-medium text-(--ink-body)">{t('cal.titulo')}</h4>
      <p className="mb-2 text-[12px] text-(--ink-muted)">{t('cal.explica')}</p>
      <div className="mb-2">
        <Selector etiqueta={t('cal.cohorte')} valor={cohorte} cambiar={setCohorte} opciones={[{ v: 'final', texto: t('cal.final') }, { v: 'legado', texto: t('cal.legado') }]} />
      </div>
      {d === null && <p className="text-[12px] text-(--ink-muted)">{t('comun.cargando')}</p>}
      {d === 'error' && <p className="text-[12px] text-(--ink-muted)">{t('analitica.sinFiabilidad')}</p>}
      {d && d !== 'error' && d.motivo === 'zona-invalida' && <p className="text-[12px] text-(--status-warning)">{t('cal.zonaInvalida')}</p>}
      {d && d !== 'error' && !d.motivo && (
        <>
          {d.partidos === 0 && <p className="text-[12px] text-(--ink-muted)">{t('cal.sinDatos')}</p>}
          <div className={`grid gap-3 ${d.paneles.length > 1 ? 'sm:grid-cols-3' : ''}`}>
            {d.paneles.map((p) => {
              const titulo = d.resultados === 2 ? t('cal.panel.binario') : t(`cal.panel.${p.clase}` as Clave);
              return (
                <div key={p.clase} className="min-w-0">
                  <PanelCalibracion panel={p} titulo={titulo} />
                  <TextoConjunto panel={p} umbrales={d.umbrales} />
                  {p.n > 0 && (
                    <details className="mt-1">
                      <summary className="toque cursor-pointer text-[12px] text-(--ink-muted)">{t('cal.tabla')}</summary>
                      <TablaCalibracion panel={p} />
                    </details>
                  )}
                </div>
              );
            })}
          </div>
          {Object.keys(d.excluidas).length > 0 && <p className="mt-1 text-[12px] text-(--ink-muted)">{t('cal.excluidas', { lista: lista(d.excluidas, t) })}</p>}
          {d.versiones.length > 0 && <p className="text-[12px] text-(--ink-muted)">{t('cal.versiones', { lista: d.versiones.map((v) => `${v.version === 'sin-version' ? t('rend.sinVersion') : v.version} (${v.n})`).join('; ') })}</p>}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// E2 · rendimiento por periodo
// ---------------------------------------------------------------------------------------------------

function GraficoPeriodos({ puntos, referencia, titulo, minimo }: { puntos: Punto[]; referencia: number; titulo: string; minimo: number }) {
  const { t } = useI18n();
  // Cada periodo, con sitio para su etiqueta («2026-W43») sin pisar la de al lado.
  const paso = 52;
  const m = { l: 40, r: 10, t: 10, b: 34 };
  const ancho = Math.max(260, m.l + m.r + puntos.length * paso);
  const alto = 170;
  const techo = Math.max(referencia * 1.4, ...puntos.map((p) => p.ic95?.hi ?? p.brier ?? 0)) * 1.05;
  const x = (i: number) => m.l + paso / 2 + i * paso;
  const y = (v: number) => alto - m.b - (v / techo) * (alto - m.t - m.b);
  // Una de cada k etiquetas, para que no se pisen.
  const cada = Math.max(1, Math.ceil(puntos.length / 12));
  const resumen = puntos
    .map((p) => (p.brier == null ? t('rend.puntoSin', { periodo: p.periodo, n: p.n, min: minimo }) : t('rend.punto', { periodo: p.periodo, b: fmtN(p.brier), lo: fmtN(p.ic95?.lo), hi: fmtN(p.ic95?.hi), n: p.n })))
    .join('; ');
  return (
    <div className="desliza-x overflow-x-auto">
      <svg viewBox={`0 0 ${ancho} ${alto}`} width={ancho} height={alto} role="img" aria-label={`${titulo}. ${resumen}`} style={{ maxWidth: 'none' }}>
        <line x1={m.l} x2={ancho - m.r} y1={y(referencia)} y2={y(referencia)} stroke="var(--ink-faint)" strokeDasharray="4 4" />
        <text x={ancho - m.r} y={y(referencia) - 4} textAnchor="end" fontSize="10" fill="var(--ink-muted)">{fmtN(referencia)}</text>
        {[0, techo / 2].map((v) => (
          <text key={v} x={m.l - 5} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-muted)">{fmtN(v, 2)}</text>
        ))}
        {puntos.map((p, i) => (
          <g key={p.periodo}>
            {i % cada === 0 && (
              <text x={x(i)} y={alto - 16} textAnchor="middle" fontSize="10" fill="var(--ink-muted)">{p.periodo}</text>
            )}
            {p.brier != null && (
              <>
                <title>{t('rend.punto', { periodo: p.periodo, b: fmtN(p.brier), lo: fmtN(p.ic95?.lo), hi: fmtN(p.ic95?.hi), n: p.n })}</title>
                {p.ic95 && <line x1={x(i)} x2={x(i)} y1={y(Math.max(0, p.ic95.lo))} y2={y(p.ic95.hi)} stroke={HOME_COLOR} strokeWidth={2} strokeLinecap="round" />}
                {/* El periodo en curso, hueco: todavía no ha terminado. */}
                <circle cx={x(i)} cy={y(p.brier)} r={4.5} fill={p.parcial ? 'var(--surface-card)' : HOME_COLOR} stroke={p.parcial ? HOME_COLOR : 'var(--surface-card)'} strokeWidth={2} />
                <circle cx={x(i)} cy={y(p.brier)} r={12} fill="transparent" />
              </>
            )}
            <text x={x(i)} y={alto - 4} textAnchor="middle" fontSize="9" fill="var(--ink-faint)">{p.n}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function TablaPeriodos({ puntos, minimo }: { puntos: Punto[]; minimo: number }) {
  const { t } = useI18n();
  return (
    <table className="w-full text-[12px] tabular-nums">
      <thead>
        <tr className="text-left text-(--ink-muted)">
          <th className="py-0.5 pr-2 font-medium">{t('rend.periodo')}</th>
          <th className="py-0.5 pr-2 text-right font-medium">{t('cal.col.n')}</th>
          <th className="py-0.5 pr-2 text-right font-medium">{t('rend.col.brier')}</th>
          <th className="py-0.5 pr-2 text-right font-medium">{t('cal.col.ic')}</th>
          <th className="py-0.5 pr-2 text-right font-medium">{t('rend.col.ll')}</th>
          <th className="py-0.5 text-right font-medium">{t('rend.col.mercado')}</th>
        </tr>
      </thead>
      <tbody>
        {puntos.map((p) => (
          <tr key={p.periodo} className="border-t border-(--line)">
            <td className="py-0.5 pr-2">{p.periodo}{p.parcial ? ` (${t('rend.parcial')})` : ''}</td>
            <td className="py-0.5 pr-2 text-right">{p.n}</td>
            <td className="py-0.5 pr-2 text-right">{p.brier == null ? (p.n ? t('cal.menosDe', { n: minimo }) : '—') : fmtN(p.brier)}</td>
            <td className="py-0.5 pr-2 text-right">{p.ic95 ? `${fmtN(p.ic95.lo)}–${fmtN(p.ic95.hi)}` : '—'}</td>
            <td className="py-0.5 pr-2 text-right">{fmtN(p.logLoss)}</td>
            <td className="py-0.5 text-right">{p.mercado?.delta == null ? '—' : `${p.mercado.delta > 0 ? '+' : ''}${fmtN(p.mercado.delta)} (${p.mercado.n})`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RendimientoPorPeriodo({ sport }: { sport: Deporte }) {
  const { t } = useI18n();
  const [periodo, setPeriodo] = useState<'mes' | 'semana'>('mes');
  const d = usar<Rendimiento>(`/api/evaluation/rendimiento?sport=${sport}&periodo=${periodo}`);
  const nombreCohorte = (c: Cohorte) => (c === 'final' ? t('cal.final') : t('cal.legado'));
  return (
    <section className="mt-4" aria-labelledby="rend-titulo">
      <h4 id="rend-titulo" className="mb-1 text-[13px] font-medium text-(--ink-body)">{t('rend.titulo')}</h4>
      {d && d !== 'error' && !d.motivo && (
        <p className="mb-2 text-[12px] text-(--ink-muted)">{t('rend.explica', { periodo: t(periodo === 'mes' ? 'rend.mes' : 'rend.semana'), zona: d.zona ?? '—', ref: fmtN(d.referencia.uniforme) })}</p>
      )}
      <div className="mb-2">
        <Selector etiqueta={t('rend.periodo')} valor={periodo} cambiar={setPeriodo} opciones={[{ v: 'mes', texto: t('rend.porMes') }, { v: 'semana', texto: t('rend.porSemana') }]} />
      </div>
      {d === null && <p className="text-[12px] text-(--ink-muted)">{t('comun.cargando')}</p>}
      {d === 'error' && <p className="text-[12px] text-(--ink-muted)">{t('analitica.sinMonitorizacion')}</p>}
      {d && d !== 'error' && d.motivo === 'zona-invalida' && <p className="text-[12px] text-(--status-warning)">{t('cal.zonaInvalida')}</p>}
      {d && d !== 'error' && !d.motivo && d.series.length === 0 && <p className="text-[12px] text-(--ink-muted)">{t('rend.sinDatos')}</p>}
      {/* Las exclusiones son del deporte y el periodo, no de una serie: una vez, aunque no haya series. */}
      {d && d !== 'error' && !d.motivo && Object.keys(d.excluidas).length > 0 && (
        <p className="mb-2 text-[12px] text-(--ink-muted)">
          {t('rend.excluidas', {
            periodo: t(periodo === 'mes' ? 'rend.mes' : 'rend.semana'),
            lista: Object.entries(d.excluidas)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([p, m]) => `${p}: ${lista(m, t)}`)
              .join(' · '),
          })}
        </p>
      )}
      {d && d !== 'error' && !d.motivo && (
        <div className="space-y-4">
          {d.series.map((s) => {
            const r = d.resumen.find((x) => x.cohorte === s.cohorte && x.version === s.version);
            const titulo = t('rend.serie', { cohorte: nombreCohorte(s.cohorte), version: s.version === 'sin-version' ? t('rend.sinVersion') : s.version });
            return (
              <div key={`${s.cohorte}-${s.version}`} className="min-w-0">
                <p className="text-[12px] font-medium text-(--ink-body)">{titulo}</p>
                {r && (
                  <p className="text-[12px] text-(--ink-soft)">
                    {r.brier == null
                      ? t('rend.resumenInsuficiente', { n: r.n, min: d.umbrales.insuficiente })
                      : t('rend.resumen', { n: r.n, b: fmtN(r.brier), lo: fmtN(r.ic95?.lo), hi: fmtN(r.ic95?.hi), ll: fmtN(r.logLoss) })}
                    {r.brier != null && r.nivel === 'orientativa' ? ` ${t('cal.orientativa')}` : ''}
                    {r.mercado?.delta != null && <span className="block">{t('rend.mercado', { n: r.mercado.n, delta: `${r.mercado.delta > 0 ? '+' : ''}${fmtN(r.mercado.delta)}`, lo: fmtN(r.mercado.ic95?.lo), hi: fmtN(r.mercado.ic95?.hi) })}</span>}
                  </p>
                )}
                <GraficoPeriodos puntos={s.puntos} referencia={d.referencia.uniforme} titulo={titulo} minimo={d.umbrales.puntoMin} />
                <details className="mt-1">
                  <summary className="toque cursor-pointer text-[12px] text-(--ink-muted)">{t('cal.tabla')}</summary>
                  <TablaPeriodos puntos={s.puntos} minimo={d.umbrales.puntoMin} />
                </details>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
