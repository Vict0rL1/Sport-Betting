# Cambios

Por fases de la hoja de ruta (ver `docs/plans/`). Cada fase termina con doctor, tests,
`verify:data`, typecheck, lint y build en verde; las cifras de antes y después van aquí cuando
cambian.

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
