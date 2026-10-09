import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AnalisisEmpresaResponse, CambioMetrica, CosteOportunidad, RiesgoEnCartera } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { fmtFecha, fmtNum, fmtPct, plural } from '../../lib/formato'
import { DecisionExplicada } from '../DecisionExplicada'
import { BloqueIA, BotonIA } from '../ia/ContenidoIA'

const NIVEL: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-800',
  media: 'bg-amber-100 text-amber-800',
  baja: 'bg-red-100 text-red-800',
}

const FACTOR: Record<string, string> = {
  ok: 'text-emerald-700',
  debil: 'text-amber-800',
  critico: 'text-red-700',
  desconocido: 'text-amber-800',
}

function fmtValor(v: number | string | null | undefined, unidad?: string): string {
  if (v === null || v === undefined) return 'desconocido'
  if (typeof v === 'string') return v
  if (unidad === 'fracción') return fmtPct(v, 1)
  if (unidad === 'USD') return fmtNum(v / 1e6, 1) + ' M'
  return fmtNum(v, 2)
}

function Cambio({ c }: { c: CambioMetrica }) {
  const tono =
    c.tipo === 'dato_perdido' ? 'text-amber-800' : c.direccion === 'baja' ? 'text-red-700' : c.direccion === 'sube' ? 'text-emerald-700' : 'text-slate-700'
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-1 text-xs last:border-0">
      <span className="text-slate-700">{c.etiqueta}</span>
      <span className={`tabular-nums ${tono}`}>
        {fmtValor(c.antes, c.unidad)} → {fmtValor(c.ahora, c.unidad)}
        {c.tipo === 'material' && c.unidad === 'fracción' && c.absoluto !== undefined && (
          <span className="ml-1 text-slate-400">({c.absoluto >= 0 ? '+' : ''}{fmtNum(c.absoluto * 100, 1)} pp)</span>
        )}
        {c.tipo === 'material' && c.unidad === 'puntos' && c.absoluto !== undefined && (
          <span className="ml-1 text-slate-400">({c.absoluto >= 0 ? '+' : ''}{fmtNum(c.absoluto, 2)} puntos)</span>
        )}
        {c.tipo === 'material' && c.unidad !== 'fracción' && c.unidad !== 'puntos' && c.relativo != null && (
          <span className="ml-1 text-slate-400">({fmtPct(c.relativo, 1, { signo: true })})</span>
        )}
        {c.tipo === 'dato_nuevo' && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">dato nuevo</span>}
        {c.tipo === 'dato_perdido' && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">dato perdido</span>}
      </span>
    </li>
  )
}

export function RiesgoResumen({ r }: { r: RiesgoEnCartera }) {
  if (r.estado === 'sin_cartera') return <p className="text-xs text-slate-500">Sin posiciones valoradas: no hay riesgo de cartera que medir.</p>
  if (r.estado !== 'valido') return <p className="text-xs text-amber-800">Riesgo en cartera DESCONOCIDO: {r.motivo}</p>
  return (
    <div className="text-xs text-slate-700">
      <p>
        {r.en_cartera ? (
          <>Pesa el <strong>{fmtPct(r.peso)}</strong> y aporta el <strong>{fmtPct(r.contribucion)}</strong> del riesgo medido.</>
        ) : (
          <>Si la añadieras al {fmtPct(r.peso_supuesto)}, aportaría el <strong>{fmtPct(r.contribucion)}</strong> del riesgo
            (volatilidad de la cartera {fmtPct(r.volatilidad_cartera_antes)} → {fmtPct(r.volatilidad_cartera_despues)}).</>
        )}
      </p>
      <p className="mt-1 text-slate-500">
        Correlación con la cartera {fmtNum(r.correlacion_con_cartera ?? null, 2)} · clúster {r.cluster_nivel ?? '—'} ·
        riesgo por unidad de peso {fmtNum(r.riesgo_por_peso ?? null, 2)}
      </p>
    </div>
  )
}

const VEREDICTO: Record<string, string> = {
  NO_ACCION: 'bg-slate-100 text-slate-800',
  COMPRAR_CON_EFECTIVO: 'bg-emerald-100 text-emerald-800',
  REVISAR_PARA_FINANCIAR: 'bg-sky-100 text-sky-800',
  NO_TRADE: 'bg-amber-100 text-amber-800',
  INDETERMINADO: 'bg-amber-100 text-amber-800',
}

export function CosteOportunidadResumen({ oc }: { oc: CosteOportunidad }) {
  if (!oc.veredicto) return <p className="text-xs text-amber-800">Coste de oportunidad no disponible: {oc.motivo}</p>
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 font-medium ${VEREDICTO[oc.veredicto.accion] ?? ''}`}>
          {etiqueta(oc.veredicto.accion, { mayuscula: true })}
        </span>
        {oc.tamano && (
          <span className="text-slate-500">
            tamaño máximo {fmtPct(oc.tamano.maximo_permitido)} · efectivo{' '}
            {oc.tamano.efectivo_disponible == null ? 'DESCONOCIDO' : fmtPct(oc.tamano.efectivo_disponible)}
            {oc.tamano.financiacion_necesaria != null && ` · a financiar ${fmtPct(oc.tamano.financiacion_necesaria)}`}
          </span>
        )}
      </div>
      <p className="text-slate-700">{oc.veredicto.motivo}</p>
      {oc.candidatos_a_revisar && oc.candidatos_a_revisar.length > 0 && (
        <table className="w-full text-left">
          <thead className="text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1">Posición</th>
              <th>Prioridad</th>
              <th>Mejora / exigida</th>
              <th>Coste del cambio</th>
              <th>Por qué</th>
            </tr>
          </thead>
          <tbody>
            {oc.candidatos_a_revisar.map((f) => (
              <tr key={f.symbol} className="border-t border-slate-100 align-top">
                <td className="py-1 font-medium text-slate-800">{f.symbol}</td>
                <td className="tabular-nums">{fmtNum(f.prioridad.puntos, 2, { ceros: false })}</td>
                <td className={`tabular-nums ${f.supera_umbral ? 'text-sky-800' : 'text-slate-500'}`}>
                  {fmtNum(f.mejora, 2, { ceros: false })} / {fmtNum(f.mejora_requerida, 2, { ceros: false })}
                </td>
                <td className="tabular-nums text-slate-500">
                  {fmtPct(f.coste_del_cambio.total_conocido_pct, 2, { enPuntos: true })}
                  {f.coste_del_cambio.impuestos === 'desconocidos' && f.coste_del_cambio.nota && (
                    <span className="block text-[10px] text-amber-800">+ impuestos desconocidos</span>
                  )}
                </td>
                <td className="text-slate-500">
                  {f.elegible
                    ? f.prioridad.desglose.map((d) => `${d.nota} (${d.puntos >= 0 ? '+' : '−'}${Math.abs(d.puntos)})`).join(' · ') || '—'
                    : <span className="text-amber-800">{f.motivo}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {oc.impuestos?.nota && <p className="text-[10px] text-slate-400">{oc.impuestos.nota}</p>}
    </div>
  )
}

export function QueCambioSection({ symbol }: { symbol: string }) {
  const [datos, setDatos] = useState<AnalisisEmpresaResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumenIa, setResumenIa] = useState<{ content_md: string; model: string; aviso: string } | null>(null)
  const [pidiendoIa, setPidiendoIa] = useState(false)

  useEffect(() => {
    setDatos(null)
    setError(null)
    setResumenIa(null)
    api.analisisEmpresa(symbol).then(setDatos, (e: Error) => setError(e.message))
  }, [symbol])

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
  if (!datos) return <p className="text-sm text-slate-400">Analizando {symbol} y comparando con el último análisis…</p>

  const { analisis: a, cambios } = datos
  const d = a.decision
  const pedirResumen = () => {
    setPidiendoIa(true)
    api
      .resumenCambiosIa(symbol, cambios)
      .then(setResumenIa, (e: Error) => setError(e.message))
      .finally(() => setPidiendoIa(false))
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Decisión del motor: <span className="text-slate-900">{d.label}</span>
            <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${NIVEL[a.confianza.nivel]}`}>
              confianza {a.confianza.nivel.toUpperCase()}
            </span>
          </h2>
          <span className="text-[11px] text-slate-400">
            {datos.instantanea
              ? `${datos.instantanea.nueva ? 'Instantánea nueva' : 'Sin cambios materiales: instantánea existente'} #${datos.instantanea.id} · ${fmtFecha(datos.instantanea.creado_en, { hora: true })}`
              : 'sin congelar'}
          </span>
        </div>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {d.reasons.map((r, i) => (
            <li key={i}>· {r}</li>
          ))}
        </ul>
        <div className="mt-3">
          <DecisionExplicada decision={d} abierta />
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            Confianza {a.confianza.nivel}: calidad de la evidencia (no convicción de nadie)
          </summary>
          <ul className="mt-2 space-y-0.5 text-xs">
            {a.confianza.factores.map((f) => (
              <li key={f.id}>
                <span className={`font-medium ${FACTOR[f.estado]}`}>{etiqueta(f.estado)}</span>{' '}
                <span className="text-slate-700">{f.factor}:</span> <span className="text-slate-500">{f.detalle}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-slate-400">Regla: {a.confianza.regla}</p>
        </details>
        {a.faltan.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            Desconocido (no vale cero): {a.faltan.map((f) => etiqueta(f.dato)).join(', ')}.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">¿Qué cambió desde el último análisis?</h2>
          {datos.anterior && (
            <span className="text-[11px] text-slate-400">
              frente a la instantánea #{datos.anterior.id} del {fmtFecha(datos.anterior.creado_en, { hora: true })}
            </span>
          )}
        </div>
        {cambios.primer_analisis ? (
          <p className="mt-2 text-xs text-slate-500">{cambios.nota}</p>
        ) : (
          <div className="mt-2 space-y-3">
            {cambios.decision?.cambio && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs">
                <div className="font-semibold text-sky-900">
                  {etiqueta(cambios.decision.antes, { mayuscula: true })} → {etiqueta(cambios.decision.ahora, { mayuscula: true })}
                </div>
                <ul className="mt-1 space-y-0.5 text-sky-900">
                  {cambios.decision.explicacion.map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px] text-sky-800">Sale de comparar las dos trazas del motor, no de un modelo de lenguaje.</p>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(cambios.categorias ?? {}).map(([cat, lista]) => (
                <div key={cat}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{etiqueta(cat)}</div>
                  <ul>
                    {lista.map((c) => (
                      <Cambio key={c.clave} c={c} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {cambios.tesis && (
              <div className="text-xs">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Tesis</div>
                {(
                  [
                    ['Invalidaciones', cambios.tesis.invalidaciones, 'text-red-700'],
                    ['Deteriorados', cambios.tesis.deteriorados, 'text-amber-800'],
                    ['Nuevos riesgos', cambios.tesis.nuevos_riesgos, 'text-amber-800'],
                    ['Confirmados', cambios.tesis.confirmados, 'text-emerald-700'],
                  ] as const
                ).map(([t, l, tono]) =>
                  l.length ? (
                    <p key={t} className={tono}>
                      {t}: {l.map((x) => `${x.punto}${'detalle' in x && x.detalle ? ` (${x.detalle})` : ''}`).join('; ')}
                    </p>
                  ) : null,
                )}
                {!cambios.tesis.invalidaciones.length && !cambios.tesis.deteriorados.length &&
                  !cambios.tesis.nuevos_riesgos.length && !cambios.tesis.confirmados.length && (
                    <p className="text-slate-500">Sin cambios en los puntos de la tesis.</p>
                  )}
              </div>
            )}
            {cambios.materiales != null && cambios.irrelevantes != null && (
              <p className="text-[10px] text-slate-400">
                {cambios.materiales} {plural(cambios.materiales, 'cambio material', 'cambios materiales')};{' '}
                {cambios.irrelevantes} por debajo de su umbral no se {plural(cambios.irrelevantes, 'enseña', 'enseñan')}
                (umbrales v{cambios.umbrales?.version}).
              </p>
            )}
            <div>
              <BotonIA onClick={pedirResumen} disabled={pidiendoIa}>
                {pidiendoIa ? 'Resumiendo…' : 'Resumir este diff con IA (opcional, gasta API)'}
              </BotonIA>
              {resumenIa && (
                <BloqueIA className="mt-2" modelo={resumenIa.model} aviso={resumenIa.aviso}>
                  {resumenIa.content_md}
                </BloqueIA>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Riesgo dentro de tu cartera</h2>
          <RiesgoResumen r={a.riesgo} />
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">¿Mejor que lo que ya tienes? (coste de oportunidad)</h2>
          <CosteOportunidadResumen oc={a.coste_oportunidad} />
        </section>
      </div>
    </div>
  )
}
