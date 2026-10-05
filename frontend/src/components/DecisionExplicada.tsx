import type { AlternativaDecision, Decision, ReglaTraza } from '../api/types'
import { fmtNumber } from '../lib/format'

// Todo lo que se pinta aquí sale de la traza del motor de reglas: qué regla se
// evaluó, con qué valor, contra qué umbral y qué papel tuvo. No hay texto
// generado: si la explicación no está en la traza, no está.

const PAPEL: Record<string, { texto: string; tono: string }> = {
  decide: { texto: 'decide', tono: 'bg-slate-900 text-white' },
  bloquea: { texto: 'bloquea', tono: 'bg-amber-100 text-amber-800' },
  a_favor: { texto: 'a favor', tono: 'bg-emerald-100 text-emerald-800' },
  modifica: { texto: 'modifica', tono: 'bg-sky-100 text-sky-800' },
  informa: { texto: 'informa', tono: 'bg-slate-100 text-slate-800' },
  evaluada: { texto: 'evaluada', tono: 'bg-slate-100 text-slate-500' },
}

const RESULTADO: Record<string, { texto: string; tono: string }> = {
  cumple: { texto: '✓ cumple', tono: 'text-emerald-700' },
  no_cumple: { texto: '✗ no cumple', tono: 'text-slate-500' },
  desconocido: { texto: '? desconocido', tono: 'text-amber-700' },
}

const ACCION: Record<string, string> = {
  comprar: 'Comprar',
  vigilar: 'Vigilar',
  mantener: 'Mantener',
  reducir: 'Reducir',
  vender: 'Vender',
  evitar: 'Evitar',
  ninguna: 'Sin acción',
  sin_datos: 'Sin datos',
}

function valor(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Math.abs(v) < 10 ? fmtNumber(v, 2) : fmtNumber(v, 2)
  return String(v)
}

export function PorQue({ reglas }: { reglas: ReglaTraza[] }) {
  // Primero lo que movió la decisión; lo meramente evaluado, al final.
  const orden = ['decide', 'modifica', 'bloquea', 'a_favor', 'informa', 'evaluada']
  const ordenadas = [...reglas].sort((a, b) => orden.indexOf(a.papel) - orden.indexOf(b.papel))
  return (
    <ul className="space-y-1">
      {ordenadas.map((r) => {
        const p = PAPEL[r.papel] ?? PAPEL.evaluada
        const res = RESULTADO[r.resultado] ?? RESULTADO.desconocido
        const tieneCifras = r.datos?.valor !== undefined && r.datos?.umbral !== undefined
        return (
          <li key={r.id} className="flex flex-wrap items-baseline gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${p.tono}`}>{p.texto}</span>
            <span className="text-slate-700">{r.regla}</span>
            {tieneCifras && (
              <span className="tabular-nums text-slate-500">
                ({valor(r.datos.valor)} frente a {valor(r.datos.umbral)})
              </span>
            )}
            <span className={`font-medium ${res.tono}`}>{res.texto}</span>
            {r.efecto && r.papel !== 'evaluada' && (
              <span className="text-slate-400">→ {ACCION[r.efecto] ?? r.efecto}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function QueLaCambiaria({ cambiaria }: { cambiaria: AlternativaDecision[] }) {
  return (
    <ul className="space-y-2">
      {cambiaria.map((alt, i) => (
        <li key={i} className="text-xs">
          <div className="font-medium text-slate-800">
            → {ACCION[alt.hacia] ?? alt.hacia}{' '}
            <span className="font-normal text-slate-400">
              {alt.condiciones.length > 1 ? (alt.requiere === 'todas' ? 'si se cumplen TODAS:' : 'si se cumple ALGUNA:') : 'si:'}
            </span>
          </div>
          <ul className="ml-3 mt-0.5 space-y-0.5">
            {alt.condiciones.map((c, j) => (
              <li key={j} className="text-slate-600">
                · {c.condicion}
                {c.distancia !== null && c.distancia !== undefined && (
                  <span className="ml-1 tabular-nums text-slate-400">
                    (ahora {valor(c.actual)}; falta {c.distancia >= 0 ? '+' : ''}
                    {fmtNumber(c.distancia, 2)} {c.unidad === '%' ? '%' : c.unidad})
                  </span>
                )}
                {c.nota && <span className="ml-1 text-amber-700">{c.nota}</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

/** «¿Por qué esta decisión?» y «¿Qué la cambiaría?», plegados por defecto. */
export function DecisionExplicada({ decision, abierta = false }: { decision: Decision; abierta?: boolean }) {
  if (!decision.reglas?.length && !decision.cambiaria?.length) return null
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {decision.reglas?.length ? (
        <details open={abierta} className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            ¿Por qué esta decisión?
          </summary>
          <div className="mt-2">
            <PorQue reglas={decision.reglas} />
            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              El motor es una lista de reglas con prioridad: la primera que se cumple decide. Esto es su
              traza, no una explicación redactada.
            </p>
          </div>
        </details>
      ) : null}
      {decision.cambiaria?.length ? (
        <details open={abierta} className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            ¿Qué la cambiaría?
          </summary>
          <div className="mt-2">
            <QueLaCambiaria cambiaria={decision.cambiaria} />
          </div>
        </details>
      ) : null}
    </div>
  )
}
