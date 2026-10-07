// 📊 Confianza del sistema: ¿podemos fiarnos del modelo? Lo que sabemos, lo que todavía
// no, y las cifras que lo sostienen. Todo sale del servidor (evaluation/system.ts y
// compañía); las dos listas se generan con reglas a partir de las muestras reales.

import { useEffect, useState } from 'react';
import LiveEvaluation from '../bets/LiveEvaluation';
import Analitica from './Analitica';
import { LOSS_COLOR, PROFIT_COLOR } from '../../lib/theme';
import { DeporteIcono, ShieldCheckIcon, StatusMark } from '../icons';

interface Sistema {
  prediccionesEnVivo: number;
  resueltas: number;
  apuestasEnVivo: number;
  liquidadas: number;
  diasRegistrados: number | null;
  clvMedio: number | null;
  roi: number | null;
  brier: { deporte: string; n: number; brier: number | null; ece: number | null }[];
  maxDrawdownPct: number | null;
  benchmark: { deporte: string; partidos: number; modelo: number | null; mejorBaseline: { nombre: string; logLoss: number } | null; mercado: number | null }[];
  sabemos: string[];
  noSabemos: string[];
  cuotasReales: boolean;
}
interface Alerta {
  id: number;
  created_at: string;
  severity: string;
  title: string;
  body: string;
}
interface Riesgo {
  total: { importe: number; pct: number; limite: number };
  porDeporte: { deporte: string; importe: number; pct: number }[];
  grupos: { grupo: string; apuestas: number; pct: number; limite: number; excede: boolean }[];
  nota: string;
}

const NOMBRE_TXT: Record<string, string> = { tennis: 'Tenis', football: 'Fútbol', basketball: 'NBA', baseball: 'MLB', nfl: 'NFL' };
/** El deporte con su icono. */
const NOMBRE: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries(NOMBRE_TXT).map(([k, v]) => [k, <span key={k} className="inline-flex items-center gap-1.5"><DeporteIcono nombre={k} size={15} />{v}</span>]),
);
const f3 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(3).replace('.', ','));
const pct = (x: number | null | undefined) => (x == null ? '—' : `${x >= 0 ? '' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')} %`);
const AMBAR = '#d9a441';

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-(--line) bg-(--tint) px-4 py-3">
      <h3 className="mb-2 text-[15px] font-semibold text-(--ink-strong)">{titulo}</h3>
      <div className="text-[13px] leading-relaxed text-(--ink-soft)">{children}</div>
    </section>
  );
}

function Reproducir() {
  const [id, setId] = useState('');
  const [r, setR] = useState<{ encontrado: boolean; campos: [string, string][]; avisos: string[] } | null>(null);
  return (
    <div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (id.trim()) fetch(`/api/reproduce/${encodeURIComponent(id.trim())}`).then((x) => x.json()).then(setR).catch(() => setR(null));
        }}
      >
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="apuesta:12 · senal:5 · evaluacion:3 · nfl:<clave>"
          className="min-w-0 flex-1 rounded border border-(--line) bg-transparent px-2 py-1 text-[13px] text-(--ink-strong)"
        />
        <button className="rounded border border-(--line-strong) px-3 py-1 text-[13px] text-(--ink-body)">Reproducir</button>
      </form>
      {r && (
        <div className="mt-2">
          {r.campos.map(([k, v]) => (
            <p key={k}><span className="text-(--ink-body)">{k}:</span> {v}</p>
          ))}
          {r.avisos.map((a) => <p key={a} style={{ color: AMBAR }}><StatusMark estado="aviso" color={AMBAR} />{a}</p>)}
        </div>
      )}
      <p className="mt-1 text-[12px] text-(--ink-faint)">Devuelve lo que se guardó en su momento; no recalcula nada con los datos de hoy. También en terminal: npm run reproduce -- &lt;id&gt;.</p>
    </div>
  );
}

interface Sombras {
  sombras: { sport: string; nombre: string; n: number; sombra: { logLoss: number | null; brier: number | null }; campeon: { logLoss: number | null; brier: number | null }; diferencia: { veredicto: string; lectura: string }; aviso: { texto: string | null } }[];
  ensembles: Record<string, { componentes: string[]; mejor: string; metodos: Record<string, { validacion: { n: number; logLoss: number; logLossCampeon: number; ic?: [number, number] } }> } | undefined>;
}
interface Version {
  version: string;
  activada: string;
  desactivada: string | null;
  motivo: string;
  git_commit: string;
  metricas: string;
}
interface Experimentos {
  total: number;
  aceptados: number;
  noConcluyentes: number;
  rechazados: { id: string; date: string; sport: string; hypothesis: string; motivo: string }[];
}

function ModelosSombra() {
  const [d, setD] = useState<Sombras | null>(null);
  useEffect(() => {
    fetch('/api/shadows').then((r) => r.json()).then(setD).catch(() => {});
  }, []);
  if (!d) return <p>Cargando…</p>;
  return (
    <>
      {d.sombras.length === 0 ? (
        <p>Todavía no hay sombras con partidos resueltos: se guardan al servir cada partido real, en el mismo instante que el modelo principal.</p>
      ) : (
        d.sombras.map((x) => (
          <p key={x.sport + x.nombre}>
            {NOMBRE[x.sport]} · {x.nombre}: N {x.n} · log loss sombra {f3(x.sombra.logLoss)} contra campeón {f3(x.campeon.logLoss)} · {x.diferencia.veredicto}
            {x.aviso.texto && <span style={{ color: AMBAR }}> · <StatusMark estado="aviso" color={AMBAR} size={13} />muestra pequeña</span>}
          </p>
        ))
      )}
      {Object.entries(d.ensembles).map(([sport, e]) =>
        e ? (
          <p key={sport}>
            Ensemble {NOMBRE[sport]} ({e.componentes.join(' + ')}): mejor fuera de muestra «{e.mejor}», log loss {f3(e.metodos[e.mejor].validacion.logLoss)} contra
            campeón {f3(e.metodos[e.mejor].validacion.logLossCampeon)} en {e.metodos[e.mejor].validacion.n} partidos del histórico.
          </p>
        ) : null,
      )}
      <p className="text-[12px] text-(--ink-faint)">Ninguna sombra apuesta ni se promociona sola: cambiar de modelo exige un experimento registrado.</p>
    </>
  );
}

function HistoriaVersiones() {
  const [d, setD] = useState<{ historial: Record<string, Version[]>; nota: string | null } | null>(null);
  useEffect(() => {
    fetch('/api/model-history').then((r) => r.json()).then(setD).catch(() => {});
  }, []);
  if (!d) return <p>Cargando…</p>;
  if (d.nota) return <p>{d.nota}</p>;
  return (
    <>
      {Object.entries(d.historial).map(([sport, vs]) => (
        <details key={sport} className="mb-1">
          <summary className="cursor-pointer text-(--ink-body)">
            {NOMBRE[sport]}: {vs.length} versiones · activa {vs[vs.length - 1]?.version}
          </summary>
          <ul className="ml-3 mt-1">
            {[...vs].reverse().map((v, i) => (
              <li key={v.version}>
                v{vs.length - i} <span className="text-(--ink-body)">{v.version}</span> · {v.activada.slice(0, 10)} → {v.desactivada ? v.desactivada.slice(0, 10) : 'activa'} · {v.git_commit} — {v.motivo}
                <span className="text-(--ink-faint)"> ({v.metricas})</span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}

function Rechazados() {
  const [d, setD] = useState<Experimentos | null>(null);
  useEffect(() => {
    fetch('/api/experiments').then((r) => r.json()).then(setD).catch(() => {});
  }, []);
  if (!d) return <p>Cargando…</p>;
  return (
    <>
      <p>
        {d.total} experimentos registrados: {d.aceptados} aceptados, {d.rechazados.length} rechazados y {d.noConcluyentes} no concluyentes. Los rechazados no se
        borran:
      </p>
      <ul className="mt-1 space-y-1">
        {d.rechazados.slice(0, 12).map((x) => (
          <li key={x.id}>
            <span className="text-(--ink-faint)">{x.date.slice(0, 10)}</span> <span className="text-(--ink-body)">{x.hypothesis}</span>
            <span className="block text-[12px]">Rechazado. Motivo: {x.motivo}</span>
          </li>
        ))}
      </ul>
      {d.rechazados.length > 12 && <p className="text-[12px] text-(--ink-faint)">…y {d.rechazados.length - 12} más (npm run experiments).</p>}
    </>
  );
}

export default function SystemTrust() {
  const [s, setS] = useState<Sistema | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [riesgo, setRiesgo] = useState<Riesgo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    fetch('/api/system-trust').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => vivo && setS(j)).catch(() => vivo && setError(true));
    fetch('/api/alerts?limit=30').then((r) => r.json()).then((j) => vivo && setAlertas(j)).catch(() => {});
    fetch('/api/risk').then((r) => r.json()).then((j) => vivo && setRiesgo(j)).catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  if (error) return <p className="text-[14px] text-(--ink-soft)">No se pudo leer el estado del sistema.</p>;
  if (!s) return <p className="text-[14px] text-(--ink-muted)">Cargando…</p>;
  const tiles: [string, string][] = [
    ['Predicciones en vivo', `${s.prediccionesEnVivo} (${s.resueltas} con resultado)`],
    ['Apuestas de papel', `${s.apuestasEnVivo} (${s.liquidadas} liquidadas)`],
    ['Días registrados', s.diasRegistrados == null ? '—' : String(s.diasRegistrados)],
    ['CLV medio', pct(s.clvMedio)],
    ['ROI', pct(s.roi)],
    ['Peor caída', s.maxDrawdownPct == null ? '—' : `−${pct(s.maxDrawdownPct)}`],
  ];
  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2.5 text-[20px] font-semibold text-(--ink-strong)">
          <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ color: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.12)' }}>
            <ShieldCheckIcon size={21} />
          </span>
          ¿Podemos confiar en el modelo?
        </h2>
      <p className="mb-4 text-[13px] text-(--ink-muted)">
        Lo que está demostrado, lo que todavía no, y las cifras detrás. Las listas se generan con reglas sobre las muestras reales: cambian solas cuando hay más datos.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-(--line) px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-(--ink-muted)">{k}</p>
            <p className="text-[16px] font-semibold text-(--ink-strong)">{v}</p>
          </div>
        ))}
      </div>
      <Bloque titulo="Lo que sabemos">
        <ul className="space-y-1">{s.sabemos.map((x) => <li key={x}><StatusMark estado="ok" color={PROFIT_COLOR} />{x}</li>)}</ul>
      </Bloque>
      <Bloque titulo="Lo que todavía no podemos concluir">
        <ul className="space-y-1">{s.noSabemos.map((x) => <li key={x}><StatusMark estado="aviso" color={AMBAR} />{x}</li>)}</ul>
      </Bloque>
      <Bloque titulo="Histórico (walk-forward): modelo, mejor baseline y mercado">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[12px] sm:text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-(--ink-muted)">
                <th className="py-1 pr-2">Deporte</th><th className="py-1 pr-2 text-right">Partidos</th><th className="py-1 pr-2 text-right">Modelo</th><th className="py-1 pr-2">Mejor baseline</th><th className="py-1 text-right">Mercado</th>
              </tr>
            </thead>
            <tbody>
              {s.benchmark.map((b) => (
                <tr key={b.deporte} className="border-t border-(--line)">
                  <td className="py-1 pr-2 text-(--ink-body)">{NOMBRE[b.deporte]}</td>
                  <td className="py-1 pr-2 text-right">{b.partidos || '—'}</td>
                  <td className="py-1 pr-2 text-right text-(--ink-strong)">{f3(b.modelo)}</td>
                  <td className="py-1 pr-2">{b.mejorBaseline ? `${b.mejorBaseline.nombre} ${f3(b.mejorBaseline.logLoss)}` : '—'}</td>
                  <td className="py-1 text-right" style={{ color: b.mercado != null && b.modelo != null && b.mercado < b.modelo ? LOSS_COLOR : undefined }}>
                    {b.mercado == null ? 'sin cuotas' : `${f3(b.mercado)}${b.modelo != null && b.mercado < b.modelo ? ' (mejor)' : ''}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[12px] text-(--ink-faint)">Log loss, más bajo es mejor. Todos los periodos, sin elegir; el holdout final no entra. Detalle: npm run benchmark:report.</p>
      </Bloque>
      {/* El modelo en vivo (antes en Apuestas, Fase 5.6): es evaluación del modelo, no dinero. */}
      <div className="mb-4">
        <LiveEvaluation />
      </div>
      <Analitica />
      <Bloque titulo="En vivo, por deporte">
        {s.brier.map((b) => (
          <p key={b.deporte}>
            {NOMBRE[b.deporte]}: {b.n} partidos · Brier {f3(b.brier)} · calibración ±{pct(b.ece)}
            {b.n < 100 && <span style={{ color: AMBAR }}> · <StatusMark estado="aviso" color={AMBAR} size={13} />muestra pequeña</span>}
          </p>
        ))}
      </Bloque>
      {riesgo && (
        <Bloque titulo="Riesgo abierto">
          <p>Total: {pct(riesgo.total.pct)} del banco (tope {pct(riesgo.total.limite)}){riesgo.porDeporte.length ? ` · ${riesgo.porDeporte.map((d) => `${NOMBRE_TXT[d.deporte] ?? d.deporte} ${pct(d.pct)}`).join(' · ')}` : ''}</p>
          {riesgo.grupos.map((g) => (
            <p key={g.grupo} style={{ color: g.excede ? LOSS_COLOR : undefined }}>{g.grupo}: {g.apuestas} apuestas, {pct(g.pct)} (tope {pct(g.limite)})</p>
          ))}
          <p className="text-[12px] text-(--ink-faint)">{riesgo.nota}</p>
        </Bloque>
      )}
      <Bloque titulo="Alertas recientes">
        {alertas.length === 0 ? <p>Ninguna todavía.</p> : alertas.map((a) => (
          <p key={a.id}>
            <span className="text-(--ink-faint)">{new Date(a.created_at).toLocaleString('es')}</span>{' '}
            <span style={{ color: a.severity === 'importante' ? LOSS_COLOR : a.severity === 'aviso' ? AMBAR : undefined }}>{a.title}</span> — {a.body}
          </p>
        ))}
      </Bloque>
      <Bloque titulo="Modelos en sombra y ensembles">
        <ModelosSombra />
      </Bloque>
      <Bloque titulo="Evolución de los modelos (desde git)">
        <HistoriaVersiones />
      </Bloque>
      <Bloque titulo="Experimentos rechazados">
        <Rechazados />
      </Bloque>
      <Bloque titulo="Reproducir una predicción o apuesta">
        <Reproducir />
      </Bloque>
    </div>
  );
}
