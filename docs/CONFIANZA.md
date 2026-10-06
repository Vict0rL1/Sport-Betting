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
5. **El backtest de la NFL puntuaba el holdout final.** `nfl/backtest.ts` no consultaba el
   candado que el de fútbol sí respeta: 600 partidos de 2024+ entraban en sus cifras y en
   `experiments/backtest_metrics.json`. Ahora se excluyen salvo apertura registrada
   (`--unlock "motivo"`). Las cifras de la NFL pasan de 4.380 a 3.781 partidos (log loss
   0,6277 → 0,6284; el mercado sigue siendo mejor). `scripts/_baselines.ts` tampoco lo
   respeta; queda como estudio antiguo y el benchmark nuevo (`npm run benchmark:report`) sí
   lo excluye.
6. **La huella de versión dependía de la máquina.** `versions.ts` metía la ruta ABSOLUTA de
   cada fichero en el hash, así que el mismo código daba otro `model_version` en un Mac y en
   este contenedor. Ahora usa la ruta relativa al repositorio. Las predicciones ya
   registradas conservan la versión con la que se guardaron (no se reescriben); las nuevas
   llevan la huella estable, y la evaluación por versión las separa.

7. **(Encontrado después de terminar las fases) El banco se habría abstenido tras cada
   refresco de cuotas sin movimiento.** Cada refresco reescribe la hora de las cuotas aunque
   el precio no cambie; la evaluación de confianza no se volvía a guardar si nada más
   cambiaba, y el banco exige una evaluación posterior a las cuotas vigentes. Ahora una
   descarga posterior a la última evaluación obliga a guardar otra. Test en
   `trust/decision.test.ts` que fallaba con el código anterior.

## 3. Qué se construyó y con qué criterio

Todo lo nuevo vive en `server/src/` y se ve en la app en el panel **«¿Cuánto fiarse?»** de
cada partido y en la pestaña **📊 Confianza**.

| Pieza | Módulo | Criterio (a la vista, no ajustado con datos) |
| --- | --- | --- |
| Predicción final congelada y T-24h/T-6h/T-1h | `prematch/` | Instantánea cada vez que algo cambia o se cruza una marca; «a T-24h» = lo último capturado ANTES de la marca; la base rechaza capturas tras el inicio o con cuotas/datos posteriores; `prematch_final` sin UPDATE ni DELETE. |
| Cambios entre instantáneas | `prematch/snapshots.ts` | Causa solo si consta (abridor, QB, bajas, alineación, ratings, versión, mercado si la probabilidad lo incluye); si no, «Causa exacta no disponible». |
| Walk-forward por periodos | `evaluation/walkforward.ts` | Trimestres (tenis), medias temporadas (fútbol, NBA, MLB), temporadas (NFL); recalibración Platt/potencia ajustada solo con el pasado; ROI contra el cierre histórico; CLV histórico = null. |
| Baselines | idem | Elo básico de manual, «gana el local», ranking ATP (pendiente con el pasado), FiveThirtyEight (NBA), mercado de cierre. |
| Calidad de datos | `trust/dataQuality.ts`, `trust/adapters.ts` | Puntos por elemento; DESCONOCIDO no cuenta (la app no tiene esa fuente) pero se enseña. |
| Incertidumbre | `trust/perturbation.ts` | ±1σ de ruido de rating (banda de fiabilidad existente) ⊕ sesgo histórico del tramo; ~68 %, no IC del 95 %. |
| Estabilidad | idem | P10–P90 de 2.000 simulaciones moviendo cada factor (salvo el rating) en su rango plausible: < 4 pp ALTA, < 8 pp MEDIA. |
| Sensibilidad | idem | Shapley sobre la curva; exacta en tenis y NBA, aproximación local etiquetada en fútbol, MLB y NFL. |
| Desacuerdo | idem | Rango entre componentes reales: < 5 pp BAJO, < 10 pp MEDIO. |
| OOD y régimen | `trust/adapters.ts` | Reglas por deporte (pocos partidos, recién ascendido, abridor sin aperturas, QB con < 3 salidas, inicio de temporada, playoffs). |
| Abstención | `trust/decision.ts` | Ventaja ≥ mínima de la política, que sobreviva a la incertidumbre y a más de la mitad de las simulaciones; datos ≥ 60; sin OOD grave; estabilidad no BAJA; mercado no BAJO; precio < 6 h; predicción registrada no desfasada. Las señales leves solo recortan. Falla cerrada en el banco. |
| Confianza | idem | Por señales (calibración del tramo, incertidumbre, datos, estabilidad, desacuerdo, OOD, mercado), no por la probabilidad. |
| Trust Score | — | **No se agrega en un número**: los pesos no están medidos. Componentes por separado. |
| Contrafactual | idem | Calculado con las mismas reglas: cuota mínima, probabilidad mínima, incertidumbre máxima… |
| Calidad de la selección y cobertura | `trust/evaluation.ts` | Apostables contra abstenidas, y 100/75/50/25 % por confianza. Solo se mide; nada ajusta un umbral. |
| Avisos de muestra | `evaluation/sample.ts` | Apuestas 30/300, predicciones 100/500. Aviso, no prueba. |
| Shadow models | `shadow/` | Componentes reales y el ensemble registrado, guardados en el mismo instante que el campeón; nunca apuestan. `npm run shadow:report`. |
| Ensembles | `shadow/ensemble.ts` | Media ponderada, stacking, mezcla calibrada; walk-forward; registrados con pesos, ventana, validación y versión; también como experimento. |
| Mercado | `trust/market.ts`, `odds/edgeAnalysis.ts` | Calidad (proxy, no liquidez), dispersión, mejor/mediana/peor línea, duración del edge, slippage. |
| Riesgo de cartera | `staking/risk.ts` | Grupos por evento y por participante; topes 10 % total, 2 % evento, 3 % equipo/jugador; solo recortan. |
| Alertas | `alerts/` | Desde hechos guardados; sin repetir en 6 h. |
| Auditoría | `audit/` | Línea temporal de filas guardadas; `npm run reproduce -- <id>` sin recalcular. |
| Evolución de modelos | `scripts/modelHistory.ts` | Versiones reconstruidas de git con la misma huella que la app. |
| Informes | `scripts/modelReport.ts`, `scripts/benchmark.ts` | Estado por reglas escritas; benchmark con todos los periodos. |

## 4. Estado de las 40 fases

✅ hecho · 🟡 hecho en parte (se dice qué falta) · ⛔ no se puede con los datos actuales

| # | Fase | Estado |
| --- | --- | --- |
| 1 | Abstención | ✅ `trust/decision.ts`, integrada en el banco; abstenciones registradas |
| 2 | Uncertainty score | ✅ con su significado escrito (no IC del 95 %) |
| 3 | Estabilidad | ✅ rangos por factor justificados en `trust/adapters.ts` |
| 4 | Data quality score | ✅ con DESCONOCIDO honesto |
| 5 | Walk-forward real | ✅ cinco deportes; 🟡 los parámetros globales del modelo no se re-ajustan por periodo (sería otro modelo): se mide su efecto con la recalibración temporal |
| 6 | Baselines | ✅ |
| 7 | Shadow models | ✅ |
| 8 | Ensembles | ✅ tenis y fútbol (los únicos con componentes independientes en el histórico); 🟡 NBA, MLB y NFL no tienen componentes separables en el backtest |
| 9 | Desacuerdo | ✅ en los deportes con componentes; la NBA dice «sin componentes» |
| 10 | Contrafactuales | ✅ |
| 11 | Sensibilidad | ✅ exacta o aproximada, etiquetada |
| 12 | Snapshots pre-partido | ✅ |
| 13 | Seguimiento de cambios | ✅ |
| 14 | Duración del edge | ✅ |
| 15 | Slippage | ✅ (detección = predicción; decisión y registro coinciden en este banco) |
| 16 | Mejor línea | ✅ |
| 17 | Proxy de liquidez | ✅ llamado proxy |
| 18 | Dispersión | ✅ y recorta el importe |
| 19 | Apuestas correlacionadas | ✅ grupos por reglas |
| 20 | Riesgo de cartera | ✅ |
| 21 | Calidad de la selección | ✅ |
| 22 | Cobertura vs rendimiento | ✅ histórico (por profundidad) y en vivo (por confianza) |
| 23 | OOD | ✅ por reglas |
| 24 | Régimen | ✅ en vivo y por régimen en el histórico (≥ 300 partidos) |
| 25 | Segmentación | ✅ los segmentos pedidos con datos; 🟡 «calidad del abridor» sí, «bullpen» no (no hay datos) |
| 26 | Avisos de muestra | ✅ |
| 27 | Confianza | ✅ |
| 28 | Trust Score | 🟡 deliberadamente sin número único (ver arriba) |
| 29 | Página de confianza | ✅ 📊 Confianza |
| 30 | Reproduce | ✅ |
| 31 | Línea temporal | ✅ |
| 32 | Alertas | ✅ internas (sin SMS/correo: no hay infraestructura) |
| 33 | Predicción congelada | ✅ |
| 34 | Evolución de modelos | ✅ desde git |
| 35 | Registro de experimentos | ✅ campos nuevos; las entradas viejas no se reescriben |
| 36 | Resultados negativos | ✅ `npm run experiments` |
| 37 | Informe de salud | ✅ `npm run model:report` |
| 38 | Benchmark | ✅ `npm run benchmark:report` |
| 39 | Tests | ✅ ver el informe final |
| 40 | Validación final | ✅ ver el informe final |

Lo que **no** se puede afirmar todavía, y por qué: ninguna cifra en vivo tiene muestra (este
entorno no tiene clave de The Odds API, así que no hay cuotas reales, apuestas ni CLV); los
umbrales de abstención y estabilidad son elecciones de diseño y su valor solo se podrá
medir con partidos reales (para eso existe «¿Sirve abstenerse?»).
