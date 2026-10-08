import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Interpretation, NewsFeed, NewsItem } from '../api/types'
import { SourceBadge } from '../components/SourceBadge'
import { fmtDateTime } from '../lib/format'
import { useLlmStatus } from '../lib/llm'
import { primerSimbolo } from '../lib/simbolos'
import { BloqueIA, BotonIA } from '../components/ia/ContenidoIA'

function AiInterpretation({ data }: { data: Interpretation }) {
  return (
    <BloqueIA
      className="mt-2"
      modelo={data.model}
      nota={data.cached ? 'desde caché (sin coste nuevo)' : undefined}
      aviso={data.disclaimer}
    >
      {data.content_md}
    </BloqueIA>
  )
}

function NewsCard({ item, symbol }: { item: NewsItem; symbol: string | null }) {
  const [interp, setInterp] = useState<Interpretation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const llm = useLlmStatus()

  const interpret = async () => {
    setBusy(true)
    setError(null)
    try {
      setInterp(
        await api.interpretNews({
          headline: item.headline,
          summary: item.summary,
          symbol: primerSimbolo(item.related) ?? symbol,
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-800 hover:text-sky-700 hover:underline"
          >
            {item.headline}
          </a>
          <div className="mt-0.5 text-xs text-slate-400">
            {item.source ?? '—'} · {fmtDateTime(item.published_at)}
            {item.related ? ` · ${item.related}` : ''}
          </div>
          {item.summary && (
            <p className="mt-1 line-clamp-3 text-sm text-slate-500">{item.summary}</p>
          )}
        </div>
        {!interp && llm?.configured && (
          <BotonIA
            onClick={interpret}
            disabled={busy}
            title="Llama al API de Claude (una vez por noticia; luego queda en caché)"
            className="shrink-0"
          >
            {busy ? 'Interpretando…' : '¿Por qué importa? (IA)'}
          </BotonIA>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {interp && <AiInterpretation data={interp} />}
    </li>
  )
}

export function NewsPage() {
  const [symbolInput, setSymbolInput] = useState('')
  const [symbol, setSymbol] = useState<string | null>(null)
  const [feed, setFeed] = useState<NewsFeed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const llm = useLlmStatus()

  useEffect(() => {
    setFeed(null)
    setError(null)
    api.news(symbol).then(setFeed, (e) => setError(e.message))
  }, [symbol])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-800">
          Noticias {symbol ? `· ${symbol}` : 'generales'}
        </h1>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSymbol(symbolInput.trim() ? symbolInput.trim().toUpperCase() : null)
          }}
          className="flex gap-2"
        >
          <input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="Filtrar por ticker (vacío = general)"
            className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
          />
          <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700">
            Filtrar
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-400">
        El feed viene de la API de noticias (cacheado 15 min).{' '}
        {llm?.configured
          ? 'La interpretación por IA solo se genera cuando la pides, queda etiquetada en morado y se guarda para no repetir el gasto.'
          : 'La capa de IA está desactivada: sin ANTHROPIC_API_KEY no hay interpretación de noticias, el resto de la app funciona igual.'}
      </p>

      {error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
        </p>
      )}
      {!feed && !error && <p className="text-sm text-slate-400">Cargando noticias…</p>}
      {feed && (
        <>
          <div className="flex justify-end">
            <SourceBadge data={feed} />
          </div>
          {feed.items.length === 0 && (
            <p className="text-sm text-slate-400">Sin noticias en el periodo.</p>
          )}
          <ul className="space-y-3">
            {feed.items.map((item) => (
              <NewsCard key={item.url} item={item} symbol={symbol} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
