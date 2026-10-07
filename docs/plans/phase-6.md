# Fase 6 — Funciones de producto

Seis funciones encima de lo que ya hay. Ninguna toca una probabilidad publicada, un parámetro
del modelo ni una fila de las tablas inmutables (`paper_bets`, los cinco `*_prediction_log`,
`odds_snapshots`): leen de ellas y escriben en tablas propias. Cada una va detrás de un
interruptor de `config/features.json` (encendido por defecto), con API y pantalla, un test, una
comprobación del doctor donde deja estado y un párrafo en `docs/PRODUCTO.md`.

Tres lotes, un commit cada uno:

## 6A Laboratorio de estrategias (`estrategias.laboratorio`, `estrategias.historico`)

1. **Bancos de papel con nombre.** Tabla `strategies` (libro mayor): nombre, configuración
   (deportes, mercados, ventaja mínima, fracción de Kelly, topes por evento y total, límites de
   pérdida, si respeta la capa de confianza), hash, nota, `archived_at`. Una estrategia **no se
   edita**: cambiarla es crear otra, igual que una versión de la política (el registro de una
   estrategia que cambia a mitad deja de medir nada). Se archiva una vez y deja de apostar.
2. **Apuestas por estrategia.** Tabla `strategy_bets` (libro mayor) con los mismos tres momentos
   y los mismos triggers que `paper_bets`: lo de apostar congelado desde el INSERT, el cierre una
   vez, la liquidación una vez, sin borrado. Banco inicial 1.000 por estrategia.
3. **Mismas señales, en paralelo.** `paper/bankroll.ts` exporta la lista de candidatas (las
   mismas filas del registro de predicciones con cuotas reales, nunca las de demostración) y la
   regla de liquidación; cada estrategia las pasa por `decideEvent` con SU configuración, su
   banco, su exposición y sus pérdidas. `decideStake` admite unas pérdidas explícitas para que
   cada banco mire las suyas (hoy el corte por pérdida lee el registro personal).
4. **Comparación.** CLV medio, ROI, drawdown máximo, acierto, apuestas y pendientes por
   estrategia, con el banco principal como fila de referencia. Con menos de 30 apuestas
   liquidadas la fila dice «muestra insuficiente» y no se ordena ni se declara ganadora.
5. **«¿Qué habría pasado?»** Los backtests de tenis, fútbol y NFL guardan, al correr, los partidos
   con cuota histórica fuera del holdout (`experiments/estrategias/<deporte>.json`: fecha,
   probabilidades del modelo y cuotas). La estrategia se reproduce en orden sobre ellos con el
   mismo `decideEvent` y devuelve curva de banco, ROI, drawdown y acierto. Con solo cuota de
   cierre el CLV es cero por construcción y se dice DESCONOCIDO; en fútbol, con Pinnacle temprano
   y de cierre, se apuesta al temprano y el CLV se mide. El holdout (fútbol 2026+, NFL 2024+) no
   entra: el fichero se escribe ya sin él y la lectura lo vuelve a filtrar.

## 6B Bandeja, resumen diario e informe semanal (`alertas.bandeja`, `informes.diario`, `informes.semanal`, `informes.pdf`)

6. **Bandeja.** Tabla `inbox` (libro mayor, con estado leída/no leída): cada notificación de
   `notificar()` y cada alerta de `emitirAlerta()` deja una fila con enlace al partido o al
   informe, aunque no haya ningún canal configurado. Filtros por tipo, deporte y leída; marcar
   una, varias o todas. Campana con el número de no leídas en la barra lateral y la cabecera.
7. **Resumen diario** (trabajo `resumen-diario`, cada hora; genera una vez al día a partir de las
   7:00 de `APP_TIMEZONE`): partidos de hoy por confianza, resultados y aciertos de ayer por
   deporte, estado del banco de papel y de cada estrategia, alertas de las últimas 24 h. Se guarda
   en `reports` (libro mayor, append-only, uno por día), se enseña en `/informes/:id` y sale por
   los canales como `digest_listo`.
8. **Informe semanal** (trabajo `informe-semanal`, el lunes): salud del modelo por deporte
   (ventana de monitorización, PSI, deriva), CLV de la semana, banco, alertas de deriva, frescura
   de datos y experimentos aceptados o rechazados del registro. Markdown en la página y PDF
   opcional generado en el servidor sin dependencias (texto, Helvetica, WinAnsi).
9. **Archivo** `/informes`: lista con filtro diario/semanal; cada informe es inmutable.

## 6C Comparador de líneas y archivo de predicciones (`mercado.lineas`, `archivo.predicciones`)

10. **Líneas** (`/apuestas/lineas`): para cada mercado abierto, la mejor cuota por selección y en
    qué casa, la peor, el consenso (mediana), la dispersión entre casas en pp de probabilidad
    implícita, el margen con las mejores cuotas y si hay surebet. Solo lectura. **Nota:** la hoja
    de ruta dice que el banco de papel ya apuesta a la mejor línea; el código apuesta al
    **consenso** (mediana de casas, ver `paper/bankroll.ts`). Esta fase no lo cambia —sería un
    cambio de política— y la pantalla dice lo que hace de verdad.
11. **Archivo de predicciones** (`/confianza/archivo`): todo lo que dijo el modelo, de los cinco
    registros, con el resultado, la confianza de la última evaluación antes del inicio, el CLV de
    la señal y la versión de política. Búsqueda por texto y filtros por deporte, liga, banda de
    confianza, resultado y fechas; paginado.

## Fuera de esta fase

- Cambiar el precio al que apuesta el banco principal (consenso → mejor línea): es política.
- Mercados distintos de `h2h` en las estrategias: el banco de papel solo apuesta ganador; el
  campo existe y solo admite `h2h`.
- Topes por grupo de correlación en las estrategias: se aplican el tope por evento y el total; los
  de equipo/jugador leen `paper_bets` y se dejan para cuando se generalicen.
