// Analítica del modelo en Confianza (Fase 5.22): fiabilidad (backtest y vivo, sin mezclar),
// la ventana móvil de 4 semanas con el PSI, y el acierto por segmento. Todo de las rutas de la
// Fase 4; lo que no tiene muestra lo dice en vez de pintar barras.

import { useEffect, useState } from 'react';
import { BarChart, LineChart, ReliabilityDiagram } from '../charts';
import { SPORT_THEMES } from '../../lib/theme';
import { DeporteIcono } from '../icons';
import { Termino } from '../ui';

type Deporte = 'football' | 'basketball' | 'baseball' | 'nfl' | 'tennis';
interface Cubeta { desde: number; hasta: number; n: number; predicha: number | null; observada: number | null }
interface Diagrama { partidos: number; cubetas: Cubeta[]; ece: number | null; aviso: { nivel: string; texto: string | null } }
interface Fiabilidad { backtest: Diagrama | null; live: Diagrama }
interface Monitorizacion { serie: { dia: string; n: number; logLoss: number | null; brier: number | null; psi: number | null }[]; actual: { n: number; logLoss: number | null; brier: number | null; psi: number | null } | null; referencia: { logLoss: number | null; brier: number | null } | null; deriva: { hay: boolean; motivos: string[]; aviso: { texto: string | null } } }
interface Segmentos { predicciones: { n: number; dimensiones: Record<string, Record<string, { n: number; acierto: number | null; publicada: boolean }>> }; apuestas: { n: number; dimensiones: Record<string, Record<string, { n: number; conCierre: number; clvMedio: number | null; publicada: boolean }>> }; umbrales: { predicciones: number; apuestas: number } }

const DEPORTES: Deporte[] = ['football', 'basketball', 'baseball', 'nfl', 'tennis'];
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d).replace('.', ',')} %`;

function usar<T>(url: string): T | null | 'error' {
  const [d, setD] = useState<T | null | 'error'>(null);
  useEffect(() => {
    let vivo = true;
    setD(null);
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject())).then((j: T) => vivo && setD(j)).catch(() => vivo && setD('error'));
    return () => {
      vivo = false;
    };
  }, [url]);
  return d;
}

export default function Analitica() {
  const [sport, setSport] = useState<Deporte>('football');
  const fia = usar<Fiabilidad>(`/api/evaluation/reliability?sport=${sport}`);
  const mon = usar<Monitorizacion>(`/api/monitoring?sport=${sport}`);
  const seg = usar<Segmentos>(`/api/evaluation/segmentos?sport=${sport}`);
  const serieLL = mon && mon !== 'error' ? mon.serie.filter((p) => p.logLoss != null && p.n >= 1).map((p) => ({ x: Date.parse(p.dia), y: p.logLoss as number })) : [];
  const serieBr = mon && mon !== 'error' ? mon.serie.filter((p) => p.brier != null && p.n >= 1).map((p) => ({ x: Date.parse(p.dia), y: p.brier as number })) : [];
  return (
    <section className="mb-4 rounded-xl border border-(--line) p-4" aria-label="Analítica del modelo">
      <h3 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">Analítica del modelo</h3>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Deporte">
        {DEPORTES.map((d) => (
          <button key={d} aria-pressed={sport === d} onClick={() => setSport(d)} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] ring-1 ${sport === d ? 'bg-(--raised-2) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-soft) ring-(--line) hover:bg-(--raised)'}`}>
            <DeporteIcono nombre={d} size={15} />
            {SPORT_THEMES[d].label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 text-[13px] font-medium text-(--ink-body)">Fiabilidad (<Termino clave="ece">ECE</Termino>)</h4>
          {fia === null && <p className="text-[12px] text-(--ink-muted)">Cargando…</p>}
          {fia === 'error' && <p className="text-[12px] text-(--ink-muted)">Sin datos de fiabilidad.</p>}
          {fia && fia !== 'error' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <ReliabilityDiagram titulo="Backtest" cubetas={fia.backtest?.cubetas ?? []} />
                <p className="text-[11px] text-(--ink-muted)">{fia.backtest ? `${fia.backtest.partidos.toLocaleString('es')} partidos · ECE ${fia.backtest.ece == null ? '—' : pct(fia.backtest.ece)}` : 'Sin backtest guardado: npm run backtest del deporte.'}</p>
              </div>
              <div>
                <ReliabilityDiagram titulo="En vivo" cubetas={fia.live.cubetas} />
                <p className="text-[11px] text-(--ink-muted)">{fia.live.partidos} partidos · ECE {fia.live.ece == null ? '—' : pct(fia.live.ece)}{fia.live.aviso.texto ? ` · ${fia.live.aviso.texto}` : ''}</p>
              </div>
            </div>
          )}
        </div>
        <div>
          <h4 className="mb-1 text-[13px] font-medium text-(--ink-body)">Ventana de 4 semanas (<Termino clave="brier">Brier</Termino>, <Termino clave="logloss">log loss</Termino>, <Termino clave="psi">PSI</Termino>)</h4>
          {mon === null && <p className="text-[12px] text-(--ink-muted)">Cargando…</p>}
          {mon === 'error' && <p className="text-[12px] text-(--ink-muted)">Sin monitorización.</p>}
          {mon && mon !== 'error' && (
            <>
              {serieLL.length > 1 ? (
                <LineChart series={[{ nombre: 'log loss', puntos: serieLL }, { nombre: 'Brier', puntos: serieBr }]} formatoX={(x) => new Date(x).toLocaleDateString('es', { day: '2-digit', month: 'short' })} referencia={mon.referencia?.logLoss != null ? { y: mon.referencia.logLoss, etiqueta: `backtest ${mon.referencia.logLoss.toFixed(3)}` } : undefined} />
              ) : (
                <p className="text-[12px] text-(--ink-muted)">Todavía no hay predicciones en vivo puntuadas para dibujar la serie.</p>
              )}
              <p className="mt-1 text-[12px] text-(--ink-soft)">
                {mon.actual ? `Ahora: ${mon.actual.n} predicciones · log loss ${mon.actual.logLoss?.toFixed(3) ?? '—'} · PSI ${mon.actual.psi?.toFixed(3) ?? '—'}` : 'Sin ventana actual.'}
                {mon.deriva.hay ? <span className="block text-[#e66767]" role="alert">Deriva: {mon.deriva.motivos.join('; ')}</span> : mon.deriva.aviso.texto ? <span className="block text-(--ink-muted)">{mon.deriva.aviso.texto}</span> : null}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="mt-4">
        <h4 className="mb-1 text-[13px] font-medium text-(--ink-body)">Acierto por segmento (en vivo)</h4>
        {seg === null && <p className="text-[12px] text-(--ink-muted)">Cargando…</p>}
        {seg === 'error' && <p className="text-[12px] text-(--ink-muted)">Sin segmentos.</p>}
        {seg && seg !== 'error' && (
          seg.predicciones.n === 0 ? (
            <p className="text-[12px] text-(--ink-muted)">Sin predicciones en vivo con resultado todavía.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(seg.predicciones.dimensiones).map(([dim, celdas]) => {
                const pub = Object.entries(celdas).filter(([, c]) => c.publicada && c.acierto != null);
                const sin = Object.entries(celdas).filter(([, c]) => !c.publicada);
                return (
                  <div key={dim}>
                    {pub.length > 0 ? (
                      <BarChart titulo={dim} max={1} formato={(v) => pct(v, 0)} filas={pub.map(([k, c]) => ({ etiqueta: k, valor: c.acierto as number, n: c.n }))} />
                    ) : (
                      <p className="text-[12px] font-medium text-(--ink-soft)">{dim}</p>
                    )}
                    {sin.length > 0 && <p className="text-[11px] text-(--ink-muted)">Sin publicar (menos de {seg.umbrales.predicciones}): {sin.map(([k, c]) => `${k} ${c.n}`).join(' · ')}</p>}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </section>
  );
}
