# Fase 1 — Seguridad e higiene

Plan a nivel de fichero, escrito antes de implementar. Lo que ya existía y se reutiliza:
`auth.ts` (Basic Auth solo en producción, comparación en tiempo constante, `/healthz`
exento), `ask/llm.ts` (el modelo solo elige una de seis herramientas; el texto lo compone
`tools.ts` desde SQLite con consultas parametrizadas), `@fastify/cors` con `origin: true`,
`.env` ignorado en git.

## 1.1 `.env.example`, gitleaks y rotación de la clave

| Fichero | Cambio |
| --- | --- |
| `.env.example` (nuevo) | Todas las variables en uso (ver `00-codebase-map.md`) más las nuevas de esta fase: `APP_AUTH`, `TOTP_SECRET`, `CORS_ORIGINS`, `BODY_LIMIT_BYTES`; y las que usarán fases siguientes (`BACKUP_DIR`, `BACKUP_S3_*`, `TELEGRAM_BOT_TOKEN`, `SMTP_*`, `WEBHOOK_URL`, `VAPID_*`), marcadas «Fase 2/3». |
| `scripts/secret-scan.mjs` (nuevo) | Escáner propio sin dependencias: patrones de la clave de The Odds API (32 hex), Anthropic (`sk-ant-`), Telegram, AWS, claves privadas PEM, y `.env` rastreado por git. Modos `--staged` (hook) y `--tracked` (CI y doctor). Exit 1 si encuentra algo. |
| `.githooks/pre-commit` (nuevo) | Ejecuta `gitleaks protect --staged` si el binario está instalado; si no, `node scripts/secret-scan.mjs --staged`. |
| `package.json` | `"prepare": "git config core.hooksPath .githooks"` (solo si hay `.git`), script `secret-scan`, `engines.node >= 22.13.0`. |
| `.gitleaks.toml` (nuevo) | Reglas de la clave de Odds y permitir `data/seed`, `web/public/flags`. |
| `.github/workflows/ci.yml` (nuevo) | Job `secretos` con `gitleaks/gitleaks-action@v2` **y** el escáner propio (por si la acción no corre en forks). La Fase 3 añade tests, lint, typecheck y build a este mismo fichero. |
| `README.md` | Nota: la clave de The Odds API la debe rotar el propietario (estuvo en un chat). |

## 1.2 Autenticación

Diseño: se mantiene Basic Auth (para `curl` y compatibilidad) y se añade **sesión por cookie**
para la pantalla. Modo `APP_AUTH=auto|on|off` (`auto` = solo producción, el comportamiento
actual) para poder probar la puerta en tests sin `NODE_ENV=production`.

| Fichero | Cambio |
| --- | --- |
| `server/src/auth/mode.ts` (nuevo) | Lee `APP_AUTH`, `APP_PASSWORD`, `APP_USER`, `TOTP_SECRET`; `authActiva()`, `assertAuthConfigured()` (movido de `auth.ts`). |
| `server/src/auth/compare.ts` (nuevo) | `igual()` en tiempo constante (movido). |
| `server/src/auth/rateLimit.ts` (nuevo) | Limitador en memoria por IP: 5 fallos en 15 min → 429 con `Retry-After`, ventana deslizante, reloj inyectable para tests. |
| `server/src/auth/totp.ts` (nuevo) | RFC 6238 con `node:crypto` (HMAC-SHA1, 30 s, 6 dígitos, ±1 paso), base32. Test con el vector de la RFC. |
| `server/src/auth/sessions.ts` (nuevo) | Tabla `sessions` (id, token_hash, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip). Token aleatorio de 32 bytes; en la base solo su SHA-256. Caducidad 30 días deslizante. |
| `server/src/auth/cookies.ts` (nuevo) | Leer y escribir la cookie `sp_session` sin dependencia: `HttpOnly; SameSite=Strict; Path=/`; `Secure` cuando la petición es HTTPS o en producción. |
| `server/src/auth.ts` | Pasa a ser el hook `onRequest`: acepta cookie válida o Basic Auth correcto; exentos `/healthz`, `/ready` (Fase 3), `POST /api/auth/login`, `GET /api/auth/me`. Rate limit también en Basic Auth fallido. |
| `server/src/routes/auth.ts` (nuevo) | `GET /api/auth/me` (si hay auth, si la sesión vale, si pide TOTP), `POST /api/auth/login {password, codigo?}`, `POST /api/auth/logout`, `GET /api/auth/sessions`, `POST /api/auth/sessions/:id/revoke`. |
| `web/src/components/auth/Login.tsx`, `AccountPanel.tsx` (nuevos) | Pantalla de entrada (contraseña y, si procede, código) y panel de cuenta en la barra lateral con la lista de sesiones, revocar y salir. Solo se muestran cuando `/api/auth/me` dice que la auth está activa. |
| `web/src/lib/api.ts` | Si una respuesta es 401 en modo sesión, se emite un evento `auth:required` que muestra `Login`. |

Comprobación: el SSE (`/api/latency/stream`) y **todas** las rutas registradas quedan detrás
del hook (test que recorre `onRoute` y pide cada una sin credenciales).

## 1.3 Asistente: lista permitida con argumentos parametrizados

| Fichero | Cambio |
| --- | --- |
| `server/src/ask/validate.ts` (nuevo) | `validarIntencion(x: unknown): Intencion` con la lista cerrada de herramientas y, por herramienta, el número y tipo de argumentos: cadenas acotadas (≤ 80 caracteres, sin caracteres de control), `n` entero 1–50, `tour` ∈ {atp, wta}, superficie ∈ {dura, tierra, hierba}. Lo que no encaja → `ninguna`. |
| `server/src/ask/llm.ts` | `aIntencion` pasa por `validarIntencion`. |
| `server/src/ask/router.ts` | `ejecutar` valida antes del `switch`. |
| `server/src/ask/validate.test.ts` (nuevo) | Entradas adversarias: nombres de herramienta con SQL, argumentos con `'; DROP TABLE players;--`, argumentos gigantes, tipos erróneos; después de ejecutar, las tablas siguen y el resultado es una búsqueda vacía o «no te he entendido». Prueba además que `tools.ts` no concatena entrada del usuario en SQL (grep de `prepare(` con `${` sobre identificadores internos únicamente). |

## 1.4 Cabeceras, CORS, límites y `error_log`

| Fichero | Cambio |
| --- | --- |
| `server/src/security/headers.ts` (nuevo) | Hook `onSend`: CSP (`default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (cámara, micro, geolocalización apagadas), `Cross-Origin-Opener-Policy: same-origin`, HSTS solo en producción. Equivalente a helmet sin dependencia (el proyecto evita dependencias que puede escribir en 40 líneas). |
| `server/src/security/cors.ts` (nuevo) | Orígenes permitidos desde `CORS_ORIGINS` (lista separada por comas). Sin la variable: ninguno (la pantalla es del mismo origen; en desarrollo pasa por el proxy de Vite). |
| `server/src/security/errors.ts` (nuevo) | Tabla `error_log` (id, created_at, request_id, method, url, status, message, stack, user_agent). `setErrorHandler` que la rellena y responde `{ error, requestId }` sin la pila. `leerErrores(limite)` para Diagnóstico y doctor. |
| `server/src/app.ts` (nuevo) | `buildApp(opts)`: fábrica de la instancia Fastify (request id UUID por `x-request-id`, `bodyLimit` desde `BODY_LIMIT_BYTES` con 256 KB por defecto, hooks de latencia, auth, cabeceras, CORS, rutas, `/healthz`, error handler). `index.ts` la usa y se queda con los temporizadores y `listen`. Es lo que permite probar rutas con `app.inject`. |
| `server/src/security/security.test.ts` (nuevo) | Cabeceras presentes; origen ajeno no reflejado; cuerpo de 300 KB → 413; un error provocado deja fila en `error_log` con el mismo `requestId` que la respuesta. |

## 1.5 `engines.node`

`node:sqlite` dejó de exigir `--experimental-sqlite` en **v22.13.0** (y v23.4.0), según
`doc/api/sqlite.md` de Node («SQLite is no longer behind `--experimental-sqlite` but still
experimental»). `engines.node` pasa a `>=22.13.0` en los tres `package.json`; los scripts
conservan el flag porque en 22.13+ es inofensivo y evita sorpresas en instalaciones viejas.
Documentado en `README.md` → Requisitos.

## 1.6 Flags de funciones

`config/features.json` (nuevo) y `server/src/features.ts` (`featureActiva(nombre)`, `/api/features`).
Flags de esta fase: `auth.sesiones` (on), `auth.totp` (opcional: depende de `TOTP_SECRET`),
`seguridad.cabeceras` (on), `seguridad.errorLog` (on), `asistente.modelo` (on; además exige clave).

## 1.7 Doctor

`doctor/checks.ts` → `comprobarSeguridad(estado)`: modo de auth y longitud de contraseña, TOTP,
sesiones activas, cabeceras y CORS, `.env` ignorado, resultado del escáner de secretos sobre
los ficheros rastreados, hook instalado, errores de las últimas 24 h. `scripts/doctor.ts`
recoge los datos. Tests en `doctor/checks.test.ts`.

## Hecho cuando

- `npm run doctor` tiene sección SEGURIDAD con auth, cabeceras y escáner de secretos.
- `npm test` cubre: límite de intentos, flags de la cookie, TOTP, SSE y todas las rutas detrás
  de la auth, cabeceras, CORS, 413, `error_log`, lista permitida del asistente con entradas
  adversarias.
- doctor, tests, verify:data, typecheck, lint y build en verde; `CHANGELOG.md` actualizado.

## Lo que salió al hacerla

- **Hallazgo**: el escáner propio encontró, en un comentario de `server/src/envFile.ts` (desde
  `c670743`, 13-09-2026), un valor de 32 hex con la forma exacta de una clave de The Odds API.
  Sustituido por `<los 32 caracteres de tu clave>`. Sigue en el historial de git: la rotación de
  la clave es del propietario (README y `docs/SEGURIDAD.md` lo dicen).
- Tres falsos positivos del escáner (ejemplos `una-frase-larga-y-tuya` en README y `deploy.mjs`,
  clave falsa del test e2e del doctor) marcados con `secret-scan:ignore`.
- El TOTP leía `process.env` en la ruta además de la configuración: unificado en la configuración
  con la que se construye la app (si no, el test con entorno propio no lo activaba).
- `@fastify/cors` se mantiene como dependencia; helmet, cookie y rate-limit se escribieron a mano
  (unas 40 líneas cada uno, con test), siguiendo el criterio del proyecto de no añadir
  dependencias para lo que cabe en un fichero.
- Verificado en el navegador con `APP_AUTH=on`: pantalla de entrada, error «Contraseña incorrecta»,
  entrada correcta y panel «Cuenta» con la sesión actual y «Salir».
- Resultado: 222 tests (eran 202), `verify:data` 494/494, doctor con sección SEGURIDAD, hook de
  pre-commit comprobado bloqueando un fichero con una clave de prueba.
