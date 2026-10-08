import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { CalibracionExpectativas, EventoCatalizador, LecturaEvento } from '../../api/types'
import { fmtNumber, fmtPct } from '../../lib/format'

const FUENTE: Record<string, string> = {
  consenso: 'Consenso (Finnhub)',
  guidance: 'Guidance de la dirección (extraído por IA, cita verificada)',
  modelo_interno: 'Modelo interno de la app',
  usuario: 'Tus expectativas',
  reglas: 'Reglas de la tesis',
}

const LECTURA: Record<string, string> = {
  supera: 'text-emerald-700',
  en_linea: 'text-slate-700',
  por_debajo: 'text-red-700',
  desconocido: 'text-amber-800',
}

const CLASIFICACION: Record<string, string> = {
  mejora_fundamental: 'bg-emerald-100 text-emerald-800',
  deterioro: 'bg-red-100 text-red-800',
  mixto: 'bg-amber-100 text-amber-800',
  neutral: 'bg-slate-100 text-slate-800',
  desconocido: 'bg-amber-100 text-amber-800',
}

function cifra(v: number | null | undefined, unidad: string | null): string {
  if (v === null || v === undefined) return '—'
  if (unidad === 'fracción') return fmtPct(v, 1)
  if (unidad === 'USD' && Math.abs(v) >= 1e5) return `${fmtNumber(v / 1e6, 1)} M`
  return fmtNumber(v, 2)
}

function Evento({ id, alCambiar }: { id: number; alCambiar: () => void }) {
  const [l, setL] = useState<LecturaEvento | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const cargar = useCallback(() => {
    api.evento(id).then(setL, (e: Error) => setMsg(e.message))
  }, [id])
  useEffect(cargar, [cargar])
  if (!l) return <p className="text-xs text-slate-400">Cargando evento…</p>

  const accion = (p: Promise<unknown>) =>
    p.then(
      () => {
        setMsg(null)
        cargar()
        alCambiar()
      },
      (e: Error) => setMsg(e.message),
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${CLASIFICACION[l.clasificacion]}`}>
          {l.clasificacion.replace('_', ' ').toUpperCase()}
        </span>
        {l.parcial && <span className="text-xs text-amber-800">parcial: sin resultado para {l.sin_resultado.join(', ')}</span>}
        {l.guidance && <span className="text-xs text-slate-600">guidance: {l.guidance}</span>}
        <button type="button" className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-xs"
          onClick={() => accion(api.capturarExpectativas(id))}>Capturar expectativas</button>
        <button type="button" className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          onClick={() => accion(api.registrarResultados(id))}>Registrar resultados (EDGAR)</button>
      </div>
      {msg && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{msg}</p>}
      {(l.a_favor.length > 0 || l.en_contra.length > 0) && (
        <p className="text-xs text-slate-600">
          A favor: {l.a_favor.join('; ') || '—'} · En contra: {l.en_contra.join('; ') || '—'}
        </p>
      )}
      <p className="text-[10px] text-slate-400">{l.regla_clasificacion}</p>

      {Object.keys(l.por_fuente).length === 0 && (
        <p className="text-xs text-slate-500">Sin expectativas válidas registradas para este evento todavía.</p>
      )}
      {Object.entries(l.por_fuente).map(([fuente, filas]) => (
        <div key={fuente}>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">{FUENTE[fuente] ?? fuente}</div>
          <table className="w-full text-xs tabular-nums">
            <thead className="text-[10px] text-slate-400">
              <tr><th className="text-left">Métrica</th><th className="text-right">Esperado</th><th className="text-right">Real</th><th className="text-right">Sorpresa</th><th className="text-right">Lectura</th></tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.metrica + c.fuente} className="border-t border-slate-100">
                  <td className="text-left text-slate-700">{c.etiqueta}</td>
                  <td className="text-right text-slate-600">
                    {c.esperado.valor != null ? cifra(c.esperado.valor, c.unidad) : `${cifra(c.esperado.bajo, c.unidad)}–${cifra(c.esperado.alto, c.unidad)}`}
                  </td>
                  <td className="text-right text-slate-800">{cifra(c.real, c.unidad)}</td>
                  <td className="text-right text-slate-600">
                    {c.sorpresa == null ? '—' : c.tipo_sorpresa === 'relativa' ? fmtPct(c.sorpresa, 1) : c.unidad === 'fracción' ? `${fmtNumber(c.sorpresa * 100, 1)} pp` : fmtNumber(c.sorpresa, 2)}
                  </td>
                  <td className={`text-right font-medium ${LECTURA[c.lectura]}`}>{c.lectura.replace('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {l.impacto_en_tesis.length > 0 && (
        <div className="text-xs">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Impacto en la tesis</div>
          <ul>
            {l.impacto_en_tesis.map((i, k) => (
              <li key={k} className={i.estado === 'invalidado' ? 'text-red-700' : i.estado === 'debilitado' ? 'text-amber-800' : i.estado === 'confirmado' ? 'text-emerald-700' : 'text-slate-500'}>
                {i.estado}: {i.punto}{i.real != null ? ` (real ${fmtPct(i.real, 1)}, umbral ${fmtPct(i.umbral ?? null, 1)})` : ''}{i.motivo ? ` — ${i.motivo}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {l.excluidas_por_fecha.length > 0 && (
        <p className="rounded bg-amber-50 p-2 text-[11px] text-amber-900">
          {l.excluidas_por_fecha.length} expectativa(s) excluidas por fecha (registradas cuando el resultado ya se conocía o el
          mismo día): {l.excluidas_por_fecha.map((x) => `${x.metrica} (${x.fuente_tipo})`).join(', ')}.
        </p>
      )}
    </div>
  )
}

export function ExpectativasSection({ symbol }: { symbol: string }) {
  const [eventos, setEventos] = useState<EventoCatalizador[] | null>(null)
  const [cal, setCal] = useState<CalibracionExpectativas | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const cargar = useCallback(() => {
    api.eventos(symbol).then((r) => {
      setEventos(r.eventos)
      setAbierto((a) => a ?? r.eventos[0]?.id ?? null)
    }, (e: Error) => setMsg(e.message))
    api.calibracion(symbol).then(setCal, () => setCal(null))
  }, [symbol])
  useEffect(() => {
    setEventos(null)
    setAbierto(null)
    setMsg(null)
    cargar()
  }, [cargar])

  const preparar = () =>
    api.prepararResultados(symbol).then(
      (r) => {
        setMsg(`Evento ${r.evento.periodo ?? ''} creado; ${r.captura.registradas.length} expectativa(s) capturadas.${r.captura.sin_fuente.length ? ' Sin fuente: ' + r.captura.sin_fuente.join(' · ') : ''}`)
        setAbierto(r.evento.id)
        cargar()
      },
      (e: Error) => setMsg(e.message),
    )

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Resultados frente a expectativas</h2>
          <button type="button" onClick={preparar} className="rounded-md bg-slate-800 px-3 py-1 text-xs font-medium text-white">
            Preparar próximos resultados
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Las expectativas se registran ANTES del evento y no se pueden editar. Cada fuente va por separado: el consenso no se
          mezcla nunca con el modelo interno.
        </p>
        {msg && <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-700">{msg}</p>}
        {eventos && eventos.length === 0 && <p className="mt-2 text-xs text-slate-500">Todavía no hay eventos registrados para {symbol}.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {(eventos ?? []).map((e) => (
            <button key={e.id} type="button" onClick={() => setAbierto(e.id)}
              className={`rounded-md border px-2 py-1 text-xs ${abierto === e.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700'}`}>
              {e.tipo} {e.periodo ?? ''} · {e.fecha_prevista ?? 'sin fecha'} · {e.expectativas} exp / {e.reales} reales
            </button>
          ))}
        </div>
        {abierto != null && <div className="mt-4"><Evento id={abierto} alCambiar={cargar} /></div>}
      </section>

      {cal && cal.pares > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Calibración histórica ({cal.pares} pares)</h2>
          <table className="w-full text-xs tabular-nums">
            <thead className="text-[10px] text-slate-400"><tr><th className="text-left">Fuente</th><th className="text-right">n</th><th className="text-right">Error medio</th><th className="text-right">Sesgo</th><th className="text-right">Cerca</th><th className="text-right">Mejor prevista</th></tr></thead>
            <tbody>
              {Object.entries(cal.por_fuente).map(([f, c]) => (
                <tr key={f} className="border-t border-slate-100">
                  <td className="text-left text-slate-700">{FUENTE[f] ?? f}{!c.total.suficiente && <span className="ml-1 text-amber-800">(muestra insuficiente)</span>}</td>
                  <td className="text-right">{c.total.n}</td>
                  <td className="text-right">{fmtPct(c.total.error_medio_abs ?? null, 1)}</td>
                  <td className="text-right">{fmtPct(c.total.sesgo ?? null, 1)}</td>
                  <td className="text-right">{fmtPct(c.total.cerca_pct ?? null, 0)}</td>
                  <td className="text-right">{c.mejor_prevista ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-400">{cal.nota} Sesgo positivo = lo real salió por encima de lo esperado.</p>
        </section>
      )}
    </div>
  )
}
