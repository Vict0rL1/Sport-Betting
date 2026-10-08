import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { DecisionHistorica, ReplayDecision } from '../../api/types'
import { fmtFecha, fmtNum, fmtPct } from '../../lib/formato'
import { DecisionExplicada } from '../DecisionExplicada'
import { CosteOportunidadResumen, RiesgoResumen } from './QueCambioSection'

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">{titulo}</div>
      {children}
    </div>
  )
}

function Replay({ r }: { r: ReplayDecision }) {
  const s = r.secciones
  const precio = (s.mercado as ReplayDecision['secciones']['mercado'])?.precio
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-800">
          {r.symbol} — {r.fecha} — {r.accion.toUpperCase()}
        </span>
        <span className="text-slate-400">{r.momento ? fmtFecha(r.momento, { hora: true }) : ''} · origen {r.origen} · reglas v{r.reglas_version}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r.completo ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
          {r.completo ? 'completo' : 'INCOMPLETO'}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${r.integridad.huella_coincide ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
          {r.integridad.huella_coincide ? 'huella íntegra' : 'MODIFICADA'}
        </span>
      </div>
      {r.nota && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{r.nota}</p>}
      {r.proteccion_anticipacion && (
        <p className="text-[11px] text-slate-500">
          Sin información posterior: {r.proteccion_anticipacion.marcas_comprobadas} marcas de tiempo comprobadas contra{' '}
          «{r.proteccion_anticipacion.regla}».
          {r.proteccion_anticipacion.retiradas_por_fecha_futura.length > 0 && (
            <span className="text-red-700"> Retirado por fecha futura: {r.proteccion_anticipacion.retiradas_por_fecha_futura.join(', ')}.</span>
          )}
        </p>
      )}
      {(r.no_congelado.length > 0 || (r.incompletas ?? []).length > 0) && (
        <p className="text-[11px] text-amber-800">
          {r.no_congelado.length > 0 && <>No se congeló (y no se rellena con lo de hoy): {r.no_congelado.join(', ')}. </>}
          {(r.incompletas ?? []).length > 0 && <>Desconocido entonces: {(r.incompletas ?? []).join(', ')}.</>}
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {precio && (
          <Bloque titulo="Precio utilizado">
            <p className="text-xs text-slate-700">
              {fmtNum(precio.valor, 2)} {precio.moneda ?? ''} · {precio.fuente ?? 'fuente desconocida'} · {precio.publicado ?? 'sin fecha'} · {precio.estado}
            </p>
          </Bloque>
        )}
        {s.senal && (
          <Bloque titulo="Señal">
            <p className="text-xs text-slate-700">
              Puntuación {fmtNum((s.senal as { score: number | null }).score, 2)} · {(s.senal as { origen?: string }).origen ?? ''}
            </p>
          </Bloque>
        )}
        {s.fundamentales && (s.fundamentales as { metricas?: Record<string, { valor: number | null; unidad?: string }> }).metricas && (
          <Bloque titulo={`Fundamentales conocidos entonces (ejercicio ${(s.fundamentales as { ejercicio?: string }).ejercicio ?? '—'})`}>
            <ul className="text-xs text-slate-700">
              {Object.entries((s.fundamentales as { metricas: Record<string, { valor: number | null; unidad?: string }> }).metricas).map(([k, m]) => (
                <li key={k} className="flex justify-between">
                  <span>{k.replace(/_/g, ' ')}</span>
                  <span className="tabular-nums">{m.valor == null ? 'desconocido' : m.unidad === 'fracción' ? fmtPct(m.valor, 1) : Math.abs(m.valor) > 1e5 ? `${fmtNum(m.valor / 1e6, 1)} M` : fmtNum(m.valor, 2)}</span>
                </li>
              ))}
            </ul>
          </Bloque>
        )}
        {s.valoracion && (
          <Bloque titulo="Valoración">
            <p className="text-xs text-slate-700">
              P/E {fmtNum((s.valoracion as { pe?: { valor: number | null } }).pe?.valor ?? null, 1)} · crecimiento implícito (DCF inverso al 9 %){' '}
              {fmtPct((s.valoracion as { dcf_inverso?: { crecimiento_implicito?: number | null } }).dcf_inverso?.crecimiento_implicito ?? null, 1)}
            </p>
          </Bloque>
        )}
        {s.tesis && (
          <Bloque titulo="Tesis vigente entonces">
            <p className="text-xs text-slate-700">
              {(s.tesis as { titulo?: string }).titulo ?? 'sin tesis'} · estado {(s.tesis as { estado: string }).estado}
            </p>
            <ul className="mt-1 text-[11px] text-slate-500">
              {((s.tesis as { disparadores?: { id: number; descripcion: string; salta: boolean; medible: boolean }[] }).disparadores ?? []).map((t) => (
                <li key={t.id}>{t.salta ? '✗ cruzado' : t.medible ? '✓' : '?'} {t.descripcion}</li>
              ))}
            </ul>
          </Bloque>
        )}
        {s.riesgo && (
          <Bloque titulo="Riesgo en cartera entonces"><RiesgoResumen r={s.riesgo as never} /></Bloque>
        )}
        {s.coste_oportunidad && (
          <Bloque titulo="Coste de oportunidad entonces"><CosteOportunidadResumen oc={s.coste_oportunidad as never} /></Bloque>
        )}
        {s.noticias && (
          <Bloque titulo="Noticias disponibles hasta ese momento">
            <ul className="text-[11px] text-slate-600">
              {((s.noticias as { items: { headline: string; published_at: string; source: string }[] }).items ?? []).map((n, i) => (
                <li key={i}>{fmtFecha(n.published_at, { hora: true })} · {n.source} · {n.headline}</li>
              ))}
            </ul>
          </Bloque>
        )}
      </div>
      {s.decision && (
        <Bloque titulo="Decisión final y sus reglas">
          <ul className="mb-2 text-xs text-slate-600">
            {((s.decision as { reasons?: string[] }).reasons ?? []).map((x, i) => (
              <li key={i}>· {x}</li>
            ))}
          </ul>
          <DecisionExplicada decision={s.decision as never} abierta />
        </Bloque>
      )}
      {r.faltaban && r.faltaban.length > 0 && (
        <p className="text-[11px] text-amber-800">Datos desconocidos en ese momento: {r.faltaban.map((f) => f.dato).join(', ')}.</p>
      )}
      {r.resultados.length > 0 && (
        <p className="text-[11px] text-slate-500">
          Medido después (en filas aparte, sin tocar la instantánea): {r.resultados.map((x) => `${x.estado} ${x.retorno_pct ?? '—'} % a ${x.dias} días`).join(' · ')}
        </p>
      )}
    </div>
  )
}

export function HistorialSection({ symbol }: { symbol: string }) {
  const [filas, setFilas] = useState<DecisionHistorica[] | null>(null)
  const [replay, setReplay] = useState<ReplayDecision | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFilas(null)
    setReplay(null)
    api.historialEmpresa(symbol).then((r) => setFilas(r.decisiones), (e: Error) => setError(e.message))
  }, [symbol])

  const abrir = (id: number) => api.replay(id).then(setReplay, (e: Error) => setError(e.message))

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
  if (!filas) return <p className="text-sm text-slate-400">Cargando historial de decisiones…</p>

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Lo que el sistema dijo de {symbol}</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          Cada fila es una instantánea inmutable. El replay enseña SOLO lo que se sabía en ese momento.
        </p>
        {filas.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">Todavía no hay decisiones congeladas de esta empresa. Abre «Qué cambió» para crear la primera.</p>
        ) : (
          <table className="mt-2 w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
              <tr><th className="py-1 text-left">Cuándo</th><th className="text-left">Origen</th><th className="text-left">Acción</th><th className="text-right">Precio</th><th className="text-right">Puntuación</th><th /></tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className={`border-t border-slate-100 ${replay?.id === f.id ? 'bg-slate-50' : ''}`}>
                  <td className="py-1 text-slate-700">{fmtFecha(f.creado_en, { hora: true })}</td>
                  <td className="text-slate-500">{f.origen}</td>
                  <td className="font-medium text-slate-800">{f.accion}</td>
                  <td className="text-right tabular-nums">{fmtNum(f.precio, 2)}</td>
                  <td className="text-right tabular-nums">{fmtNum(f.score, 2)}</td>
                  <td className="text-right">
                    <button type="button" onClick={() => abrir(f.id)} className="rounded border border-slate-300 px-2 py-0.5 text-[11px]">
                      Replay
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {replay && (
        <section className="rounded-xl border border-slate-300 bg-slate-50 p-4">
          <Replay r={replay} />
        </section>
      )}
    </div>
  )
}
