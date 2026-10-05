// 📊 Confianza del sistema: ¿podemos fiarnos del modelo? Lo que sabemos, lo que todavía
// no, y las cifras que lo sostienen. Todo sale del servidor (evaluation/system.ts y
// compañía); las dos listas se generan con reglas a partir de las muestras reales.

import { useEffect, useState } from 'react';
import { LOSS_COLOR, PROFIT_COLOR } from '../../lib/theme';

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

const NOMBRE: Record<string, string> = { tennis: '🎾 Tenis', football: '⚽ Fútbol', basketball: '🏀 NBA', baseball: '⚾ MLB', nfl: '🏈 NFL' };
const f3 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(3).replace('.', ','));
const pct = (x: number | null | undefined) => (x == null ? '—' : `${x >= 0 ? '' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')} %`);
const AMBAR = '#d9a441';

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-white/[0.09] bg-white/[0.02] px-4 py-3">
      <h3 className="mb-2 text-[15px] font-semibold text-[#e8eaed]">{titulo}</h3>
      <div className="text-[13px] leading-relaxed text-[#9aa1ac]">{children}</div>
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
          className="min-w-0 flex-1 rounded border border-white/[0.1] bg-transparent px-2 py-1 text-[13px] text-[#e8eaed]"
        />
        <button className="rounded border border-white/[0.15] px-3 py-1 text-[13px] text-[#c3c9d1]">Reproducir</button>
      </form>
      {r && (
        <div className="mt-2">
          {r.campos.map(([k, v]) => (
            <p key={k}><span className="text-[#c3c9d1]">{k}:</span> {v}</p>
          ))}
          {r.avisos.map((a) => <p key={a} style={{ color: AMBAR }}>⚠ {a}</p>)}
        </div>
      )}
      <p className="mt-1 text-[12px] text-[#5c636c]">Devuelve lo que se guardó en su momento; no recalcula nada con los datos de hoy. También en terminal: npm run reproduce -- &lt;id&gt;.</p>
    </div>
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
  if (error) return <p className="text-[14px] text-[#9aa1ac]">No se pudo leer el estado del sistema.</p>;
  if (!s) return <p className="text-[14px] text-[#7b828d]">Cargando…</p>;
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
      <h2 className="mb-1 text-[20px] font-semibold text-[#e8eaed]">📊 ¿Podemos confiar en el modelo?</h2>
      <p className="mb-4 text-[13px] text-[#7b828d]">
        Lo que está demostrado, lo que todavía no, y las cifras detrás. Las listas se generan con reglas sobre las muestras reales: cambian solas cuando hay más datos.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-white/[0.08] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-[#7b828d]">{k}</p>
            <p className="text-[16px] font-semibold text-[#e8eaed]">{v}</p>
          </div>
        ))}
      </div>
      <Bloque titulo="Lo que sabemos">
        <ul className="space-y-1">{s.sabemos.map((x) => <li key={x}><span style={{ color: PROFIT_COLOR }}>✓</span> {x}</li>)}</ul>
      </Bloque>
      <Bloque titulo="Lo que todavía no podemos concluir">
        <ul className="space-y-1">{s.noSabemos.map((x) => <li key={x}><span style={{ color: AMBAR }}>⚠</span> {x}</li>)}</ul>
      </Bloque>
      <Bloque titulo="Histórico (walk-forward): modelo, mejor baseline y mercado">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[12px] sm:text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[#7b828d]">
                <th className="py-1 pr-2">Deporte</th><th className="py-1 pr-2 text-right">Partidos</th><th className="py-1 pr-2 text-right">Modelo</th><th className="py-1 pr-2">Mejor baseline</th><th className="py-1 text-right">Mercado</th>
              </tr>
            </thead>
            <tbody>
              {s.benchmark.map((b) => (
                <tr key={b.deporte} className="border-t border-white/[0.05]">
                  <td className="py-1 pr-2 text-[#c3c9d1]">{NOMBRE[b.deporte]}</td>
                  <td className="py-1 pr-2 text-right">{b.partidos || '—'}</td>
                  <td className="py-1 pr-2 text-right text-[#e8eaed]">{f3(b.modelo)}</td>
                  <td className="py-1 pr-2">{b.mejorBaseline ? `${b.mejorBaseline.nombre} ${f3(b.mejorBaseline.logLoss)}` : '—'}</td>
                  <td className="py-1 text-right" style={{ color: b.mercado != null && b.modelo != null && b.mercado < b.modelo ? LOSS_COLOR : undefined }}>
                    {b.mercado == null ? 'sin cuotas' : `${f3(b.mercado)}${b.modelo != null && b.mercado < b.modelo ? ' (mejor)' : ''}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[12px] text-[#5c636c]">Log loss, más bajo es mejor. Todos los periodos, sin elegir; el holdout final no entra. Detalle: npm run benchmark:report.</p>
      </Bloque>
      <Bloque titulo="En vivo, por deporte">
        {s.brier.map((b) => (
          <p key={b.deporte}>
            {NOMBRE[b.deporte]}: {b.n} partidos · Brier {f3(b.brier)} · calibración ±{pct(b.ece)}
            {b.n < 100 && <span style={{ color: AMBAR }}> · ⚠ muestra pequeña</span>}
          </p>
        ))}
      </Bloque>
      {riesgo && (
        <Bloque titulo="Riesgo abierto">
          <p>Total: {pct(riesgo.total.pct)} del banco (tope {pct(riesgo.total.limite)}){riesgo.porDeporte.length ? ` · ${riesgo.porDeporte.map((d) => `${NOMBRE[d.deporte] ?? d.deporte} ${pct(d.pct)}`).join(' · ')}` : ''}</p>
          {riesgo.grupos.map((g) => (
            <p key={g.grupo} style={{ color: g.excede ? LOSS_COLOR : undefined }}>{g.grupo}: {g.apuestas} apuestas, {pct(g.pct)} (tope {pct(g.limite)})</p>
          ))}
          <p className="text-[12px] text-[#5c636c]">{riesgo.nota}</p>
        </Bloque>
      )}
      <Bloque titulo="Alertas recientes">
        {alertas.length === 0 ? <p>Ninguna todavía.</p> : alertas.map((a) => (
          <p key={a.id}>
            <span className="text-[#5c636c]">{new Date(a.created_at).toLocaleString('es')}</span>{' '}
            <span style={{ color: a.severity === 'importante' ? LOSS_COLOR : a.severity === 'aviso' ? AMBAR : undefined }}>{a.title}</span> — {a.body}
          </p>
        ))}
      </Bloque>
      <Bloque titulo="Reproducir una predicción o apuesta">
        <Reproducir />
      </Bloque>
    </div>
  );
}
