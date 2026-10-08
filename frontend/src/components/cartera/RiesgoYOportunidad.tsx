import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AnalisisEmpresaResponse, ContribucionAlRiesgo, SaldosEfectivo } from '../../api/types'
import { fmtDateTime, fmtNumber, fmtPct } from '../../lib/format'
import { CosteOportunidadResumen, RiesgoResumen } from '../ticker/QueCambioSection'

function Caja({ titulo, subtitulo, children }: { titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
      <p className="mb-3 text-xs text-slate-500">{subtitulo}</p>
      {children}
    </section>
  )
}

export function ContribucionAlRiesgoPanel() {
  const [c, setC] = useState<ContribucionAlRiesgo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const cargar = useCallback((descargar: boolean) => {
    setCargando(true)
    api.contribucion(descargar).then(setC, (e: Error) => setError(e.message)).finally(() => setCargando(false))
  }, [])
  useEffect(() => cargar(false), [cargar])

  return (
    <>
      <Caja titulo="Contribución al riesgo" subtitulo="Cuánto de lo que se mueve la cartera lo mueve cada posición. Peso y riesgo no son lo mismo.">
        {error && <p className="text-xs text-red-700">{error}</p>}
        {!c && !error && <p className="text-xs text-slate-400">Calculando…</p>}
        {c && (
          <div className="space-y-3">
            {!c.disponible && <p className="text-xs text-slate-500">{c.nota}</p>}
            {c.disponible && (
              <>
                <p className="text-xs text-slate-600">
                  Volatilidad anual medida {fmtPct(c.volatilidad_cartera_medida ?? null, 1)} · {c.desde} → {c.hasta} · cobertura{' '}
                  {fmtPct(c.cobertura_peso ?? null, 0)} del peso.
                </p>
                {c.concentracion && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 p-3 text-xs">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Top 3 por capital</div>
                      <div className="text-lg font-semibold tabular-nums text-slate-900">{fmtPct(c.concentracion.top3_capital.peso, 0)}</div>
                      <div className="text-slate-500">{c.concentracion.top3_capital.symbols.join(', ')}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3 text-xs">
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">Top 3 por riesgo</div>
                      <div className="text-lg font-semibold tabular-nums text-slate-900">{fmtPct(c.concentracion.top3_riesgo.contribucion, 0)}</div>
                      <div className="text-slate-500">{c.concentracion.top3_riesgo.symbols.join(', ')}</div>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs tabular-nums [&_td]:px-1.5 [&_th]:px-1.5">
                    <thead className="text-[10px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="text-left">Posición</th><th>Peso</th><th>Volatilidad</th><th>Riesgo</th><th>Riesgo/peso</th>
                        <th>Marginal</th><th>Corr. cartera</th><th>Beta {c.indice_beta ?? ''}</th><th className="text-left">Sector</th><th className="text-left">Moneda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.posiciones.map((p) => (
                        <tr key={p.symbol} className="border-t border-slate-100">
                          <td className="text-left font-medium text-slate-800">{p.symbol}</td>
                          <td>{fmtPct(p.peso, 1)}</td>
                          <td>{fmtPct(p.volatilidad, 0)}</td>
                          <td className="font-semibold text-slate-900">{fmtPct(p.contribucion, 1)}</td>
                          <td className={p.riesgo_por_peso && p.riesgo_por_peso > 1.2 ? 'text-red-700' : 'text-slate-600'}>{fmtNumber(p.riesgo_por_peso, 2)}×</td>
                          <td className="text-slate-500">{fmtNumber(p.marginal, 3)}</td>
                          <td className="text-slate-500">{fmtNumber(p.correlacion_con_cartera, 2)}</td>
                          <td className="text-slate-500">{fmtNumber(p.beta_mercado, 2)}</td>
                          <td className="text-left text-slate-500">{p.sector ?? '—'}</td>
                          <td className="text-left text-slate-500">{p.moneda ?? '—'}</td>
                        </tr>
                      ))}
                      {c.desconocidas.map((d) => (
                        <tr key={d.symbol} className="border-t border-slate-100 text-amber-800">
                          <td className="text-left font-medium">{d.symbol}</td>
                          <td>{d.peso != null ? fmtPct(d.peso, 1) : '—'}</td>
                          <td colSpan={8} className="text-left">DESCONOCIDO — {d.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-slate-400">{c.metodo}. {c.nota}</p>
              </>
            )}
            <button type="button" onClick={() => cargar(true)} disabled={cargando}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
              {cargando ? 'Descargando…' : 'Descargar histórico y recalcular'}
            </button>
          </div>
        )}
      </Caja>

      {c?.disponible && (c.clusters ?? []).length > 0 && (
        <Caja titulo="Clústeres de riesgo" subtitulo="Lo que comparte exposición: sector, industria, moneda, correlación medida o beta alta.">
          <ul className="space-y-1 text-xs">
            {c.clusters!.map((g) => (
              <li key={g.dimension + g.etiqueta} className="flex flex-wrap justify-between gap-2 border-b border-slate-100 py-1 last:border-0">
                <span className="text-slate-700">
                  <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-800">{g.dimension}</span> {g.etiqueta}: {g.miembros.join(', ')}
                  {g.desconocidos.length > 0 && <span className="text-amber-800"> (riesgo desconocido: {g.desconocidos.join(', ')})</span>}
                </span>
                <span className="tabular-nums text-slate-600">
                  {fmtPct(g.peso, 0)} del capital · {fmtPct(g.contribucion, 0)} del riesgo
                </span>
              </li>
            ))}
          </ul>
        </Caja>
      )}
    </>
  )
}

export function CosteOportunidadPanel() {
  const [efectivo, setEfectivo] = useState<SaldosEfectivo | null>(null)
  const [importe, setImporte] = useState('')
  const [moneda, setMoneda] = useState('USD')
  const [ticker, setTicker] = useState('')
  const [tipo, setTipo] = useState('')
  const [res, setRes] = useState<AnalisisEmpresaResponse | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const cargarEfectivo = useCallback(() => {
    api.efectivo().then(setEfectivo, () => setEfectivo(null))
  }, [])
  useEffect(cargarEfectivo, [cargarEfectivo])

  const anotar = (e: React.FormEvent) => {
    e.preventDefault()
    const n = Number(importe.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) {
      setMsg('Importe inválido.')
      return
    }
    api.anotarEfectivo({ moneda, importe: n }).then(() => { setImporte(''); setMsg(null); cargarEfectivo() }, (er: Error) => setMsg(er.message))
  }
  const evaluar = (e: React.FormEvent) => {
    e.preventDefault()
    const s = ticker.trim().toUpperCase()
    if (!s) return
    const t = tipo.trim() ? Number(tipo.replace(',', '.')) / 100 : null
    setCargando(true)
    setRes(null)
    api.analisisEmpresa(s, t).then(setRes, (er: Error) => setMsg(er.message)).finally(() => setCargando(false))
  }

  return (
    <Caja titulo="Coste de oportunidad" subtitulo="¿Esta idea es MEJOR que lo que ya tienes? Si no lo es claramente, la respuesta es no hacer nada.">
      <div className="space-y-3">
        <div className="text-xs text-slate-600">
          Efectivo anotado:{' '}
          {efectivo?.saldos.length
            ? efectivo.saldos.map((s) => `${fmtNumber(s.importe, 2)} ${s.moneda} (${fmtDateTime(s.as_of)})`).join(' · ')
            : <span className="text-amber-800">ninguno — el motor lo trata como DESCONOCIDO, no como cero</span>}
        </div>
        <form onSubmit={anotar} className="flex flex-wrap gap-2">
          <input value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="Efectivo disponible"
            className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs" />
          <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
            <option>USD</option><option>CAD</option><option>EUR</option>
          </select>
          <button type="submit" className="rounded-md border border-slate-300 px-2 py-1 text-xs">Anotar efectivo</button>
        </form>
        <form onSubmit={evaluar} className="flex flex-wrap gap-2">
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Idea nueva (p. ej. MSFT)"
            className="w-40 rounded-md border border-slate-300 px-2 py-1 text-xs" />
          <input value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Tipo sobre plusvalías % (opcional)"
            className="w-56 rounded-md border border-slate-300 px-2 py-1 text-xs" />
          <button type="submit" disabled={cargando} className="rounded-md bg-slate-800 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
            {cargando ? 'Evaluando…' : 'Comparar con mi cartera'}
          </button>
        </form>
        {msg && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{msg}</p>}
        {res && (
          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-700">
              <strong>{res.analisis.symbol}</strong>: el motor dice «{res.analisis.decision.label}» con confianza {res.analisis.confianza.nivel}.
            </p>
            <RiesgoResumen r={res.analisis.riesgo} />
            <CosteOportunidadResumen oc={res.analisis.coste_oportunidad} />
          </div>
        )}
      </div>
    </Caja>
  )
}
