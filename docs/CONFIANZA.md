# ¿Cuándo confiar en el modelo? — auditoría y diseño de la fase de confianza

Este documento recoge, en este orden: lo que ya existía antes de empezar la fase (para no
rehacerlo), los fallos reales encontrados durante la auditoría y, al final, el estado de cada
una de las 40 fases pedidas. Las cifras citadas se midieron, no se supusieron.

## 1. Lo que ya existía (auditoría, 2026-10-05)

Línea base antes de tocar nada: `npm test` 107 tests, 0 fallos; `npm run verify:data` 459
comprobaciones correctas; `npm run doctor -- --sin-red` sin clave de API en este entorno (es lo
esperado: el contenedor no tiene acceso a The Odds API).

| Pieza pedida | Qué había | Dónde |
| --- | --- | --- |
| Incertidumbre | Banda de fiabilidad ±pp en los cinco deportes: ruido del rating (σ ≈ C/√(n+1), con antigüedad) propagado en primer orden por la pendiente de la curva Elo. Nivel alta/media/baja y motivos. El backtest del tenis comprueba que el nivel «bajo» acierta menos. | `model/reliability.ts`, `reliability` en cada `predict.ts` |
| Descomposición | Factores en puntos Elo a favor del local/jugador 1 en los cinco deportes (rating, campo, forma, H2H, inactividad, bajas, abridores, QB, descanso). | `reasoning.factors` en cada `predict.ts` |
| Datos por deporte | Tenis: forma, superficie, H2H, retiradas e inactividad. Fútbol: bajas aplicadas y dudas, alineación confirmada contra la esperada, rotación, recién ascendidos. NBA: descanso y back-to-back, `is_playoff`. MLB: abridor probable con sus aperturas y factor de estadio. NFL: QB supuesto («el último que jugó»), techo; sin previsión del tiempo. | `predict.ts`, `football/lineups.ts`, `news/` |
| Mercado fino | Número de casas por mercado y exigencia mayor cuando hay pocas. | `markets/liquidity.ts` |
| Mezcla con el mercado | «Logarithmic opinion pool» con encogimiento cuando discrepan mucho (fútbol y NFL). | `postprocess/blend.ts` |
| Correlación | Medida: entre partidos de la misma liga y jornada ρ ≈ 0; entre mercados del mismo partido, alta (over/ambos marcan ρ = 0,56). | `staking/correlation.ts` |
| Riesgo de cartera | Kelly de cartera (Markowitz), topes por evento, día, liga y total; límites de pérdida diaria y semanal; drawdown simulado. | `staking/` |
| Baselines | Tabla contra cierre, solo-campo y Elo simple (NFL), ranking en tenis. | `scripts/_baselines.ts`, `scripts/backtest.ts` |
| Holdout | Candado para fútbol (2026+) y NFL (2024+), con registro de cada apertura. Tenis, NBA y MLB **no tienen** holdout final. | `experiments/holdout.ts` |
| Experimentos | Registro JSONL versionado (78 entradas: 49 `shipped`, 10 `rejected`, 19 `inconclusive`), con corrección por comparaciones múltiples. | `experiments/registry.ts` |
| Snapshots de cuotas | Cada cambio de precio por casa, append-only; apertura, señal, cierre y CLV. | `odds/` |
| Banco de papel | Append-only con triggers, versiones, señales apostadas o no, validación con intervalos. | `paper/`, `evaluation/` |
| Alertas | Solo de latencia (SSE a la pantalla). No había un sistema general de eventos. | `latency/alert.ts` |

Lo que **no** existía: predicción final pre-partido congelada, instantáneas T-24h/T-6h/T-1h,
puntuación de calidad de datos, estabilidad por perturbación, desacuerdo entre componentes,
capa de abstención, contrafactuales, walk-forward por periodos con recalibración temporal,
shadow models, ensembles con pesos registrados, detección OOD y de régimen, análisis de
línea por casa (mejor/mediana/peor), duración del edge, slippage, alertas generales, comando
de reproducción, línea temporal de auditoría, página de transparencia e informes automáticos.

## 2. Fallos reales encontrados

1. **El banco de papel guardaba una probabilidad de mercado de otro momento.** En
   `paper/bankroll.ts`, `market_probability_no_vig` (y `p_market`) venían del registro de
   predicciones —el mercado cuando el modelo hizo su primera predicción, a veces días antes—,
   mientras que `market_probability_raw` y la cuota eran los del momento de apostar. Dos
   columnas de la misma fila describían mercados distintos, y el orden de las candidatas se
   hacía con la vieja.
2. **`shipped` en el registro de experimentos es ambiguo.** En las ablaciones («quitar X
   mejora el log loss», delta positivo = peor) `shipped` significa que se queda la
   configuración publicada, es decir, que el cambio propuesto se **rechazó**. Leído tal cual
   parece lo contrario.
3. **Lo que se apuesta es la primera predicción servida, aunque tenga días.** No es un error
   de cálculo —es la probabilidad que se enseñó—, pero nada comprobaba si el modelo seguía
   diciendo lo mismo al apostar. Lo trata la capa de abstención (ver abajo), no un cambio de
   estrategia.
4. **Las constantes globales de los backtests se ajustaron con todo el histórico** (escala de
   calibración del tenis, `SPREAD_WIN_LOGIT` de la NFL, ventajas de campo). Las
   predicciones del backtest usan solo partidos anteriores para los ratings, pero esos
   parámetros vieron el futuro. El walk-forward por periodos de esta fase lo hace visible
   recalibrando solo con el pasado.
