# Fase 2 — Base de datos y pipeline de datos

Plan a nivel de fichero. Lo que ya existe y se reutiliza: una sola base `data/tennis.db`
abierta en `db.ts` (`getDb`), `createSchema` + `migrateSchema` (mapa de columnas deseadas),
triggers append-only en las tablas del libro mayor, ingestas de fútbol con *upsert* en
transacción (`ON CONFLICT … DO UPDATE`, `BEGIN/COMMIT`), `scripts/update-all.mjs`,
`scripts/fetch-data.mjs`, el workflow nocturno `data.yml`, `npm run update-results` (Fase previa),
el de-vig de Shin (`market/devig.ts`), `w_odds/l_odds` del tenis y `odds_*` del fútbol.

## Comprobaciones previas (7-10-2026, desde este contenedor)

| Supuesto de la hoja de ruta | Realidad | Decisión |
| --- | --- | --- |
| `node:sqlite` tiene `.backup()` | No en Node 22.22 (`typeof backup === 'undefined'`); `VACUUM INTO` y `ATTACH` sí | Copias con `VACUUM <schema> INTO` |
| Sackmann `tennis_atp`/`tennis_wta` en GitHub | **404 real** en raw.githubusercontent (otros repos responden); el README ya lo documentaba | No se sustituye TML. WTA y cuotas: tennis-data.co.uk (ya implementado). Se deja escrito y con un test de «fuente caída» |
| football-data, tennis-data, Open-Meteo, ClubElo, Tennis Abstract, MLB Stats, ESPN | Bloqueados por la red de este contenedor (403 del proxy) | Se implementan con `fetch` simulado en tests y una comprobación de alcance en el doctor; la validación con datos reales queda para la máquina del propietario |
| Hay tabla de migraciones | No: mapa de columnas | Se formaliza con `schema_version` por fichero sin perder ese mecanismo (migración 1 = lo actual) |
| La ingesta de fútbol borra la liga | Sí, en `football/scripts/updateData.ts` (DELETE antes de ingerir); las ingestas ya son *upserts* transaccionales | Quitar el DELETE; `--rebuild` lo conserva como opción explícita |

## 2A Almacenamiento

### 2A.1 Dos ficheros: `history.db` y `ledger.db`

- `server/src/db/layout.ts` (nuevo): `DB_LAYOUT=split` (por defecto) o `single` (compatibilidad:
  todo en `tennis.db` como hasta ahora). Rutas `HISTORY_DB_PATH`, `LEDGER_DB_PATH`.
- `db.ts`: con `split`, la conexión principal abre **`history.db`** y hace `ATTACH ledger.db AS
  ledger`. Las tablas reconstruibles siguen sin prefijo (se crean en `main`); las del libro
  mayor se crean con prefijo `ledger.` en sus esquemas (`odds/schema.ts`, `paper/schema.ts`,
  `prematch/schema.ts`, `trust/schema.ts`, `shadow/schema.ts`, `alerts/schema.ts`,
  `auth/sessions.ts`, `security/errors.ts` y, en `db.ts`, los cinco `*_prediction_log`,
  `paper_bets`, `bets`). Las consultas existentes no cambian: un nombre sin prefijo se resuelve
  en `main` y después en las adjuntas.
- Lista única `server/src/db/tables.ts`: `TABLAS_LEDGER` (irremplazables) y función
  `esLedger(tabla)`. La usan la migración, `check-publishable`, `verify:data` y el doctor.
- `meta` se queda en `history.db` (procedencia de datos, σ, ventaja de campo…). Las claves de
  **estado** del libro mayor (banco de papel `paper_*`, `prematch_cycle_at`, copias de seguridad,
  retención) van a `ledger.settings`; `setMeta/getMeta` enrutan por clave (`CLAVES_LEDGER`).
- **Migración única** (`server/src/db/split.ts`): si existe `tennis.db` y no existen los dos
  nuevos, se hacen dos copias completas con `VACUUM INTO` (ficheros temporales), en cada una se
  `DROP` lo que no le corresponde (los triggers e índices caen con su tabla, sin transformar ni una
  fila), se copian las claves de estado a `ledger.settings`, se renombran y el original queda como
  `tennis.db.pre-split-<fecha>`. Sin pérdida por construcción: ningún `INSERT … SELECT`.
- `scripts/fetch-data.mjs`: descarga `history.db.gz`; si hay un `tennis.db` sin partir, pide
  `npm run db:migrate` primero. `check-publishable.mjs` abre `history.db` y comprueba que **no**
  contiene ninguna tabla de `TABLAS_LEDGER`. `data.yml`: empaqueta `history.db` exportado limpio
  (`npm run db:export-history` → `VACUUM INTO`), no el fichero vivo (WAL). `Dockerfile`/`docker-start.sh`
  siembran `history.db`; `fly.toml` documenta que el volumen lleva los dos.

### 2A.2 Migraciones numeradas

- `server/src/db/migrations.ts` (nuevo): lista `MIGRACIONES = [{ version, nombre, destino:
  'history'|'ledger', up(db) }]`; tabla `schema_version (version, nombre, applied_at, estado,
  error)` **en cada fichero**. Se ejecutan al abrir (`getDb`), cada una en transacción; una que
  falla deja fila `estado='failed'` fuera de la transacción y **el proceso no arranca** hasta que
  se resuelve (`npm run db:migrate -- --reintentar` tras arreglar).
  - v1 `esquema-base`: `createSchema` + el mapa de columnas actual (idempotente).
  - v2 `indices`: los de 2A.3.
  - v3 `ingestion_runs`, v4 `settings`, v5 `sessions`/`error_log` (hoy lazy).
- `npm run db:migrate`: abre, migra, imprime el estado de los dos ficheros y sale.

### 2A.3 PRAGMAs e índices

- Ambos ficheros: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`,
  `foreign_keys=ON`. El comentario histórico de `db.ts` sobre WAL y lecturas desde otro proceso
  se corrige: WAL muestra el último `COMMIT` en cada transacción nueva; lo que sí exige es un
  `wal_checkpoint(TRUNCATE)` antes de empaquetar el fichero (por eso `db:export-history`).
- Índices nuevos (migración 2): `odds_snapshots (sport, event_id, bookmaker, observed_at)`;
  `*_prediction_log (league|tour, commence_time)` y `(resolved_at) WHERE resolved_at IS NULL`;
  `paper_bets (status, placed_at)`; `edge_signals (sport, event_id, created_at)`;
  `prediction_assessments (sport, match_key, id)`; resultados `(league, game_date)` donde
  falten (`fb_matches` ya tiene `idx_fb_date`).
- `server/src/db/hot.test.ts`: las cinco consultas más calientes (próximos con su predicción,
  última evaluación de un partido, cierre/último precio de una selección, predicciones
  pendientes de resolver, apuestas abiertas) pasan por `EXPLAIN QUERY PLAN` y ninguna hace
  `SCAN` sin índice. `npm run db:explain` lo imprime.

### 2A.4 Copias de seguridad del libro mayor

- `server/src/db/backup.ts`: `hacerCopia()` → `VACUUM ledger INTO '<BACKUP_DIR>/ledger-<fecha>.db'`,
  `PRAGMA integrity_check` sobre la copia, rotación (últimas 14 locales), y si hay
  `BACKUP_S3_*`, subida con firma SigV4 escrita con `node:crypto` (`db/s3.ts`, sin SDK). Fecha de
  la última copia en `ledger.settings`.
- `npm run backup`, `npm run restore -- <fichero>` (comprueba integridad, guarda la actual como
  `ledger.db.antes-de-restaurar-<fecha>`, copia; avisa de parar el servidor).
- Programada en el servidor (04:10 local, configurable `BACKUP_HOUR`). Doctor: frescura de la
  última copia (aviso > 36 h, error si nunca con apuestas registradas). Test: copia → abrir →
  mismos recuentos → restaurar en un directorio temporal.
- `fly.toml`: documentar `fly volumes snapshots list` y la retención de Fly (5 días).

### 2A.5 Retención de snapshots de cuotas

- **Tensión con la regla dura** («nunca borrar filas de tablas inmutables»). Resolución:
  la retención **nunca corre sola** ni desde el servidor; es un comando explícito con
  `--confirmar`; antes de borrar **exporta** cada fila que va a quitar a
  `data/archive/odds_snapshots-<fecha>.jsonl.gz` (no se pierde información); y los puntos que
  importan (apertura, T-24h, T-6h, T-1h y cierre **por casa y selección**) se conservan. El
  trigger `odds_snapshots_no_delete` se quita y se vuelve a crear dentro de la misma transacción.
- `server/src/odds/retention.ts`: `planificar(diasVivos)` → {conservar, borrar}; `aplicar(plan,
  {confirmar})`. `npm run odds:retention -- --dias 90 [--confirmar]` (sin `--confirmar` solo
  enseña el plan). Tests: los puntos conservados sobreviven; nada más reciente que N días se toca;
  el archivo contiene exactamente lo borrado; sin `--confirmar` no cambia nada.

### 2A.6 `ingestion_runs`

- Tabla (ledger): `id, source, started_at, finished_at, status (running|ok|error), rows_added,
  rows_updated, error, detail`. `server/src/ingest/runs.ts`: `conRegistro(source, fn)`.
- Se envuelven: refresco de cuotas por deporte (`index.ts` → `startAutoRefresh`), los cinco
  `update-data`, `update-results`, copias de seguridad, retención. `GET /api/ingestion-runs`
  (para Diagnóstico, Fase 5). Doctor: última ejecución y estado por fuente.

## 2B Ingesta

- **2B.7** `football/scripts/updateData.ts`: fuera el `DELETE` por liga; las fuentes se ingieren
  con sus *upserts* en transacción y solo se aceptan si traen ≥ 1 partido válido. `--rebuild`
  recupera el borrado explícito. Las `fb_team_ratings` se recalculan igual.
- **2B.8** `server/src/ingest/scheduler.ts`: `update-results` programado en el servidor
  (`RESULTS_REFRESH_HOURS`, 6 por defecto, 0 lo apaga), primera pasada 5 min tras arrancar,
  deporte a deporte en procesos hijo (aislamiento de fallos y memoria), con `ingestion_runs`.

## Lo que salió distinto del plan (2A y 2B)

- `node:sqlite` 22.22 no tiene `.backup()`: la copia y la partición usan `VACUUM [schema] INTO`,
  que da el mismo resultado (fichero nuevo y consistente aunque haya WAL).
- En SQLite, `CREATE INDEX` y `CREATE TRIGGER` sobre una tabla adjunta exigen el prefijo de
  esquema en el **nombre del índice/trigger**, no en la tabla. `ledgerize()` lo hace así.
- La copia programada se expresa en horas (`BACKUP_HOURS`, 24) y no como hora fija (`04:10`): el
  servidor en Fly duerme sin visitas y una hora fija podría no llegar nunca. La primera copia se
  hace dos minutos tras arrancar solo si la última es más vieja que el intervalo.
- Retención de Fly: `snapshot_retention = 14` en `fly.toml` (el plan decía 5, el mínimo).
- La publicación nocturna pasa por `npm run db:export-history` (un `VACUUM INTO` comprobado) en
  vez de comprimir el fichero vivo: con WAL, el fichero solo podía estar incompleto.
- Los triggers del banco de papel se crean **después** de `addMissingColumns` (nombran columnas
  migradas), así que el fixture del test de partición los crea igual que `db.ts`.
- `TABLAS_LEDGER` incluye dos tablas reservadas (`weather_observations`, `policy_versions`) que
  todavía no crea ninguna migración; `verify:data` no exige que existan.
- Las fuentes de fútbol ya hacían upsert en transacción: 2B.7 se redujo a quitar el `DELETE` y
  añadir `--rebuild` (más un módulo `football/ingest/rebuild.ts` con test).

## 2C Fuentes nuevas (opcionales por `config/features.json`, todas con `ingestion_runs`)

- **9 Tenis**: Sackmann no existe (404). Se documenta; `update-data` sigue con TML + tennis-data
  (WTA y cuotas). Test de «fuente caída»: la ingesta falla con mensaje claro y deja
  `ingestion_runs` en `error`, sin borrar nada.
- **10 Cuotas de cierre históricas**: `football/ingest/footballData.ts` guarda también Pinnacle
  temprano (`PSH/PSD/PSA` → `ps_home/ps_draw/ps_away`) y de cierre (`PSCH/PSCD/PSCA` →
  `psc_*`) y la fuente de la cuota (`odds_source`). Backtest de fútbol: columna «vs mercado»
  con Shin, etiquetada por fuente, y **CLV histórico** (apostar a PS, comparar con PSC) para las
  apuestas que el modelo habría hecho. Tenis: `w_odds/l_odds` etiquetados «tennis-data (media)».
  `backtest_metrics.json` gana `mercado.fuente`.
- **11 Clima**: `config/stadiums.json` (coordenadas de los 30 estadios NFL y 30 parques MLB),
  `server/src/weather/openMeteo.ts` (previsión a T-24h/T-6h/T-1h, real tras el partido), tabla
  `weather_observations` (ledger). El modelo NFL ya acepta viento: se le pasa el real cuando el
  estadio es exterior; `DESCONOCIDO` si falla la descarga. Tests con `fetch` simulado.
- **12 Bullpen**: `baseball/ingest/bullpen.ts` (MLB Stats API: relevistas, lanzamientos recientes y
  carga), tabla `bsb_bullpen` (history). Solo mejora la calidad de datos y la ficha; cualquier uso
  en el modelo pasa por el registro de experimentos.
- **13 Baselines externos**: `football/ingest/clubelo.ts` → `fb_external_elo` (history), baseline
  «ClubElo» en el walk-forward cuando hay valor anterior al partido. Tennis Abstract solo publica
  el Elo **actual** (HTML, sin histórico): no sirve como baseline de walk-forward; se evalúa y se
  documenta.
- **14 Lesiones**: evaluación de fuentes gratuitas (ESPN sin clave, informes oficiales NFL en PDF,
  NBA injury report en PDF). Sin fuente estable y parseable se queda `DESCONOCIDO`, con el porqué.

## Hecho cuando

`verify:data` cubre `schema_version`, `settings`, `ingestion_runs`, `weather_observations`,
columnas Pinnacle; los backtests de fútbol, tenis y NFL muestran columna de mercado con su
fuente; `ingestion_runs` enseña cada fuente con su último estado; una copia se restaura en un
test; doctor, tests, verify:data, typecheck, lint y build en verde; `CHANGELOG.md` al día.
