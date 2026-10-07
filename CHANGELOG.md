# Cambios

Por fases de la hoja de ruta (ver `docs/plans/`). Cada fase termina con doctor, tests,
`verify:data`, typecheck, lint y build en verde; las cifras de antes y después van aquí cuando
cambian.

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

Interruptores nuevos en `config/features.json`: `datos.backupProgramado`, `datos.resultadosProgramados`.
Tests: 222 → **244**. `verify:data` 494 → **507**/507, typecheck, lint y build en verde.

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
