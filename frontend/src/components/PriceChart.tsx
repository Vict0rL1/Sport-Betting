import { useEffect, useRef } from 'react'
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type UTCTimestamp,
} from 'lightweight-charts'
import type { History } from '../api/types'
import { conOpacidad, leerToken, type Token } from '../lib/tokens'

function toTime(ts: string): UTCTimestamp {
  return Math.floor(new Date(ts.replace(' ', 'T') + 'Z').getTime() / 1000) as UTCTimestamp
}

function overlay(
  bars: History['bars'],
  values: (number | null)[],
): { time: UTCTimestamp; value: number }[] {
  const out: { time: UTCTimestamp; value: number }[] = []
  values.forEach((v, i) => {
    if (v !== null && bars[i]) out.push({ time: toTime(bars[i].ts), value: v })
  })
  return out
}

// Altura de cada subgráfico, en píxeles. El precio se queda con el resto: un
// RSI tan alto como el precio sugiere que pesan lo mismo, y no pesan lo mismo.
const ALTO_SUBGRAFICO = 90

// Las zonas del RSI. 70/30 es la convención, y va dibujada porque un RSI sin
// sus líneas es una curva que sube y baja sin escala que la signifique.
const RSI_SOBRECOMPRA = 70
const RSI_SOBREVENTA = 30

// Los colores salen de los tokens (src/index.css), no escritos aquí: el canvas
// no hereda la inversión de paleta del resto de la app, y con colores del tema
// claro el gráfico salía con rejilla blanca y un bloque de volumen verde menta
// sobre fondo oscuro (V1). Las medias y los indicadores usan los tokens de
// acento; la leyenda de abajo, los mismos.
const SMA_STYLES = [
  { key: 'sma20', token: 'info', label: 'SMA 20' },
  { key: 'sma50', token: 'warn', label: 'SMA 50' },
  { key: 'sma200', token: 'indicador', label: 'SMA 200' },
] as const satisfies readonly { key: string; token: Token; label: string }[]

const LEYENDA_INDICADORES: { token: Token; label: string }[] = [
  { token: 'indicador', label: 'RSI 14 (70/30)' },
  { token: 'info', label: 'MACD' },
  { token: 'warn', label: 'señal' },
]

// El volumen es contexto, no protagonista: semitransparente y en la quinta parte
// de abajo del panel del precio.
const OPACIDAD_VOLUMEN = 0.35
const OPACIDAD_REJILLA = 0.6

export function PriceChart({ history }: { history: History }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const c = (t: Token) => leerToken(t, el)
    const borde = c('border')
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: c('text-muted'),
        panes: { separatorColor: borde, separatorHoverColor: conOpacidad(c('text-muted'), 0.3) },
      },
      grid: {
        vertLines: { color: conOpacidad(borde, OPACIDAD_REJILLA) },
        horzLines: { color: conOpacidad(borde, OPACIDAD_REJILLA) },
      },
      crosshair: {
        vertLine: { color: c('text-muted'), labelBackgroundColor: c('surface-sunken') },
        horzLine: { color: c('text-muted'), labelBackgroundColor: c('surface-sunken') },
      },
      rightPriceScale: { borderColor: borde },
      timeScale: { borderColor: borde },
    })

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: c('buy'),
      downColor: c('sell'),
      wickUpColor: c('buy'),
      wickDownColor: c('sell'),
      borderVisible: false,
    })
    candles.setData(
      history.bars.map((b) => ({
        time: toTime(b.ts),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
    )

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    const volumenSube = conOpacidad(c('buy'), OPACIDAD_VOLUMEN)
    const volumenBaja = conOpacidad(c('sell'), OPACIDAD_VOLUMEN)
    volume.setData(
      history.bars
        .filter((b) => b.volume !== null)
        .map((b) => ({
          time: toTime(b.ts),
          value: b.volume as number,
          color: b.close >= b.open ? volumenSube : volumenBaja,
        })),
    )

    for (const { key, token } of SMA_STYLES) {
      const data = overlay(history.bars, history.indicators[key])
      if (data.length === 0) continue
      const line = chart.addSeries(LineSeries, {
        color: c(token),
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      line.setData(data)
    }

    // --- RSI y MACD como paneles debajo -----------------------------------
    //
    // Las dos series viajaban enteras en el payload y solo se usaba el ÚLTIMO
    // valor del RSI, como número suelto en la cabecera. Un 50 no dice nada;
    // un 50 que viene bajando desde 80 dice bastante.
    //
    // En paneles y no superpuestas al precio: sus escalas no tienen nada que
    // ver (0-100 el RSI, alrededor de cero el MACD) y meterlas en el eje del
    // precio aplastaría las velas hasta dejarlas ilegibles.
    const rsi = overlay(history.bars, history.indicators.rsi14)
    let panel = 1
    if (rsi.length > 0) {
      const serie = chart.addSeries(
        LineSeries,
        { color: c('indicador'), lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
        panel,
      )
      serie.setData(rsi)
      // Las bandas: sin ellas el RSI es una curva sin referencia.
      for (const nivel of [RSI_SOBRECOMPRA, RSI_SOBREVENTA]) {
        serie.createPriceLine({
          price: nivel,
          color: c('text-muted'),
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '',
        })
      }
      // Escala FIJA 0-100: dejarla automática hace que el eje se reajuste en
      // cada rango y un RSI de 55 parezca un extremo porque es el máximo de la
      // ventana. Con 0-100 la altura significa siempre lo mismo.
      chart.priceScale('right', panel).applyOptions({
        autoScale: false,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      })
      serie.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) })
      panel += 1
    }

    const macd = history.indicators.macd
    const macdLinea = overlay(history.bars, macd.macd)
    if (macdLinea.length > 0) {
      // El histograma primero para que quede DETRÁS de las dos líneas.
      const hist = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        panel,
      )
      hist.setData(
        overlay(history.bars, macd.histogram).map((d) => ({
          ...d,
          // Verde cuando el impulso crece y rojo cuando se agota: el signo del
          // histograma ES la señal, y un solo color la escondería.
          color: d.value >= 0 ? volumenSube : volumenBaja,
        })),
      )
      for (const [valores, token] of [
        [macd.macd, 'info'],
        [macd.signal, 'warn'],
      ] as const) {
        const linea = chart.addSeries(
          LineSeries,
          { color: c(token), lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
          panel,
        )
        linea.setData(overlay(history.bars, valores))
      }
    }

    // Las alturas, al final y DEL ÚLTIMO AL PRIMERO.
    //
    // La librería reparte el espacio quitándoselo al panel de arriba, así que
    // fijándolos en orden el MACD le robaba al RSI y lo dejaba en 27 px — una
    // franja donde la línea no se distingue. Yendo hacia atrás, cada uno le
    // quita al de arriba y el último en ceder es el precio, que es el que
    // tiene sitio de sobra.
    // Se fija PRIMERO el precio, dejándole sitio a los de abajo, y luego cada
    // subpanel. Sin encoger el precio antes, la librería reparte un resto ya
    // cerrado y el último en fijarse le roba al otro: salía 27/80 o 81/26
    // según el orden, nunca 90/90.
    // Las alturas de los subpaneles, DESPUÉS del layout.
    //
    // Dos cosas aprendidas midiendo el resultado, porque la documentación no
    // las dice y adivinarlas costaba cuatro intentos:
    //
    // 1. Con `autoSize`, el dimensionado llega por ResizeObserver —después de
    //    este efecto— y se lleva por delante cualquier altura fijada aquí. En
    //    el mismo tick, el RSI acababa en 27 px: una franja en la que la línea
    //    no se distingue. Por eso va en un timeout.
    // 2. El panel del precio NO es redimensionable: absorbe lo que sobre. Y
    //    entre subpaneles, el ÚLTIMO en fijarse consigue su valor exacto y el
    //    otro se queda con el resto. Así que esto no reparte a partes iguales
    //    —no se puede— pero sí garantiza que ninguno baje del mínimo legible.
    const t = setTimeout(() => {
      const paneles = chart.panes()
      for (let i = 1; i < paneles.length; i++) paneles[i].setHeight(ALTO_SUBGRAFICO)
    }, 0)

    chart.timeScale().fitContent()
    return () => {
      clearTimeout(t)
      chart.remove()
    }
  }, [history])

  return (
    <div>
      <div ref={containerRef} className="h-[560px] w-full" />
      <div className="mt-2 flex gap-4 text-xs text-slate-500">
        {LEYENDA_INDICADORES.map(({ token, label }) => (
          <span key={label} className="flex items-center gap-1">
            <span className="h-0.5 w-4" style={{ backgroundColor: `var(--${token})` }} />
            {label}
          </span>
        ))}
        {SMA_STYLES.map(({ key, token, label }) =>
          history.indicators[key].some((v) => v !== null) ? (
            <span key={key} className="flex items-center gap-1">
              <span className="h-0.5 w-4" style={{ backgroundColor: `var(--${token})` }} />
              {label}
            </span>
          ) : null,
        )}
      </div>
    </div>
  )
}
