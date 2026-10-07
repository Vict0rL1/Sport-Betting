# Mapa del código (7 de octubre de 2026)

Escrito antes de tocar nada en la hoja de ruta por fases. Es lo que hay, con las rutas
exactas, para que cada fase sepa dónde encajar y qué no duplicar.

## Forma general

Monorepo con dos paquetes (`workspaces` en `package.json`), sin servicios externos obligatorios.

| Pieza | Dónde | Qué es |
| --- | --- | --- |
| Servidor | `server/` (233 módulos `.ts`, 29 ficheros de test) | Node ≥ 22.5, Fastify 5, `node:sqlite` (con `--experimental-sqlite` en los scripts), `tsx` al vuelo (sin compilar), dotenv. Puerto 7374. |
| Pantalla | `web/` (63 ficheros) | React 19, Vite 6, Tailwind 4. Puerto 7373. PWA (manifest + iconos). Solo tema oscuro. |
| Configuración | `config/*.json` | `tours`, `tournaments`, `basketball`, `football`, `baseball`, `americanfootball`, `countries`. **No existe `config/features.json`** (lo crea la Fase 1). |
| Datos | `data/tennis.db` (37 MB, una sola base para los cinco deportes), `data/raw/` (descargas), `data/seed/` (demo) | SQLite. Ignorada en git salvo el seed. |
| Experimentos | `experiments/` | `registry.jsonl` (registro append-only), `calibration.json`, `backtest_metrics.json`, `walkforward/*.json`, `ensembles.json`, `model_history.json`, `postprocess.json`. |
| Scripts de raíz | `scripts/*.mjs` | `go`, `dev` (elige puertos libres), `odds`, `auto`, `demo`, `phone`, `deploy`, `fetch-data`, `update-all`, `check-publishable`, `ahorro`. |
| Despliegue | `Dockerfile` (dos etapas, corre `tsx`), `fly.toml` (Madrid, volumen 3 GB), `scripts/docker-start.sh` | Producción exige `APP_PASSWORD` (Basic Auth). |
| CI | `.github/workflows/data.yml` | **Solo** reconstruye la base de noche y la publica en una release. No hay CI de tests/lint/build. |
| Documentación | `README.md` (3.985 líneas), `docs/*.md` (3.202 líneas: MODEL, FOOTBALL, BASKETBALL, BASEBALL, NFL, CONFIANZA, PROMPT, PROMPT-MOTOR) | |

## Servidor: módulos

```
server/src/
  index.ts            arranque: Fastify, CORS, auth, rutas, estáticos, timers
                      (refresco de cuotas por ritmo del plan, resolver resultados cada 30 min,
                       ciclo pre-partido cada 15 min, cierre de cuotas, latencia)
  config.ts           ROOT, DATA_DIR, DB_PATH, lectura de config/*.json, `env`
  db.ts               getDb(): abre la base, createSchema (41 CREATE TABLE), migrateSchema
                      (mapa «columnas deseadas» → ALTER TABLE ADD COLUMN), meta, resetData
  auth.ts             Basic Auth solo en producción (comparación en tiempo constante)
  static.ts           sirve web/dist en producción
  sports.ts           SPORT_IDS, OUTCOMES, isSportId  ← el único listado de deportes
  versions.ts         huella de versión de cada modelo (ficheros, ruta relativa)
  freshness.ts        ventana de «hoy» (medianoche local o 6 h rodantes)
  today.ts            «Hoy» y «¿Acertó?» (historialReciente, FUENTES por deporte)
  results.ts          emparejar un próximo con su resultado del archivo
  oddsApi.ts / oddsQuota.ts / oddsReason.ts   cliente único de The Odds API, cupo, motivos
  envFile.ts          diagnóstico del .env crudo
  trackRecord.ts      registro inmutable de predicciones de tenis
  repo.ts             consultas de tenis
  bets.ts / betCandidates.ts   registro PERSONAL de apuestas (tabla `bets`, mutable)
  demoSchedule.ts     partidos de demostración
  timezone.ts

  model/              tenis: Elo, predict, reliability
  ingest/             tenis: sackmann/TML, tennisData, rankings, odds
  points/ live/       modelo jerárquico de puntos y motor en vivo (Markov) del tenis
  football/ basketball/ baseball/ nfl/
                      cada uno: ingest/, ratings.ts (replay), model.ts, predict.ts, repo.ts,
                      trackRecord.ts (log inmutable), backtest.ts, scripts/ (updateData, seed)
  football/bayes/     Dixon-Coles jerárquico y DcWalkForward
  routes/             api.ts (tenis + comunes), football, basketball, baseball, nfl, bets,
                      latency, staking   → 73 rutas bajo /api
  odds/               schema (snapshots append-only), snapshots, lines, closingCapture, edgeAnalysis
  paper/              schema (paper_bets, edge_signals, triggers), bankroll (place/settle)
  staking/            policy (DEFAULT_CONFIG: minEdge, Kelly, topes), calibration, correlation, risk
  market/ markets/    de-vig (Shin), mercados finos (mitades, props), liquidez
  postprocess/        calibración, mezcla con el mercado, encogimiento
  evaluation/         métricas comunes, live, validation, walkforward, sample, system, report
  experiments/        registry (JSONL), holdout (fútbol 2026+, NFL 2024+ con candado)
  trust/              capa de confianza: types, perturbation, dataQuality, market, decision
                      (ABSTENCION, RECORTES, FAMILIAS_MOTIVO), adapters, drift, assess, schema
  prematch/           instantáneas T-24h/T-6h/T-1h, final congelada, job (cicloPrePartido)
  shadow/             modelos en sombra y ensembles
  alerts/             alertas internas (schema, engine, detectors)
  audit/              línea temporal y reproducción
  recent/             reconstrucción de predicciones para «¿Acertó?»
  picks/              Destacados (/api/top-picks)
  news/               pipeline de noticias (fútbol)
  latency/            medición por etapas, alertas, SSE
  ask/                asistente: router (regex), agent (varios pasos), tools (consultas),
                      llm (enrutador opcional con Claude: elige herramienta, nunca SQL), llmUsage
  doctor/             checks.ts (puro) + scripts/doctor.ts
  scripts/            68 comandos: backtests, update-data, verify-data, audit, doctor, paper,
                      benchmark/model/shadow reports, reproduce, updateResults, 22 study:*
  test/setup.ts       base temporal, clave falsa, fetch bloqueado
```

## Base de datos

Una sola base, `data/tennis.db`. 50 tablas (41 en `db.ts`, el resto en `*/schema.ts`).

**Reconstruibles** (las borra y recarga `update-data`): `matches`, `players`, `player_ratings`,
`player_rankings`, `player_ids`, `upcoming_matches`; `fb_matches`, `fb_teams`, `fb_team_ratings`,
`fb_upcoming`, `fb_players`, `fb_lineups`, `fb_news`, `fb_odds_history`; `bb_games`, `bb_teams`,
`bb_team_ratings`, `bb_upcoming`; `bsb_games`, `bsb_teams`, `bsb_team_ratings`, `bsb_pitchers`,
`bsb_park_factors`, `bsb_upcoming`; `naf_games`, `naf_teams`, `naf_team_ratings`,
`naf_qb_ratings`, `naf_upcoming`; `latency_samples`, `odds_freshness`, `odds_quote_state`, `meta`.

**Irremplazables** (registro; con triggers que impiden UPDATE/DELETE): `prediction_log`,
`fb_prediction_log`, `bb_prediction_log`, `bsb_prediction_log`, `naf_prediction_log`
(columnas congeladas, resolución una sola vez), `paper_bets`, `edge_signals`,
`odds_snapshots`, `odds_event_observations`, `prediction_snapshots`, `prematch_final`,
`prediction_assessments`, `shadow_predictions`, `alerts`. Y `bets` (apuestas personales,
**mutable** a propósito: se liquidan y editan).

Migraciones: `migrateSchema` añade columnas que faltan; no hay `schema_version` ni
migraciones numeradas. PRAGMAs actuales: `journal_mode=DELETE` (convierte WAL a DELETE a
propósito), `busy_timeout=5000`, `foreign_keys=ON`.

## Pantalla

```
web/src/
  App.tsx             barra lateral (≥1024 px) / barra superior, 8 pestañas (SPORTS), sin rutas
  lib/theme.ts        tokens: INK, TEXT, superficies, HOME/AWAY/DRAW, PROFIT/LOSS, STATUS,
                      SPORT_THEMES (acento por pestaña), SportId
  lib/                api, format, slate, staleness, teamColors, countries, trust, picks…
  components/ui/index.tsx   1.924 líneas: Card, Panel, TeamCrest, Flag, ProbabilityBar,
                      Badge, DayHeading, SlateTable, PicksPanel, DashboardHeader…
  components/icons/   iconos SVG propios (deportes, estado, marca)
  components/{football,basketball,baseball,nfl}/  dashboards, tarjetas, fichas
  components/TennisDashboard.tsx, MatchCard, MatchDetail, PlayerProfile, EloRanking…
  components/bets/    registro personal, banco de papel, evaluación en vivo, exposición
  components/trust/   SystemTrust (Confianza), EventTrustPanel (¿Cuánto fiarse?)
  components/picks/   Destacados
  components/TodayPanel.tsx + RecentResults.tsx   «Hoy» y «¿Acertó?»
  components/LatencyPanel, LivePanel, AskPanel, PointsMarkets, PostprocessPanel
```

Sin enrutador: la pestaña se guarda en `localStorage` (`predictor.sport`). Sin tests de pantalla.

## Variables de entorno en uso

`ODDS_API_KEY` (o `THE_ODDS_API_KEY`), `ODDS_REGIONS`, `APP_PASSWORD`, `APP_USER`, `NODE_ENV`,
`PORT`, `WEB_PORT`, `DATA_DIR`, `AUTO_REFRESH_MINUTES`, `DEMO_FIXTURES`, `ANTHROPIC_API_KEY`
(y `ANTHROPIC_AUTH_TOKEN`), `NEWS_MODEL`, `LLM_PRECIO_ENTRADA/SALIDA`, `LATENCY_TARGET_MS`,
`HT_SHARE`, `HT_RHO`, `GIT_COMMIT`, `DATA_REPO`, `DATA_TAG`, `DATA_BASE_URL`, `WEB_DIST`,
`VITE_API_BASE`. **No hay `.env.example`.** `.env` está en `.gitignore`.

## Lo que la hoja de ruta asume y es distinto

- No hay tabla de migraciones ni `schema_version`: hay un mapa de columnas deseadas (Fase 2 lo
  formaliza sin perder ese mecanismo).
- La autenticación es Basic Auth sin sesiones ni límite de intentos; el SSE de latencia va bajo
  el mismo hook `onRequest`, igual que todo lo demás excepto `/healthz`.
- El asistente con modelo **ya** solo elige herramienta (seis plantillas con argumentos); no
  ejecuta SQL ni código del modelo. La Fase 1 añade el test adversarial y el límite de
  argumentos.
- Ya existen: snapshots append-only, cierre real, CLV en vivo, banco de papel con versiones de
  modelo, walk-forward con baselines, registro de experimentos, holdout con candado, modelos en
  sombra, alertas internas, `npm run reproduce`.
- Hay un `/healthz` (vivo) pero no `/ready`, ni `/metrics`, ni logs estructurados con request id
  (Fastify usa su logger por defecto).
