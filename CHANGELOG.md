# Cambios

Por fases de la hoja de ruta (ver `docs/plans/`). Cada fase termina con doctor, tests,
`verify:data`, typecheck, lint y build en verde; las cifras de antes y después van aquí cuando
cambian.

## Fase 5 — Rediseño de la interfaz y sistema visual (2026-10-07)

Línea base antes de la fase: 309 tests (307 + 2 de Playwright). Ninguna probabilidad publicada
cambia. Detalle en `docs/INTERFAZ.md`.

- **Estructura**: `components/ui/index.tsx` (1.924 líneas) partido en ocho ficheros; Destacados,
  las tarjetas y los paneles grandes, en piezas (ningún componente pasa de ~430 líneas). Rutas
  reales con React Router para cada pestaña, liga, partido, equipo, jugador, Ajustes,
  Diagnóstico y Glosario, con los filtros en la query; cada pantalla en su trozo (el bundle
  principal baja de 687 kB a 333 kB). Barra inferior en el móvil (Destacados, Deportes en hoja,
  Apuestas, Confianza). Píldora de estado única (`GET /api/estado`) en lugar de los avisos de
  demo por pestaña. «Cómo le fue al modelo» solo en los deportes y Destacados; el modelo en
  vivo pasa a Confianza; la latencia, a Diagnóstico (con ingestas, `GET /api/errores`,
  trabajos, copias y cuota). Ajustes: política con «antes → después», interruptores
  (`PATCH /api/features/:nombre`), deportes visibles, cadencias (`cadenciaMin`), notificaciones,
  tema, idioma y banco personal (`GET/PUT /api/ajustes`).
- **Tarjetas y páginas**: lo secundario detrás de «¿Por qué?»; insignia de confianza con «Sin
  mercado» neutro aparte (y en la capa de confianza la falta de cuotas es DESCONOCIDO, no
  rebaja la confianza); sin truncados; chips de liga en una fila. Página de partido (deriva
  T-24h → final, cuotas por casa `GET /api/odds/casas/:id`, «¿Acertó?» `GET /api/resultado`),
  de equipo (historia del Elo `GET /api/elo/historia`, balance, forma, rotación, próximos,
  simulación), de liga (clasificación, Elo, simulación y su evolución) y de jugador.
- **Producto**: seguimiento (`/api/watchlist`, sección en Destacados, notificación de línea
  movida solo para lo seguido); «Mi selección» → borrador en Apuestas, texto, JSON, `.ics` y
  PNG (SVG del servidor `POST /api/picks/tarjeta.svg`); registro personal con importación CSV,
  etiquetas, CLV propio, «¿la habría apostado el modelo?», curva de capital y sugerencia Kelly
  (solo sugerencia); búsqueda Ctrl/Cmd+K (`GET /api/buscar`); glosario con tooltips; recorrido
  de primer uso; filtros del móvil en hoja.
- **Visual**: IBM Plex Sans autoalojada; tinta, superficies y rellenos como variables con tema
  claro (sigue al sistema o se fija en Ajustes) y los colores de estado de Tailwind en su tono
  oscuro en claro; gráficos SVG propios con resumen accesible (fiabilidad, ventana de 4 semanas
  con PSI, segmentos, deriva, cuotas por casa, Elo, simulación, curvas de capital); colores de
  club de LaLiga, Serie A, Bundesliga y Ligue 1 y las 30 franquicias NBA; foco visible,
  movimiento reducido, `aria-live`, «Baloncesto» en todas partes; catálogo i18n (español fuente,
  inglés al lado) para el armazón y las páginas nuevas, con `Intl`; sin conexión (service worker
  y aviso «Sin conexión: datos de HH:MM»).
- **Doctor**: sección ANALÍTICA E INTERFAZ (monitorización y deriva, fiabilidad, simulación,
  calendario pendiente, interruptores anulados, seguimiento). `npm run jobs -- ejecutar
  monitorizacion | simulacion-temporada` sin servidor.
- Migración v9 (`interfaz-fase-5`: `watchlist`, `scheduler_jobs.cadence_override`,
  `bets.tags`). Interruptores nuevos: `interfaz.estado`, `interfaz.diagnostico`,
  `interfaz.ajustes`, `interfaz.seguimiento`, `interfaz.busqueda`, `interfaz.temaClaro`,
  `interfaz.idiomas`, `interfaz.sinConexion`, `interfaz.recorrido`, `interfaz.glosario`,
  `apuestas.importacion`, `interfaz.muestras` (galería de capturas, apagada).
- Tests: 309 → **369** (319 del servidor + 9 unitarios de la web + 41 de Playwright: cada ruta a
  1280 y 390 px sin desbordes ni errores, barra inferior, enlaces profundos, búsqueda, recorrido,
  sin conexión, axe en claro y oscuro, capturas de la píldora, insignias y tarjeta).
  `verify:data`, doctor, typecheck, lint y build en verde. Lighthouse no está en el contenedor:
  sin medir (queda para la Fase 7).

## Fase 4 — Modelos y analítica, vía registro de experimentos (2026-10-07)

Línea base antes de la fase: 278 tests, 514 comprobaciones de `verify:data`. Ninguna probabilidad
publicada cambia en esta fase; el holdout final sigue cerrado y cada experimento lo dice.

- **Recalibración como experimento** (`experiments/recalibracion.ts`): el walk-forward devuelve las
  pérdidas por partido (modelo y recalibrado; no van al JSON) y los cinco backtests las registran
  con bootstrap emparejado y `accepted: false` (rechazado si mejora en validación, porque la
  promoción exige el holdout; no concluyente si no). Mínimo 1.000 pares.
- **Ensembles sombra en NBA, MLB y NFL**: los backtests añaden al flujo los mismos componentes que
  la ficha (NBA «Modelo completo (crudo)» y «Modelo sin descanso», nuevos también en vivo; MLB con y
  sin abridores; NFL con y sin QB) y entrenan, guardan y registran su ensemble como el tenis y el
  fútbol. El motivo de cada ensemble cita el holdout cerrado.
- **Diagramas de fiabilidad** (`evaluation/reliability.ts`, `experiments/reliability.json`, escrito
  por `informeComun`): cubetas con recuento, backtest y vivo sin mezclar.
  `GET /api/evaluation/reliability`.
- **Acierto por segmento**: cuatro segmentos genéricos en el walk-forward (favorito, banda, mes, día)
  y, en vivo, `evaluation/segmentos.ts` con acierto/Brier/log loss y CLV/ROI de papel por liga,
  favorito, resultado o lado, banda, mes y día; celdas publicadas solo con ≥ 100 predicciones o
  ≥ 30 apuestas. `GET /api/evaluation/segmentos`.
- **Monitorización** (`monitoring/series.ts`, tabla `monitoring_series`): log loss y Brier en ventana
  de 28 días, PSI contra el backtest, alerta `deriva` (PSI > 0,25 o > 2 errores típicos, nunca con
  < 100 predicciones); trabajo diario `monitorizacion`. `GET /api/monitoring`.
- **Simulación de temporada** (`simulation/`): calendario pendiente en `remaining_fixtures` desde
  openfootball (lo no jugado), nflverse (temporada entera; conferencia y división de `teams.csv` a
  `naf_teams`) y MLB Stats API (`Preview`), con reconstrucción de la doble vuelta en fútbol
  («calendario reconstruido»); Monte Carlo de 10.000 corridas con semilla fija (`rng.ts`) y las
  probabilidades del núcleo de cada deporte; reglas por liga en `config/simulation.json`; caché por
  día en `simulation_runs`; trabajo diario `simulacion-temporada`. Etiquetado «simulación, no
  predicción publicada». `GET /api/simulation/season/:sport/:league`. Test con liga sintética < 5 s.
- **Cuadro de tenis** (`simulation/torneo.ts`): `simularCuadro` probado con un cuadro sintético; sin
  fuente de cuadros la API devuelve `cuadroDisponible: false` con el motivo y los siguientes
  partidos. `GET /api/simulation/torneo`.
- **Combinadas con correlación** (`picks/parlay.ts`): conjunta de «Mi selección» con la corrección
  por pares sobre los grupos medidos; mismo partido = incompatible. `POST /api/picks/parlay`;
  Destacados enseña conjunta, independiente y vínculos.
- **Inteligencia de mercado** (`odds/intel.ts`): steam moves, surebets y referencia Pinnacle sobre
  los snapshots, etiquetado como aproximación. `GET /api/odds/intel`; panel en Destacados.
- **Qué pasaría si**: `queSi` en la evaluación servida y deslizadores en la ficha (misma curva
  logística que la capa de confianza; nunca se registra). La decisión BET/NO BET lee `minEdge` de
  la política versionada.
- Migración v8 (`analitica-fase-4`: `monitoring_series`, `remaining_fixtures`, `simulation_runs`,
  `naf_teams.conference/division`). Interruptores nuevos: `analitica.fiabilidad`,
  `analitica.segmentos`, `analitica.monitorizacion`, `simulacion.temporada`, `simulacion.torneo`,
  `picks.combinadasCorrelacion`, `mercado.inteligencia`, `confianza.queSi`.
- Docs: `docs/EXPERIMENTOS.md` (sección Fase 4), `docs/API.md` (rutas de analítica),
  `docs/plans/phase-4.md`.
- Tests: 278 → **309** (307 de node:test + 2 de Playwright). `verify:data` 514/514, doctor, typecheck, lint y
  build en verde.

## Fase 3 — Backend, API y observabilidad (2026-10-07)

Línea base antes de la fase: 260 tests, 514 comprobaciones de `verify:data`.

- **Un solo camino para predecir en una repetición** (`evaluation/replay.ts`): el backtest de fútbol
  y la reconstrucción de «¿Acertó?» usan la misma función; test de equivalencia (fútbol y NFL).
- **Salud y preparación**: `GET /health` (alias de `/healthz`) y `GET /ready` (migraciones al día y
  registro de trabajos en marcha; 503 si no), sin contraseña. Logs pino con `reqId`, `LOG_LEVEL` y
  redacción de autorización y cookies. `GET /api/metrics` en texto de Prometheus
  (`observability/metrics.ts`).
- **OpenAPI y contrato**: `@fastify/swagger` genera la especificación de todas las rutas;
  Swagger UI en `/docs` (detrás de la contraseña) y `/openapi.json`. Esquemas de respuesta en las
  rutas operativas y `api/contract.test.ts` (toda ruta en la especificación; toda respuesta cumple
  su esquema). El test cazó un fallo real: `/api/datos/estado` e `/api/ingestion-runs` estaban
  registradas bajo `/api/api/…` desde la Fase 2; corregido.
- **Exportaciones**: `GET /api/export/:dataset` y `npm run export` (predicciones, apuestas, papel,
  snapshots, benchmark) en CSV (RFC 4180) o JSON con filtros de fecha y deporte.
- **Política versionada** (`policy_versions`, append-only): la v1 son las constantes del código;
  `nuevaVersion` valida y encadena; `paper_bets` y `edge_signals` ganan `policy_version_id`
  (congelada); el banco, la capa de confianza y los topes leen la vigente. `GET/POST /api/policy`,
  `npm run policy -- show|set`.
- **Notificaciones** (`notifications/`): Telegram, webhook (Discord/Slack), correo SMTP y Web Push
  (VAPID, service worker, suscripción desde Cuenta → Notificaciones, «probar» por canal).
  Eventos: valor, línea movida, papel apostada/liquidada, trabajo fallido, deriva. Cada intento en
  `notification_log`. `npm run vapid:generar`.
- **Registro de trabajos** (`scheduler/registry.ts`, `scheduler_jobs`): puntuar en vivo,
  pre-partido, copia, resultados, clima, bullpen y cierre pasan por el registro con cadencia,
  última ejecución, duración, estado e interruptor; `GET /api/scheduler`, `PATCH …/:nombre`,
  `POST …/:nombre/ejecutar`, `npm run jobs`. Sin temporizadores sueltos en `index.ts`.
- **Estudios, ayuda y puesta en marcha**: `npm run study -- <nombre>` (`--list`; los `study:*`
  siguen como alias), `scripts/registry.mjs` + `npm run help` (test: cada script tiene línea),
  `npm run setup` (asistente), `docker-compose.yml`.
- **Documentación partida**: README de 4.011 líneas → 117 (qué es, empezar, diez comandos,
  índice) y `docs/` por tema: ARQUITECTURA (con el árbol generado por `scripts/estructura.mjs`),
  FUENTES, CUOTAS, DINERO_Y_RIESGO, EXPERIMENTOS, OPERACION, NOTIFICACIONES, API. Nada se borró.
- **CI**: `ci.yml` (secretos, lint, tipos, tests, build, `verify:data` sobre la release si
  existe, Playwright) y `nightly.yml` (backtests + `scripts/regresion-backtests.mjs` con
  `experiments/tolerancias.json`). Humo de Playwright (`web/e2e/smoke.spec.ts`,
  `scripts/e2e-server.mjs`): abre, cinco pestañas, API.
- Migración v7 (`operacion-fase-3`). Interruptores nuevos: `observabilidad.metricas`, `api.docs`,
  `operacion.registroTrabajos`, `notificaciones.canales`, `politica.versionada`.
- Tests: 260 → **278** (+2 de Playwright). `verify:data` 514/514, typecheck, lint y build en verde.

## Fase 2 — Base de datos y pipeline de datos (2026-10-07)

Línea base antes de la fase: 222 tests, 494 comprobaciones de `verify:data`.

**2A Almacenamiento**

- **Dos ficheros**: `history.db` (principal) + `ledger.db` (adjunto como `ledger`). Qué tabla va a
  cuál está en una sola lista (`server/src/db/tables.ts`); `ledgerize()` pone el prefijo a los
  `CREATE` del libro mayor sin tocar los esquemas. La base antigua se **parte al arrancar** con
  dos `VACUUM INTO` y `DROP` (ninguna fila se transforma; el original queda como
  `tennis.db.pre-split-<fecha>`). `DB_LAYOUT=single` mantiene el fichero único.
- **Migraciones numeradas** (`MIGRACIONES`, v1–v5) con `schema_version` en cada fichero; una
  fallida se deshace entera y el servidor no arranca hasta `npm run db:migrate -- --reintentar`.
- **PRAGMAs** (WAL, `synchronous=NORMAL`, `foreign_keys`, `busy_timeout`) e **índices** para las
  consultas calientes, con `EXPLAIN QUERY PLAN` en test y en `verify:data` (`npm run db:explain`).
- **Copias del libro mayor**: `npm run backup` / `npm run restore`, programadas en el servidor
  (`BACKUP_HOURS`, 24 por defecto), rotación de 14, subida S3 compatible con SigV4 propio (sin
  SDK), `integrity_check` antes de dar la copia por buena. `fly.toml`: instantáneas del volumen.
- **Retención de snapshots** (`npm run odds:retention -- --dias N [--confirmar]`): manual,
  exporta a `data/archive/*.jsonl.gz` antes de borrar, conserva apertura/T-24h/T-6h/T-1h/cierre
  por casa y selección, trigger recreado en la misma transacción.
- **`ingestion_runs`** (`conRegistro`): refrescos de cuotas por deporte, los cinco `update-data`,
  `update-results`, copias y retención. `GET /api/ingestion-runs`, `GET /api/datos/estado`.
- **Publicación**: el workflow nocturno publica `history.db.gz` desde `npm run db:export-history`;
  `check-publishable` falla si hay tablas del libro mayor; `fetch-data` exige partir antes;
  Docker lleva `history.db` como semilla y nunca `ledger.db`.
- **Doctor**: sección DATOS Y COPIAS (ficheros, migraciones, frescura de la copia, retención,
  última ingesta por fuente, ejecuciones muertas).

**2B Ingesta**

- `update-data:fb` es **incremental**: fuera el `DELETE` por liga (las fuentes ya hacían upsert en
  transacción); `--rebuild` recupera el borrado explícito. Una fuente caída ya no deja la liga vacía.
- **Resultados programados** en el servidor (`ingest/scheduler.ts`): cada `RESULTS_REFRESH_HOURS`
  (6), primera pasada a los 5 min, deporte a deporte en procesos hijo con `--skip-odds`, sin
  solaparse, con `ingestion_runs`.

**2C Fuentes nuevas** (todas con `ingestion_runs`, ninguna toca una probabilidad publicada)

- **Tenis**: `preflightTennisData`; `update-data` comprueba GitHub y tennis-data.co.uk **antes**
  de borrar la base; con ninguna disponible se para con la base intacta y el error registrado.
- **Cuotas de cierre históricas**: `fb_matches` gana `odds_source`, `ps_*` (Pinnacle temprano) y
  `psc_*` (cierre). `backtest:fb` enseña «vs mercado» etiquetado por fuente, la comparación
  contra Pinnacle al cierre con Shin y el **CLV histórico** (`football/clv.ts`). Tenis y NFL
  etiquetan su mercado; `backtest_metrics.json` gana `mercadoFuente`.
- **Clima**: `config/stadiums.json` (32 estadios NFL, 31 parques MLB), `weather/openMeteo.ts`,
  `weather_observations` (libro mayor, inmutable), ciclo cada 30 min en el servidor, en la ficha
  de NFL y MLB. Deliberadamente **no** entra en la predicción (va contra la regla; Fase 4).
- **Bullpen MLB**: `baseball/ingest/bullpen.ts`, `bsb_bullpen`, `npm run bullpen`, cada 12 h en
  el servidor; badge «bullpen cargado» en la ficha.
- **ClubElo**: `football/ingest/clubelo.ts`, `fb_external_elo`, `npm run clubelo`, baseline
  «ClubElo» en el walk-forward de fútbol. Tennis Abstract descartado (solo Elo actual).
- **Lesiones**: evaluadas; sin fuente estable → `DESCONOCIDO` con motivo (docs/BASE_DE_DATOS.md).
- Migración v6 (`fuentes-2c`), `verify:data` audita columnas Pinnacle, tablas nuevas, triggers
  del clima y que cada equipo NFL/MLB tenga estadio.

Interruptores nuevos en `config/features.json`: `datos.backupProgramado`, `datos.resultadosProgramados`,
`fuentes.cuotasHistoricas`, `fuentes.clima`, `fuentes.bullpen`, `fuentes.clubElo`.
Tests: 222 → **260**. `verify:data` 494 → **514**/514, typecheck, lint y build en verde.

## Fase 1 — Seguridad e higiene (2026-10-07)

Línea base antes de la fase: 202 tests, 494 comprobaciones de `verify:data`, Node ≥ 22.5.

- **Secretos**: `.env.example` con todas las variables; `scripts/secret-scan.mjs` (hook de
  pre-commit, CI y doctor); `.gitleaks.toml`; `.github/workflows/ci.yml` con gitleaks.
  Hallazgo: un valor con la forma de la clave de The Odds API en un comentario de
  `server/src/envFile.ts` desde `c670743`; sustituido por un marcador. **La clave hay que
  rotarla** (ver `docs/SEGURIDAD.md`).
- **Autenticación**: sesiones por cookie (`HttpOnly; SameSite=Strict; Secure` en producción),
  `POST /api/auth/login|logout`, lista y revocación de sesiones, límite de intentos (5 en 15 min,
  429 con `Retry-After`), TOTP opcional (`TOTP_SECRET`, `npm run totp:secreto`), `APP_AUTH=auto|on|off`.
  Basic Auth se mantiene. Pantalla de entrada y panel «Cuenta» en la web.
- **Asistente**: `ask/validate.ts`, lista cerrada de herramientas con argumentos acotados; test con
  entradas adversarias y test estático de que el SQL no interpola argumentos.
- **Cabeceras y límites**: CSP, nosniff, frame-ancestors, referrer, permissions, HSTS en
  producción; CORS cerrado por defecto (`CORS_ORIGINS`); cuerpo máximo 256 KB
  (`BODY_LIMIT_BYTES`); `error_log` con id de petición y respuestas de error sin pila.
- **Arranque**: `server/src/app.ts` (`buildApp`) separa la construcción de Fastify del `listen`,
  lo que permite probar rutas con `inject`. `config/features.json` y `/api/features`.
- **Node**: `engines.node >= 22.13.0` (desde donde `node:sqlite` no necesita flag).
- **Doctor**: sección SEGURIDAD (puerta, TOTP, sesiones, cabeceras, CORS, `.env` ignorado,
  escáner de secretos, hook, errores en 24 h).
- Tests: 202 → **222** (auth, validación del asistente, cabeceras/CORS/413/error_log, doctor). `verify:data` 494/494, typecheck, lint y build en verde.
