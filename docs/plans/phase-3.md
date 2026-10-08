# Fase 3 — Backend, API y observabilidad

Objetivo: que el servidor se pueda operar sin leer el código: salud y preparación, métricas,
logs con id de petición, la API documentada y con contrato, exportaciones, la política de
apuestas versionada, notificaciones, un registro de trabajos programados, los estudios bajo un
solo comando, un asistente de primera puesta en marcha, la documentación partida y la CI entera.

Reglas que se mantienen: nada toca una probabilidad publicada; las tablas inmutables siguen
inmutables (las nuevas que registran decisiones —`policy_versions`— también); todo lo nuevo
detrás de un interruptor en `config/features.json`; copia en español; sin CDN.

## 3.1 Un solo camino para predecir en una repetición

- `server/src/evaluation/replay.ts`: `prediccionFutbolEnReplay` (Dixon-Coles si conoce a los
  dos, Elo si no) y `prediccionNflEnReplay` (distribución con números clave → dos salidas). Los
  usan el backtest de fútbol y la reconstrucción de «¿Acertó?» (`recent/reconstruct.ts`).
  Baloncesto y béisbol ya compartían la función de repetición.
- Test: con la misma liga sembrada, la reconstrucción y una repetición directa con el módulo
  compartido producen exactamente las mismas probabilidades.

## 3.2 Salud, preparación, logs y métricas

- `GET /health` (alias de `/healthz`, sin contraseña) y `GET /ready` (sin contraseña; 200 solo
  si las migraciones están al día y el registro de trabajos arrancó; 503 si no).
- Logs: pino (el de Fastify) con nivel `LOG_LEVEL`, `reqId` en cada línea, sin cabeceras de
  autorización ni cookies (`redact`).
- `GET /api/metrics` (detrás de la contraseña), formato texto de Prometheus:
  `http_peticiones_total{grupo,status}`, `predicciones_servidas_total{sport}`,
  `apuestas_papel_total`, `odds_api_peticiones_usadas`, `odds_api_peticiones_restantes`,
  `trabajo_duracion_segundos{trabajo}` (última, suma, cuenta), `trabajo_ejecuciones_total{trabajo,estado}`,
  `errores_servidor_24h`. `server/src/observability/metrics.ts` con test del formato.

## 3.3 OpenAPI y contrato

- `@fastify/swagger` genera la especificación de TODAS las rutas registradas;
  `@fastify/swagger-ui` la sirve en `/docs` (detrás de la contraseña). `GET /openapi.json`.
- Esquemas de respuesta en las rutas operativas nuevas (`/health`, `/ready`, `/api/features`,
  `/api/datos/estado`, `/api/ingestion-runs`, `/api/policy`, `/api/scheduler`,
  `/api/notifications/canales`, `/api/export/:dataset` en JSON) y en `/api/today`.
- Test de contrato (`server/src/api/contract.test.ts`): cada ruta registrada aparece en la
  especificación, y cada ruta con esquema de respuesta responde algo que lo cumple (validador
  estructural propio: tipos, `required`, `nullable`, `items`). Si una respuesta deja de cumplir
  su esquema, el test falla.

## 3.4 Exportaciones

- `server/src/exports/datasets.ts`: `predicciones` (los cinco registros, normalizados),
  `apuestas` (`bets`), `papel` (`paper_bets`), `snapshots` (`odds_snapshots`), `benchmark`
  (tablas del walk-forward por deporte). Filtros `desde`, `hasta` (fecha) y `sport`.
- `GET /api/export/:dataset?formato=csv|json&desde&hasta&sport` y `npm run export -- <dataset>
  [--formato csv] [--desde] [--hasta] [--sport] [--salida fichero]`. CSV con escape RFC 4180
  (test).

## 3.5 Política versionada

- Tabla `policy_versions` (libro mayor, append-only con triggers): `id, created_at, parent_id,
  config (JSON), hash, nota, origen`. La v1 se siembra con los valores de `DEFAULT_CONFIG`,
  `ABSTENCION`, `RECORTES` y los topes de grupo (`LIMITES`), así que nada cambia de
  comportamiento al migrar.
- `server/src/staking/policyStore.ts`: `politicaVigente()`, `nuevaVersion(cambios, nota,
  origen)` (valida: `kellyFraction ∈ {0.25, 0.2}`, fracciones en (0, 1], `minEdge ≥ 0`;
  inserta una fila nueva, nunca reescribe), `historial()`.
- Columna `policy_version_id` en `paper_bets` y `edge_signals` (congelada: los triggers se
  rehacen si no la nombran). `place()` y `recordSignal()` la escriben; el banco, la capa de
  confianza y los topes de riesgo leen la vigente en vez de la constante.
- `GET /api/policy`, `POST /api/policy {cambios, nota}`; `npm run policy -- show|set clave=valor…`.

## 3.6 Notificaciones

- `server/src/notifications/`: canales por entorno —Web Push (VAPID, `web-push`), Telegram
  (`TELEGRAM_BOT_TOKEN`/`CHAT_ID`), correo SMTP (`nodemailer`), webhook genérico
  (`WEBHOOK_URL`, formato Discord/Slack)—. Eventos: `senal_valor`, `linea_movida`,
  `papel_apostada`, `papel_liquidada`, `digest_listo`, `trabajo_fallido`, `deriva`.
- Enganches: `emitirAlerta` (edge_umbral → senal_valor, mercado_movido → linea_movida, deriva),
  `place()`/`settle()` del banco de papel, `conRegistro` en error → `trabajo_fallido`.
- Cada intento queda en `notification_log` (libro mayor). `POST /api/notifications/test/:canal`
  («enviar prueba»), `GET /api/notifications/canales`, suscripción Web Push
  (`push_subscriptions`, `POST /api/notifications/push/subscribe`, service worker
  `web/public/sw.js`, interruptor en el panel Cuenta). `npm run vapid:generar`.
- Interruptor `notificaciones.canales`; sin ninguna variable, todo queda en «no configurado».

## 3.7 Registro de trabajos programados

- `server/src/scheduler/registry.ts`: una lista de trabajos (`prematch`, `resultados-en-vivo`,
  `resultados`, `copia`, `clima`, `bullpen`, `cierre`, `cuotas`) con cadencia, primera pasada,
  última ejecución, duración, estado y `enabled`, persistido en `scheduler_jobs` (libro mayor).
  `index.ts` deja de tener temporizadores sueltos: registra y arranca el registro.
- `GET /api/scheduler`, `PATCH /api/scheduler/:nombre {enabled}` (Settings en la Fase 5);
  `npm run jobs`. Las duraciones alimentan `/api/metrics`.

## 3.8 Estudios, ayuda y puesta en marcha

- `npm run study -- <nombre>` con `--list` (los 19 `study:*` siguen como alias).
- `scripts/registry.mjs`: el registro único de scripts (nombre, grupo, descripción);
  `npm run help` lo imprime; un test comprueba que cada script de `package.json` está en el
  registro.
- `npm run setup`: asistente interactivo (`.env`, migraciones, datos —descarga o
  reconstrucción o demostración—, doctor). `docker-compose.yml` para uso local.

## 3.9 Documentación partida

- README corto (qué es, puesta en marcha, 10 comandos, enlaces). Las secciones largas pasan a
  `docs/` por tema: ARQUITECTURA (con el árbol generado del repo real por
  `scripts/estructura.mjs`), FUENTES, MODELOS, CUOTAS, DINERO_Y_RIESGO, OPERACION,
  NOTIFICACIONES, API, EXPERIMENTOS. Nada se borra: se mueve.

## 3.10 CI

- `ci.yml`: secretos + calidad (lint, typecheck, test, build) + datos (fetch-data y
  verify:data cuando la release existe) + Playwright (humo: entrar, cinco pestañas, Hoy).
- `nightly.yml`: backtests y `scripts/regresion-backtests.mjs`: falla si el log loss de un
  modelo publicado empeora más de la tolerancia (`experiments/tolerancias.json`).

## Hecho cuando

`/docs` lista todas las rutas; `npm run help` imprime todos los scripts; la CI está en verde en
la rama; cada apuesta de papel y cada señal nuevas llevan `policy_version_id`; doctor, tests,
verify:data, typecheck, lint y build en verde; `CHANGELOG.md` al día.

## Lo que salió distinto del plan

- El test de contrato encontró un fallo real de la Fase 2: `/api/datos/estado` e
  `/api/ingestion-runs` se registraban dentro del plugin con prefijo `/api`, así que vivían en
  `/api/api/…`. Corregido; es exactamente lo que el test existe para cazar.
- Las rutas de los deportes no llevan esquema de respuesta (son decenas, con formas largas): la
  especificación las lista y el contrato las exige presentes, pero solo valida la forma de las
  rutas operativas nuevas. Añadir esquemas a las de predicción es trabajo de la Fase 5/7.
- La copia programada se expresa en cadencia (`BACKUP_HOURS`) dentro del registro, con un guardia
  que no repite una copia reciente al arrancar. El refresco de cuotas sigue con su temporizador
  adaptativo (depende del plan de The Odds API) y no entra en el registro.
- Web Push necesita un service worker: `web/public/sw.js` solo enseña y abre; no cachea nada
  (la Fase 5 decidirá el modo sin conexión).
- Playwright en el contenedor usa el Chromium preinstalado (`PLAYWRIGHT_CHROMIUM` o
  `/opt/pw-browsers/chromium`); en CI, `playwright install chromium`.
- `verify:data` en CI solo corre si la release `data-latest` existe y se puede bajar; si no, se
  anota y no falla (una base de demostración no pasa 500 comprobaciones pensadas para la real).
