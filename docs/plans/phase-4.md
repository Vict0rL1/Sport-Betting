# Fase 4 — Modelos y analítica (solo a través del registro de experimentos)

Regla de la fase, antes que nada: **ninguna probabilidad publicada cambia**. Todo lo nuevo o
bien se registra como experimento (y se queda como sombra), o bien es analítica que se lee,
se enseña y se guarda para graficar. El holdout final (fútbol 2026+, NFL 2024+) sigue cerrado:
sin `--unlock` no hay promoción posible, y eso se escribe en cada experimento.

## 4.1 Recalibración y stacking como experimentos formales

- `experiments/recalibracion.ts`: el walk-forward ya calcula «recalibrado (solo pasado)» en
  cada periodo; ahora devuelve también los pares de pérdidas por partido (no se guardan en el
  JSON) y `registrarRecalibracion(sport, wf)` los pasa por el bootstrap emparejado y escribe el
  experimento (validación, sin holdout) con `accepted: false` y el motivo: mejora/empeora en
  validación; la promoción exige el holdout, que está cerrado.
- El stacking de fútbol ya se registra (`registrarEnsemble`); el motivo gana la frase del
  holdout. Ninguno se promociona: siguen de sombra.

## 4.2 Ensembles sombra en NBA, MLB y NFL

- Los backtests de baloncesto, béisbol y NFL añaden `componentes` a cada partido del flujo con
  los MISMOS nombres que la ficha en vivo (`trust/adapters.ts`): NBA «Modelo (crudo)» y «Modelo
  sin descanso» (nuevos también en vivo), MLB «Elo de equipos (sin abridores)» y «Modelo con
  abridores», NFL «Modelo sin QB» y «Modelo (margen, crudo)». Entrenan, guardan y registran su
  ensemble como el tenis y el fútbol. Corren como sombra; nunca apuestan.

## 4.3 Diagramas de fiabilidad

- `evaluation/reliability.ts`: por deporte, cubetas de probabilidad predicha → frecuencia
  observada, con recuento. Del backtest (lo guarda `informeComun` en
  `experiments/reliability.json`) y en vivo (`predicciones(sport)`). `GET /api/evaluation/reliability?sport=`.

## 4.4 Acierto por segmento

- Walk-forward: segmentos genéricos nuevos para todos los deportes (favorito/no favorito,
  banda de probabilidad, mes, día de la semana), con el umbral `MIN_SEGMENTO` de siempre.
- En vivo: `evaluation/segmentos.ts` con acierto, Brier y CLV (de las apuestas de papel) por
  liga, favorito/no, local/visitante, banda, mes y día; cada celda publicada solo con ≥ 100
  predicciones (≥ 30 apuestas para el CLV). `GET /api/evaluation/segmentos?sport=`.

## 4.5 Monitorización

- `monitoring/series.ts`: Brier y log loss en ventana móvil de 4 semanas por deporte, PSI de
  la distribución de probabilidades predichas (vivo vs. el backtest), y alerta `deriva` cuando
  el PSI supera 0,25 o la deriva del log loss supera dos errores típicos. Serie diaria en
  `monitoring_series` (historia; se reconstruye). Trabajo diario en el registro.
  `GET /api/monitoring?sport=`.

## 4.6 Simulación de temporada

- `simulation/calendario.ts`: la base solo tiene los próximos días. El calendario restante sale
  de las fuentes (openfootball y ESPN traen los partidos sin jugar; nflverse, la temporada
  entera; MLB Stats API, el calendario) a una tabla `remaining_fixtures`; para el fútbol, si
  falta, se reconstruye la doble vuelta pendiente y se dice «calendario reconstruido».
- `simulation/season.ts`: Monte Carlo (10.000 corridas, semilla fija, `rng.ts`) con las
  probabilidades publicadas por partido (el mismo `build…Prediction` de la ficha). Por equipo:
  puntos/victorias esperados, probabilidad de título, de top-4/playoffs, de descenso o división,
  y la distribución de posición final. `config/simulation.json` fija cuántos descienden y
  cuántos entran, por liga. Resultado cacheado por día en `simulation_runs`; trabajo diario.
  `GET /api/simulation/season/:sport/:league`. Test con liga sintética y semilla fija; < 5 s.

## 4.7 Simulación de torneo (tenis)

- `simulation/torneo.ts`: `simularCuadro(cuadro, prob, semilla)` (probabilidad de alcanzar cada
  ronda y de ganar). No hay fuente de cuadros: la API devuelve `cuadroDisponible: false` con el
  motivo y las probabilidades del siguiente partido de cada jugador. Test con un cuadro
  sintético.

## 4.8 Combinadas con correlación

- `picks/parlay.ts`: la probabilidad conjunta de «Mi selección» usa los grupos de correlación
  ya medidos (`staking/correlation.ts`): patas del mismo partido, equipo o jugador no se
  multiplican sin más. Se compara con la cuota combinada y se enseña la ventaja.
  `POST /api/picks/parlay`; la pestaña Destacados lo pinta.

## 4.9 Inteligencia de mercado

- `odds/intel.ts`: *steam moves* (movimientos rápidos y sincronizados entre casas), *surebets*
  entre casas, y «referencia afilada» (Pinnacle como vara del CLV cuando está). Todo etiquetado
  como aproximación. `GET /api/odds/intel`; panel en Destacados.

## 4.10 Qué pasaría si

- La evaluación servida gana `queSi` (pendiente y factores con su rango); la ficha ofrece
  deslizadores que recalculan la probabilidad en el navegador con el mismo desplazamiento
  logístico que la capa de confianza. Etiquetado «simulación, no predicción publicada»; nunca
  se escribe en el libro mayor.

## Lo que salió

- Todo lo de arriba, con tests: `experiments/recalibracion.test.ts`, `evaluation/reliability.test.ts`,
  `evaluation/segmentos.test.ts`, `monitoring/series.test.ts`, `simulation/season.test.ts`,
  `simulation/torneo.test.ts`, `picks/parlay.test.ts`, `odds/intel.test.ts`, y las rutas nuevas en
  `api/contract.test.ts`.
- Lo que la base real todavía no tiene: predicciones puntuadas suficientes (56 de NFL) para que
  fiabilidad, segmentos y monitorización publiquen cifras; dicen la muestra y nada más. El
  calendario pendiente se llena en la próxima `update-data` (las fuentes ya lo guardan); hasta
  entonces el fútbol se simula con el calendario reconstruido y NBA/MLB/NFL dicen «sin calendario
  pendiente». Las cuotas en snapshots están vacías en esta copia, así que la inteligencia de
  mercado devuelve 0 eventos.
- No hay fuente de cuadros de tenis: la API lo dice (`cuadroDisponible: false`).
- Decisión de diseño: la simulación usa el núcleo del modelo sin descanso, abridor ni QB (no se
  conocen con semanas de antelación) y lo dice; en fútbol sí usa `buildFootballPrediction` entera
  (Dixon-Coles con plantillas), que es la probabilidad publicada.

## Hecho cuando

Cada salida nueva tiene test con semilla fija; el registro enseña cada experimento con sus
métricas y su motivo; las simulaciones corren en menos de 5 s por deporte; doctor, tests,
verify:data, typecheck, lint y build en verde; `CHANGELOG.md` al día.
