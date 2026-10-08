# Revisión general: Análisis Bursátil

Estado a 8 de octubre de 2026. Rama `claude/stock-analysis-app-nt3ge9`, último commit `5e80190`.

Este documento resume todo lo construido, cómo está hecho, cómo se ve y qué conviene mejorar. Las observaciones visuales salen de **25 capturas** hechas hoy con la app real y datos ficticios (empresas ACME, HOLD, KO, CHIP y una lista diaria simulada de 502 empresas). Cuando algo solo se vio leyendo el código, se dice.

---

## 0. En diez líneas

1. App personal, en español, para decidir qué comprar, cuánto y cuándo salir. Funciona con reglas escritas, no con predicciones.
2. Backend Python (FastAPI + SQLite) y frontend React + TypeScript + Tailwind, arrancados con `./start.sh`.
3. Datos gratuitos: EDGAR (SEC), FRED, Finnhub, Twelve Data y yfinance como respaldo. Claude es opcional, solo bajo demanda.
4. 93 commits entre el 5 de agosto y el 6 de octubre. 1269 tests automáticos en verde.
5. Se construyó en tres etapas: funcionalidad (agosto–septiembre), «que falle de forma segura» (RC1, finales de septiembre) y «evolución» (octubre: replay, qué cambió, expectativas, riesgo de cartera, calidad de beneficios, coste de oportunidad).
6. El punto fuerte es la honestidad del dato: lo que falta se dice y nunca vale cero, y cada decisión se congela y se puede reconstruir.
7. **El mayor riesgo: nada se ha probado contra las APIs reales.** El entorno de desarrollo no tiene claves y la red bloquea a los proveedores.
8. Visualmente es un tema oscuro coherente y sobrio, pero tiene fallos concretos. El gráfico de precios usa colores del tema claro. No hay diseño móvil. Se mezclan formatos de número, aparecen identificadores internos en pantalla y hay muchísimo texto pequeño.
9. La navegación ha crecido por acumulación. Portafolio y Cartera se solapan, hay dos DCF distintos y cuatro maneras de rankear empresas.
10. Antes de añadir nada más, lo prioritario es validar con datos reales, corregir los fallos visuales y simplificar la navegación.

---

## 1. Qué es y qué principios sigue

Herramienta personal de análisis bursátil. No es asesoría, no predice precios y no ejecuta órdenes. El lema en la barra lateral lo resume: **«reglas, no predicciones»**.

Principios no negociables (README, «Principios de diseño», y `CLAUDE.md`):

- **Una señal es una regla, no una opinión.** El motor (`analysis/decision.py`) emite comprar, vigilar, mantener, reducir o vender con condiciones escritas y umbrales visibles.
- **Toda cifra lleva fuente y fecha.** Cada bloque tiene su insignia de fuente («finnhub · retrasado ~15 min»).
- **Sin precios objetivo.** El DCF devuelve escenarios y rangos. El código ni siquiera tiene un campo donde quepa un precio objetivo, y hay un test que lo comprueba.
- **Lo calculado y lo generado por IA van separados.** Lo de IA va en violeta, con el modelo y un aviso.
- **Ausente ≠ cero.** Un dato que falta se muestra como «—» y se cuenta aparte.
- **UNKNOWN nunca se convierte en PASS.**
- **Controles de riesgo «fail-safe».** Ante la duda, se avisa y se encoge la posición, nunca se agranda.
- **Analizar y dimensionar son dos preguntas distintas.** `decision.py` decide qué hacer; `sizing.py` decide cuánto, mirando la cartera entera.

---

## 2. Cronología

| Fechas | Qué se hizo |
|---|---|
| 14 jul | Commit inicial. El repositorio empezó como otra cosa («budget tracking app»). |
| 5–6 ago | **Fases 1–5.** Base FastAPI + React con capa de proveedores intercambiables; fundamentales, DCF, salud financiera y panel de mercado; noticias con interpretación por IA bajo demanda; ETFs con solapamiento y screener con presets; watchlist, portafolio, tesis y registro de aciertos. También: motor de señales cuantitativas con validación walk-forward, descubrimiento automático por universos, informe de analista, `start.sh` y la vista **Hoy** (S&P 500, NASDAQ y grandes canadienses). |
| 7–8 ago | Precio y minigráfico en cada fila. **Motor de decisión** (qué comprar, a qué precio, cuándo vender). Backtest de reglas. «Mejores ideas»: de ~100 candidatas a cinco. |
| 12–22 ago | Puntuación con EDGAR en vez de Finnhub (cinco veces más cuota). Panel oscuro. Cripto y recomendación de ETFs con criterios propios. Riesgo total, histéresis y bloqueo por resultados. |
| 31 ago–3 sep | Validación fuera de muestra con costes desagregados. Comparación con baselines simples. Registro de experimentos, Sharpe deflactado y holdout bloqueado. Separación del tamaño de posición (`sizing.py`) y seis bugs, entre ellos un límite por correlación que no se ejecutaba nunca. Screener multifactor (seis factores relativos al sector, con percentil histórico). Análisis de reportes trimestrales con Claude (extracción estructurada con citas verificadas). Módulo de valoración (DCF inverso, comparables ajustados). Seguimiento de tesis con puntos de invalidación. |
| 7–15 sep | Análisis de cartera (correlación, concentración real, estrés en 2008, 2020 y 2022). Señales del mercado de opciones. Logos e icono propio. Tres gráficos nuevos. Divisas (convertir antes de sumar). Recorrido de la cartera con un índice encadenado. |
| 26–27 sep | RSI y MACD dibujados bajo el precio. Alertas con la app cerrada (cron y notificación de escritorio). |
| 29–30 sep | **Auditoría RC1.** 23 fallos de la misma familia («falta un dato → se usa un valor neutro → resulta ser el favorable → se recomienda más exposición»), todos corregidos con un test. Por ejemplo, un precio NaN producía «comprar» con tamaño real, y una deuda desconocida se valoraba como cero (+95 %). Además: Alembic, restricciones de integridad, instantáneas de decisión inmutables, stop fijado al abrir, holdout bloqueado de verdad y estado del dato (válido, viejo, desconocido, error). |
| 5 oct | **Evolución:** Decision Replay, Qué cambió, Expectativas frente a resultados, Contribución al riesgo, Calidad de beneficios, Coste de oportunidad, confianza por evidencia y linaje EDGAR por partida. |
| 6 oct | **Ronda 2:** lotes agregados, stop subido sobre el coste, escala del consenso, deuda parcial, el DCF de la ficha ya no supone deuda cero, fuga del cierre del mismo día, script de validación con datos reales y `CLAUDE.md`. |

---

## 3. Cifras del proyecto

| | |
|---|---|
| Commits | 93 (29 en agosto, 39 en septiembre, 23 en octubre) |
| Backend (`backend/app`) | ~27 400 líneas de Python |
| Tests | 84 ficheros, ~18 500 líneas, **1269 tests** (~30 s) |
| Frontend (`frontend/src`) | ~13 900 líneas de TypeScript/TSX |
| Endpoints de la API | 90, en 16 routers |
| Tablas | 31 |
| Migraciones Alembic | 8 (0001–0008), ninguna destructiva |
| Proveedores de datos | 5 + Claude opcional |
| Páginas | 14; la ficha de empresa tiene 11 pestañas |
| Scripts | 5 (alertas, evaluar instantáneas, backtest, universos, validación con datos reales) |
| Documentación | README de 1923 líneas + 5 documentos en `docs/` + TODO + CLAUDE.md |

Los ficheros más grandes del frontend son `TodayPage.tsx` (1217 líneas), `PortfolioPage.tsx` (959), `SignalsPage.tsx` (808), `EarningsPage.tsx` (647) y `CarteraPage.tsx` (610).

---

## 4. Arquitectura

### Backend
```
endpoint → MarketDataService → CacheStore (SQLite, TTL por tipo de dato)
                             → DataRouter (orden de fuentes, límites, reintentos, respaldo)
                             → DataProvider (edgar | fred | finnhub | twelvedata | yfinance)
```
- **Caché primero.** Cotización 1 min, histórico 15 min, fundamentales 24 h, calendario 12 h, pares y ETFs 7 días. Si todas las fuentes fallan, se sirve la última copia marcada «vieja» con su antigüedad.
- **Frontera de validación** (`validacion.py`). Un dato corrupto (NaN, negativo) se trata como fallo del proveedor: no se cachea y se pasa a la siguiente fuente.
- **Limitador multiventana.** Por ejemplo, Twelve Data: 8 por minuto y 800 por día a la vez. El contador se ve en la barra lateral.
- **Lógica de dominio pura** en `app/analysis/` (39 módulos). Los routers solo ensamblan.
- **Punto en el tiempo** (`punto_en_el_tiempo.py`). Una sola regla para todo lo histórico, con tres respuestas: sí, no y «no se puede probar».
- **Registro inmutable.** Las instantáneas de decisión y las expectativas no se pueden modificar (eventos del ORM, triggers de SQLite y huella SHA-256).
- **Capa LLM opcional** (`app/llm/`). Sin clave, la app funciona igual y los botones de IA lo dicen.

### Frontend
- React 19 + Vite 8 + TypeScript estricto + Tailwind 4, y `lightweight-charts` 5 para los precios.
- Cliente API tipado (`api/client.ts` y `api/types.ts`).
- Las pestañas cargan sus datos solo al abrirse, para no gastar llamadas.
- No hay tests de frontend; solo comprobación de tipos y build.

### Datos y coste
EDGAR es la fuente prioritaria, gratis y sin clave: ratios, crecimiento, DCF, Altman Z, Piotroski F y la puntuación diaria. Puntuar las 502 empresas del S&P 500 cuesta cero llamadas de Finnhub.

---

## 5. Pantallas y funcionalidades

La barra lateral tiene tres grupos.

### Principal
- **Hoy.** La lista diaria. Cinco tarjetas de recuento (ideas de compra, para vender, en vigilancia, en cartera, cobertura). Selector de mercado (Cripto, S&P 500, NASDAQ, Canadá), filtros (mejores ideas, todas las que califican, vigilar, mi cartera, todas), buscador y chips por sector. Debajo: «Cómo se repartió el tamaño», «Lo que NO comprar ahora» y la advertencia de que las reglas no están validadas. Cada fila lleva precio, variación, minigráfico, decisión con su «¿Por qué?» y «¿Qué la cambiaría?».
- **Mercado.** Índices (SPY, QQQ, DIA, IWM, XIU, VIX), sectores con ETFs SPDR como aproximación, curva de rendimientos de EE. UU., macro de FRED y próximos resultados.
- **Acciones (ficha de empresa).** Buscador, cabecera con logo o monograma, nombre, precio, variación y fuente. 11 pestañas:
  1. *Resumen*: gráfico de velas con volumen, SMA 20/50/200, RSI 14 y MACD en subpaneles; rangos de 1M a 10A; fundamentales básicos.
  2. *Informe completo*: lectura conjunta («postura constructiva»), qué rompería esa lectura, negocio, crecimiento, márgenes, deuda, flujo de caja, valoración frente a su propia historia, DCF precargado, riesgos y catalizadores.
  3. *Fundamentales*: series de EDGAR.
  4. *Valoración*: DCF por escenarios editable.
  5. *Opciones*: señales del mercado de opciones, sin puntuación única.
  6. *Salud y riesgo*: Altman Z, Piotroski F, cobertura, deuda neta, beta, volatilidad y drawdown.
  7. *Filings*: documentos de la SEC con enlace.
  8. *Qué cambió*: decisión del motor con confianza, «¿Por qué?» y «¿Qué la cambiaría?», cambios materiales desde el último análisis, riesgo dentro de tu cartera y coste de oportunidad.
  9. *Resultados vs expectativas*: eventos, expectativas por fuente, lectura, impacto en la tesis y calibración.
  10. *Calidad de beneficios*: nueve reglas (BUENO, AVISO, DESCONOCIDO) y su evolución por ejercicio y trimestre.
  11. *Decisiones y replay*: instantáneas congeladas, cada una con su botón Replay.

### Herramientas
- **Screener**: filtros con presets documentados, hasta 25 tickers.
- **Multifactor**: seis factores relativos al sector, con percentil histórico.
- **Resultados**: análisis de reportes trimestrales con Claude (extracción con citas verificadas y aritmética en Python).
- **Valoración**: módulo completo (DCF por escenarios, DCF inverso, comparables ajustados y sensibilidad).
- **Señales**: modelo de factores con universos curados y validación (backtest, baselines, experimentos, holdout).
- **ETFs**: composición, solapamiento y recomendación con criterios propios.
- **Noticias**: listado con interpretación por IA bajo demanda.

### Mío
- **Portafolio**: añadir posiciones; tarjetas de invertido, valor, no realizado y realizado; recorrido de la cartera con la línea de lo invertido; riesgo abierto frente al tope; concentración; tabla de posiciones con minigráfico de un año y botones «Fijar stop» y «Cerrar»; exposición por sector. También watchlist y alertas.
- **Cartera**: contribución al riesgo de cada posición (Euler), clústeres de riesgo, coste de oportunidad con efectivo anotado, concentración real (apuestas independientes), matriz de correlación, exposición por sector y geografía, dentro de los ETFs, características de factor y estrés en 2008, 2020 y 2022.
- **Tesis**: crear tesis con escenarios y su registro de aciertos.
- **Vigilancia**: puntos de invalidación vigilados, posiciones sin tesis y diario de decisiones.

---

## 6. El motor: decidir, dimensionar, comparar

- **Puntuación**: comparación con los comparables del mismo sector. Favorable a partir de +0,35 y desfavorable por debajo de −0,35. Un sector con menos de 3 empresas puntuables se descarta.
- **Decisión** (`decide()`): lista de reglas con prioridad; la primera que se cumple decide. Sin posición: comprar (puntuación favorable y precio sobre la media de 200 sesiones + 2 %), vigilar, evitar o ninguna. Con posición: vender (puntuación desfavorable o stop perforado), reducir (tendencia perdida) o mantener. Los resultados próximos aplazan una compra. La traza (`reglas`) y las alternativas con su distancia (`cambiaria`) son la explicación que se ve en pantalla.
- **Stop**: se fija al abrir y no se recalcula. Se puede subir, nunca bajar. Desde la Ronda 2, un stop por encima del coste también manda.
- **Tamaño** (`sizing.py`): 1 % del capital en riesgo por operación, máximo 10 % por posición y 25 % por sector, límites por correlación y volatilidad de cartera. Con evidencia BAJA, la mitad del peso. Cada límite dice si se aplicó.
- **Confianza por evidencia**: 10 factores (completitud, frescura, contraste de proveedores, histórico, sensibilidad, distancia a umbrales…). Algún factor crítico da BAJA; tres o más débiles, BAJA; uno o dos, MEDIA; ninguno, ALTA.
- **Coste de oportunidad**: cinco veredictos (NO_ACCION, COMPRAR_CON_EFECTIVO, REVISAR_PARA_FINANCIAR, NO_TRADE, INDETERMINADO). Exige una mejora mínima de 3 puntos más uno por cada 1 % de coste del cambio. Lo comprado hace menos de 30 días no se propone.

---

## 7. Fiabilidad del dato y protección contra la anticipación

- Cuatro estados de dato: válido, viejo, desconocido, error.
- Las instantáneas son inmutables y reproducibles: el replay solo enseña lo que se sabía entonces y retira lo fechado después.
- Regla común `información_disponible ≤ momento_de_la_decisión`. Un dato fechado por día no cuenta el mismo día de una decisión con hora, salvo prueba de descarga.
- Holdout fijo y bloqueado, registro de experimentos y Sharpe deflactado contra el sobreajuste.
- Expectativas registradas antes del evento. Lo registrado después, o el mismo día, no cuenta.
- Script `validar_con_datos_reales.py`: comprobaciones cruzadas PASS, FAIL o UNKNOWN para correr con tus claves.

---

## 8. Diseño visual y estético

### 8.1 Tema y color
- **Solo tema oscuro**; no hay modo claro ni selector. Está hecho «por inversión de paleta»: la app se escribió en claro (`bg-white`, escala `slate`) y en `index.css` se redefinen los colores, de modo que `bg-white` es azul marino y `slate-900` es el texto más claro.
- **Superficies**: fondo de página `#080c18` (casi negro azulado), tarjetas `#111a2e`, superficie hundida `#1b2540`, bordes `#26314f`.
- **Texto**: rótulos `#7c8aa8`, secundario `#b6c2da`, titulares y cifras `#f4f7fd`.
- **Acentos semánticos**:
  - verde esmeralda (`#4ade9c`/`#6ee7b7`): comprar, bueno, ganancias;
  - rojo (`#f2555f`/`#fb7185`): vender, aviso, pérdidas;
  - ámbar (`#fcd34d` sobre `#2b1f06`): vigilar, desconocido, advertencias;
  - azul cielo (`#38bdf8`, `#56b6f5`): información, enlaces, fuente del dato;
  - violeta: contenido generado por IA.
- **Icono**: línea quebrada ascendente azul cielo `#38bdf8` con un punto final, sobre un cuadrado oscuro redondeado. El mismo dibujo sirve de favicon y de logo.
- Los controles del navegador (scrollbars, selects) también salen en oscuro (`color-scheme: dark`).

### 8.2 Tipografía
- **Fuente del sistema** (pila por defecto de Tailwind): San Francisco en Mac, Segoe en Windows. No hay fuente propia.
- Títulos de página de 18–20 px semibold, con dos tamaños mezclados (`text-lg` en 11 páginas, `text-xl` en 3). Títulos de tarjeta de 14 px semibold, en dos tonos de gris distintos según la página.
- Cifras grandes en KPIs (24–30 px, negrita) con números tabulares, para que las columnas alineen.
- **Mucho texto muy pequeño**: 139 usos de 10 px, 105 de 11 px y 3 de 9 px. Rótulos en mayúsculas con espaciado ancho («IDEAS DE COMPRA», «TOP 3 POR RIESGO»).

### 8.3 Composición
- **Barra lateral fija de 224 px**: logo y lema arriba; navegación en tres grupos (sin título, «Herramientas» y «Mío»); abajo, chips de uso de APIs (tachados cuando falta la clave) y el aviso legal.
- Contenido con márgenes de 24 px. Tarjetas con borde fino y esquinas redondeadas: 12 px para tarjetas (`rounded-xl`, 115 usos), 8 px para cajas internas (`rounded-lg`, 128 usos).
- Rejillas de KPIs de 4–5 columnas, tablas densas a todo el ancho y barras horizontales para exposiciones.
- Pestañas subrayadas (la activa en blanco con línea inferior) y selectores tipo «píldora» (la opción activa en relleno claro).

### 8.4 Componentes recurrentes
- **Insignia de fuente**: punto azul más proveedor y frescura («finnhub · retrasado ~15 min», «edgar», «yfinance»).
- **Chips de estado**: BUENO verde, AVISO rojo, DESCONOCIDO ámbar, «dato perdido», «dato nuevo» y confianza BAJA en rojo.
- **Cajas de aviso**: fondo ámbar oscuro con texto ámbar claro. Muy usadas.
- **Bloques desplegables**: «¿Por qué esta decisión?» y «¿Qué la cambiaría?», con la regla, su resultado (✗ no cumple, ✓ cumple) y su papel (decide, bloquea, a favor).
- **Gráficos**:
  - velas con volumen y medias de colores (SMA 20 azul, 50 ámbar, 200 violeta);
  - RSI en escala fija 0–100 con bandas 70/30;
  - MACD con histograma verde o rojo;
  - minigráficos de un año en verde o rojo;
  - curva de valor de la cartera con lo invertido en línea discontinua;
  - matriz de correlación con celdas coloreadas.
- **Monogramas**: cuando no hay logo, un cuadrado con las iniciales en un color derivado del símbolo («AC» en rojo oscuro).
- **Tono de los textos**: explicativo y muy honesto. Cada bloque dice qué no es («no es una predicción», «no vale cero», «descriptivo, no estimado por regresión»). Es muy característico, pero hay mucha lectura por pantalla.

### 8.5 Valoración estética
**Funciona bien:**
- Sobriedad, jerarquía de superficies clara, color usado con significado y no como decoración.
- Las cifras dominan y la fuente del dato siempre está a la vista.
- Los estados (bueno, aviso, desconocido) se leen de un vistazo.

**Lo débil:**
- Densidad excesiva de texto pequeño y gris.
- Avisos ámbar repetidos que compiten entre sí.
- Tablas que ocupan todo el ancho con columnas muy separadas.
- Inconsistencias entre páginas (tamaños de título, colores de barras, formatos de número).

---

## 9. Problemas visuales encontrados hoy

| # | Problema | Dónde | Gravedad |
|---|---|---|---|
| V1 | **El gráfico de precios usa colores del tema claro.** Rejilla `#f1f5f9`, bordes `#e2e8f0` y volumen `#a7f3d0`/`#fecaca` están fijos en el código. El lienzo del gráfico no hereda la inversión de paleta, así que la rejilla sale casi blanca y el volumen es un bloque verde menta enorme. | `PriceChart.tsx:49-89` (captura 03) | Alta |
| V2 | **No hay diseño móvil.** A 390 px la barra lateral ocupa el 57 % del ancho, el texto se parte palabra a palabra y el contenido se desborda. | `Layout.tsx` (captura 24) | Alta, si la usarás en el móvil |
| V3 | **«undefined %»** en «Cómo se repartió el tamaño» cuando no hay candidatas. | `TodayPage.tsx:505` (captura 01) | Media |
| V4 | **Decimales mezclados**: «31.2 %», «18.9 %», «10.0 % anual», «EPS estimado 1.12» y «0.210» (textos del backend) junto a «45,5 %» (frontend). | Portafolio, Informe, Vigilancia | Media |
| V5 | **Miles inconsistentes**: «6000,00» junto a «20.000,00» en la misma columna (la regla es-ES no agrupa números de 4 cifras). | Portafolio (captura 14) | Baja |
| V6 | **Identificadores internos en pantalla**: «sin_datos», «comprar → sin_datos», «analisis:03:09:37», «sin_resolver:», «eps_diluted, gross_margin…», «Mejor prevista: revenue», chips «correlacion» sin tilde. | Qué cambió, Expectativas, Replay, Cartera | Media |
| V7 | **Gramática y plurales**: «que haya puntuación válido», «el umbral era cae por debajo de 0.180», «Ninguno de los 1 puntos», «posición(es)». | Qué cambió, Vigilancia, Hoy | Baja |
| V8 | **«-0 %»** (cero negativo). | Calidad de beneficios (captura 10) | Baja |
| V9 | **Etiquetas de IA**: `bg-violet-50` no está invertido, así que es un parche casi blanco en el tema oscuro. Visto en el código; no sale en las capturas porque la IA estaba apagada. | NewsPage, QueCambioSection, ApiUsageBar | Media |
| V10 | **11 pestañas** en la ficha que se parten en dos filas a 1440 px. | Ficha | Baja |
| V11 | **Contradicción**: «Deuda y solidez: Sin datos de endeudamiento» mientras enseña «Deuda neta 500 M». | Informe completo (captura 04) | Media |
| V12 | **La misma tesis** sale «invalidada» en Qué cambió (lee el trimestre) y «no cruzado» en Vigilancia (lee el ejercicio). Está documentado como intencional, pero confunde. | Qué cambió y Vigilancia | Media |
| V13 | **Mensajes obsoletos**: Hoy dice «Revisa que FINNHUB_API_KEY…» aunque ya se puntúa con EDGAR, y el README dice «sin Alembic por ahora». | Hoy, README | Baja |
| V14 | **Fatiga de avisos**: «Riesgo abierto» apila 4 cajas ámbar casi iguales y casi todas las tarjetas llevan su nota al pie. | Portafolio (captura 14) | Media |
| V15 | **Mismo concepto, distinto color**: las barras de exposición por sector son grises en Cartera y azules en Portafolio. | Cartera y Portafolio | Baja |
| V16 | **Espacio mal aprovechado**: matriz de correlación diminuta en una tarjeta de ancho completo y tablas con columnas muy separadas. | Cartera, Expectativas | Baja |
| V17 | Logo de TradingView sobre el gráfico (atribución de lightweight-charts). Revisar la licencia antes de quitarlo o moverlo. | Ficha | Cosmética |
| V18 | «Ingresos 5A: 10 %» con «Años de histórico: 3»: la etiqueta promete 5 años. | Informe completo | Baja |

---

## 10. Problemas de producto y de navegación

1. **Portafolio y Cartera se solapan.** Las dos tienen exposición por sector, concentración y riesgo. Lo natural sería una sola sección «Cartera» con subpestañas: Posiciones, Riesgo y Oportunidad.
2. **Dos DCF distintos.** La pestaña Valoración de la ficha usa `/api/stocks/{s}/valuation/dcf` y la página Valoración usa `/api/valuation/{s}`, con supuestos y presentación diferentes. Dos verdades para la misma pregunta.
3. **Cuatro maneras de rankear empresas**: Hoy, Señales, Multifactor y Screener. Para un usuario, ¿cuál manda? Convendría que Hoy fuera la única lista y las otras, herramientas de investigación claramente subordinadas.
4. **Tesis y Vigilancia separadas.** Escribir la tesis y vigilarla son la misma tarea.
5. **Faltan acciones básicas**: editar una tesis (hoy solo se crea y se borra), varias watchlists y exportar cartera y tesis a CSV.
6. **Qué cambió** vive dentro de la ficha. Una vista global, «qué cambió en mis posiciones desde ayer», sería más útil a diario.
7. **Carga cognitiva**: la app explica mucho y bien, pero cada pantalla exige leer. Un modo «resumen» con la explicación desplegable al pedirla ayudaría.

---

## 11. Riesgos técnicos y deuda

1. **Sin validar contra datos reales.** Es el riesgo número uno. Todos los números de las capturas son ficticios. Hay que correr el script de validación y contrastar 2–3 empresas con tu broker.
2. **Tema por inversión de paleta.** Es frágil: los nombres de color mienten (`text-white` es azul marino), no alcanza al lienzo de los gráficos (V1) y es fácil equivocarse en componentes nuevos (V9). A medio plazo conviene pasar a tokens semánticos (`--surface`, `--text-strong`, `--accent-buy`…).
3. **Ficheros muy grandes**: `TodayPage.tsx` (1217 líneas) y el router `signals.py`. Son difíciles de mantener.
4. **Sin integración continua** (no hay `.github/workflows`) **y sin tests de frontend.** Los fallos V3 y V6 no los habría detectado ningún test existente.
5. **Modelo de Claude configurado: `claude-opus-5`.** Comprueba que el identificador existe. Los actuales son, por ejemplo, `claude-opus-5-5` y `claude-sonnet-5-5`; si el identificador no existe, la capa de IA fallaría con su mensaje de error.
6. **Limitaciones de dato conocidas** (TODO.md):
   - yfinance no es oficial;
   - ETFs con solo ~10 posiciones conocidas;
   - EDGAR solo cubre empresas registradas en la SEC;
   - beta siempre contra SPY;
   - ROIC con impuesto fijo del 21 %;
   - múltiplos históricos anuales, no TTM;
   - sesgo de supervivencia en los backtests;
   - factor de sentimiento sin validar;
   - muestras pequeñas.
7. **README de 1923 líneas.** Contiene mucha historia de bugs; el arranque y el uso diario se pierden ahí. Convendría separar una guía de uso corta.

---

## 12. Mejoras recomendadas, por prioridad

### P1: antes de confiar en la app
1. Correr `scripts/validar_con_datos_reales.py` con tus claves y revisar cada FAIL y cada UNKNOWN.
2. Contrastar precio, P/E, márgenes y deuda neta de 2–3 empresas con tu broker y con su último 10-K.
3. Corregir V1: colores del gráfico con tokens oscuros.
4. Corregir V3: «undefined %».
5. Corregir V11: contradicción en Deuda y solidez.
6. Corregir V9: etiquetas de IA.
7. Unificar el formato de números (V4, V5): toda cifra en texto del backend formateada en es-ES, o mandar el número y que lo formatee el frontend.
8. Traducir los identificadores internos (V6) y corregir la gramática (V7, V8).
9. Verificar el identificador del modelo de Claude.

### P2: claridad y uso diario
1. Fusionar Portafolio y Cartera, y Tesis y Vigilancia.
2. Un solo DCF: la página Valoración, con la pestaña de la ficha enlazándola.
3. Diseño responsive: barra lateral plegable o menú inferior en móvil, tablas con desplazamiento horizontal y KPIs en dos columnas.
4. Reducir la fatiga de avisos: agrupar los de una tarjeta en uno solo con el detalle desplegable.
5. Subir el tamaño mínimo de texto a 12 px y unificar títulos (`text-lg` para h1, un solo color para h2).
6. Vista global «Qué cambió en mis posiciones».
7. Editar tesis, varias watchlists y exportar a CSV.

### P3: calidad a medio plazo
1. Tokens semánticos de color en lugar de la paleta invertida, y opcionalmente un modo claro.
2. Integración continua (pytest, tsc y build) y unos pocos tests de componentes del frontend.
3. Partir `TodayPage.tsx` y `signals.py` en piezas.
4. Separar el README en guía de uso, arquitectura e historia.
5. Fuente con números tabulares de buena calidad (por ejemplo, Inter) para más consistencia entre sistemas.

---

## 13. Pendiente de verificación manual

- [ ] Script de validación con claves reales.
- [ ] Trimestres de EDGAR contra un 10-Q real (CFO del 2.º y 3.er trimestre derivado, 4.º = año − nueve meses).
- [ ] Unidades del consenso de Finnhub.
- [ ] Tipo de cambio: 1 USD ≈ 1,3–1,4 CAD, no ≈ 0,7.
- [ ] Un análisis completo de una empresa real y su replay al día siguiente.
- [ ] Copia de `app.db` antes de arrancar con las migraciones 0007 y 0008.
- [ ] Anotar el efectivo en Cartera (sin él, el coste de oportunidad dice INDETERMINADO).
- [ ] Notificación de escritorio de las alertas en una máquina con escritorio.

---

## Anexo: capturas

En `docs/revision/`, todas con datos ficticios, tema oscuro, 1440 px de ancho (las móviles a 390 px):

01 Hoy · 02 Mercado · 03 Ficha – Resumen · 04 Informe completo · 05 Fundamentales · 06 Valoración (ficha) · 07 Salud y riesgo · 08 Qué cambió · 09 Resultados vs expectativas · 10 Calidad de beneficios · 11 Decisiones y replay · 12 Opciones · 13 Cartera · 14 Portafolio · 15 Tesis · 16 Vigilancia · 17 Valoración (módulo) · 18 Screener · 19 Multifactor · 20 Resultados · 21 Señales · 22 ETFs · 23 Noticias · 24 Móvil – Hoy · 25 Móvil – Ficha.

Las pantallas que dependen de proveedores que el servidor de demostración no simula (Mercado, Screener, ETFs, Noticias, Resultados) salen vacías o con su mensaje de «sin datos». Eso es efecto de la demo, no de la app.
