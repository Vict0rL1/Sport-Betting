import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { CalidadBeneficios, EvidenciaCalidad, Linaje } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { fmtNum, fmtPct } from '../../lib/formato'

const ESTADO: Record<string, string> = {
  bueno: 'bg-emerald-100 text-emerald-800',
  normal: 'bg-slate-100 text-slate-800',
  aviso: 'bg-red-100 text-red-800',
  desconocido: 'bg-amber-100 text-amber-800',
}

const GLOBAL: Record<string, string> = {
  solida: 'SÓLIDA',
  vigilar: 'VIGILAR',
  precaucion: 'PRECAUCIÓN',
  desconocido: 'DESCONOCIDA',
}

function Entrada({ nombre, e }: { nombre: string; e: Linaje }) {
  if (!e || typeof e !== 'object') return null
  return (
    <li className="text-[11px] text-slate-500">
      <span className="text-slate-700">{etiqueta(nombre, { mayuscula: true })}:</span>{' '}
      {e.valor === null ? 'desconocido' : Math.abs(e.valor) >= 1e5 ? `${fmtNum(e.valor / 1e6, 1)} M` : fmtNum(e.valor, 2)}
      {e.formulario && (
        <span className="ml-1 text-slate-400">
          · {e.formulario} {e.accn} · publicado {e.publicado} · {e.etiqueta}
          {e.derivado ? ` · derivado: ${e.derivado}` : ''}
        </span>
      )}
    </li>
  )
}

function Fila({ e }: { e: EvidenciaCalidad }) {
  const esFraccion = !['conversion_caja'].includes(e.categoria)
  return (
    <details className="border-b border-slate-100 py-2 last:border-0">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-2 text-xs">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ESTADO[e.estado]}`}>{e.estado.toUpperCase()}</span>
        <span className="font-medium text-slate-800">{etiqueta(e.categoria, { mayuscula: true })}</span>
        <span className="tabular-nums text-slate-600">
          {e.valor === null ? '—' : esFraccion ? fmtPct(e.valor, 1) : `${fmtNum(e.valor, 2)}×`}
        </span>
        <span className="text-slate-400">{e.periodo ? `ejercicio ${e.periodo}` : ''}</span>
        {e.persistente && <span className="rounded bg-red-100 px-1 text-[10px] text-red-800">persistente</span>}
      </summary>
      <div className="ml-2 mt-1 space-y-1">
        <p className="text-[11px] text-slate-600">Regla: {e.regla}</p>
        {e.motivo && <p className="text-[11px] text-amber-800">{e.motivo}</p>}
        {e.metodo && <p className="text-[11px] text-slate-500">Método: {e.metodo}</p>}
        <ul>
          {Object.entries(e.entradas ?? {}).map(([k, v]) => (
            <Entrada key={k} nombre={k} e={v} />
          ))}
        </ul>
      </div>
    </details>
  )
}

export function CalidadSection({ symbol }: { symbol: string }) {
  const [datos, setDatos] = useState<CalidadBeneficios | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDatos(null)
    setError(null)
    api.calidad(symbol).then(setDatos, (e: Error) => setError(e.message))
  }, [symbol])

  if (error) return <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>
  if (!datos) return <p className="text-sm text-slate-400">Cargando calidad de beneficios…</p>

  const columnas = ['cfo_sobre_beneficio', 'fcf_sobre_beneficio', 'sbc_sobre_ingresos', 'dias_de_cobro', 'brecha_cobros', 'brecha_inventario']
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Calidad de beneficios ({datos.ejercicio}): {GLOBAL[datos.global] ?? datos.global}
          </h2>
          {datos.puntuacion && (
            <span className="text-[11px] text-slate-400">
              Secundaria: {fmtNum(datos.puntuacion.valor, 2, { signo: true, ceros: false })} sobre {datos.puntuacion.evaluables} evaluables ({datos.puntuacion.regla})
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{datos.regla_global}</p>
        <div className="mt-2">
          {datos.evidencias.map((e) => (
            <Fila key={e.categoria} e={e} />
          ))}
        </div>
        {datos.limite && <p className="mt-2 text-[10px] text-slate-400">{datos.limite}</p>}
      </section>

      {datos.historia && datos.historia.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Evolución</h2>
          {[['Ejercicios', datos.historia], ['Trimestres', datos.trimestral ?? []]].map(([titulo, filas]) =>
            (filas as Record<string, number | string | null>[]).length ? (
              <div key={titulo as string} className="mb-3 overflow-x-auto">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">{titulo as string}</div>
                <table className="w-full text-right text-xs tabular-nums">
                  <thead className="text-[10px] text-slate-400">
                    <tr>
                      <th className="text-left">Periodo</th>
                      <th>CFO/beneficio</th>
                      <th>FCF/beneficio</th>
                      <th>SBC/ingresos</th>
                      <th>Días de cobro</th>
                      <th>Brecha cobros</th>
                      <th>Brecha inventario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filas as Record<string, number | string | null>[]).map((f) => (
                      <tr key={String(f.periodo)} className="border-t border-slate-100">
                        <td className="text-left text-slate-700">{f.periodo}</td>
                        {columnas.map((c) => {
                          const v = f[c] as number | null | undefined
                          return (
                            <td key={c} className="text-slate-600">
                              {v == null ? '—' : c === 'dias_de_cobro' ? fmtNum(v, 0) : c.includes('beneficio') ? `${fmtNum(v, 2)}×` : fmtPct(v, 1)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null,
          )}
        </section>
      )}
    </div>
  )
}
