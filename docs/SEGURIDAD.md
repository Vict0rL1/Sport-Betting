# Seguridad

Lo que protege la app cuando está en una URL pública, cómo se configura y cómo se comprueba.
Todo lo de aquí tiene test en `server/src/auth/`, `server/src/security/` y `server/src/ask/`,
y `npm run doctor` lo diagnostica en la sección **SEGURIDAD**.

## La puerta: contraseña, sesiones y segundo factor

| Variable | Qué hace |
| --- | --- |
| `APP_AUTH` | `auto` (por defecto): pide contraseña solo con `NODE_ENV=production`. `on`: siempre. `off`: nunca; **prohibido en producción** (el servidor no arranca). |
| `APP_PASSWORD` | Mínimo 8 caracteres. Sin ella, en producción el proceso no arranca. |
| `APP_USER` | Usuario de Basic Auth (`victor` por defecto). No aporta seguridad. |
| `TOTP_SECRET` | Opcional. Segundo factor TOTP (RFC 6238, 6 dígitos, 30 s). Genéralo con `npm run totp:secreto`. |

Dos formas de entrar, una puerta (`server/src/auth.ts`):

- **Sesión por cookie** (`sp_session`), la de la pantalla. `POST /api/auth/login` con la
  contraseña (y el código TOTP si hay secreto) devuelve una cookie `HttpOnly; SameSite=Strict;
  Path=/` y `Secure` por HTTPS o en producción. Dura 30 días deslizantes. En la base solo se
  guarda el SHA-256 del token (`sessions`), así que un volcado de la base no sirve para entrar.
  Desde «Cuenta» (barra lateral) se ven las sesiones abiertas, con dispositivo y última vez, y se
  cierran una a una.
- **Basic Auth**, con la misma contraseña, para `curl` y para quien ya la usaba.

**Límite de intentos**: cinco fallos en quince minutos (por cualquiera de las dos vías) bloquean
la dirección quince minutos (`429` con `Retry-After`); cada bloqueo seguido dobla la espera, hasta
un día. En memoria, por diseño: el reinicio también corta al atacante.

**Comparación en tiempo constante** (`auth/compare.ts`): usuario y contraseña se comparan siempre
los dos, sin cortocircuito, para que el tiempo de respuesta no diga nada.

Exentas de la puerta: `/healthz` (el monitor de Fly), `/ready`, `/api/auth/login` y
`/api/auth/me`. Un test recorre **todas** las rutas registradas y comprueba que cada una devuelve
401 sin credenciales, el SSE de latencia incluido.

## Cabeceras, CORS y límites

`server/src/security/`:

- **CSP** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'
  data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';
  object-src 'none'`. Más `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` (cámara, micro, geolocalización apagadas),
  `Cross-Origin-Opener-Policy` y HSTS solo en producción. Equivalente a helmet, sin dependencia.
- **CORS cerrado**: sin `CORS_ORIGINS` ningún origen ajeno puede llamar a la API desde un
  navegador (antes se reflejaba cualquiera). La pantalla no lo necesita: es del mismo origen.
- **Cuerpo**: 256 KB por defecto (`BODY_LIMIT_BYTES`); por encima, `413`.
- **Errores**: cada petición lleva un id (`x-request-id`, UUID). Un error no controlado deja una
  fila en `error_log` (id, método, URL, mensaje, pila recortada) y la respuesta lleva solo
  `{ error: 'Error interno del servidor', requestId }`: la pila nunca sale. Los 4xx no se apuntan.

## El asistente y el modelo de lenguaje

El enrutador con modelo (`ANTHROPIC_API_KEY`, opcional) **solo elige una herramienta** entre una
lista cerrada de seis y rellena sus argumentos. Nunca produce SQL ni código. `ask/validate.ts` es
la única puerta: nombre en la lista, y por herramienta el número, tipo, tamaño (≤ 80 caracteres,
sin caracteres de control) y valores de cada argumento (`tour` ∈ atp/wta, superficie ∈
dura/tierra/hierba, `n` 1–50). Lo que no encaja es «no te he entendido». Las consultas de
`tools.ts` van parametrizadas; un test estático comprueba que sus únicas interpolaciones son
identificadores internos, y otro ejecuta entradas adversarias (`'; DROP TABLE players; --`) y
comprueba que las tablas siguen.

## Secretos

- `.env` está en `.gitignore` y nunca se sube. `.env.example` documenta cada variable.
- `scripts/secret-scan.mjs` busca formas de clave (The Odds API, Anthropic, Telegram, AWS, PEM,
  GitHub, webhooks, contraseñas junto a su variable) y `.env` rastreados. Corre en el **hook de
  pre-commit** (`.githooks/pre-commit`, activado por `npm install` vía `prepare`), en **CI**
  (`.github/workflows/ci.yml`, junto a gitleaks) y en el **doctor**. Un falso positivo se marca con
  `secret-scan:ignore` en esa línea.
- `gitleaks` se usa si está instalado (`.gitleaks.toml` añade la regla de The Odds API).

### La clave de The Odds API hay que rotarla

La clave estuvo en un chat y, además, un valor con su forma exacta apareció en un comentario de
`server/src/envFile.ts` desde el commit `c670743` (13 de septiembre de 2026) hasta esta fase. El
fichero ya no lo tiene, pero **el historial de git sí**. Una clave vista es una clave que puede
gastar otro: genera una nueva en tu cuenta de The Odds API y pon solo la nueva en tu `.env`
(o `fly secrets set ODDS_API_KEY=…`). El doctor no puede saber si lo has hecho; es tuyo.

## Node

`node:sqlite` dejó de exigir `--experimental-sqlite` en **Node 22.13.0** (documentación oficial,
`doc/api/sqlite.md`: «SQLite is no longer behind `--experimental-sqlite` but still experimental»).
`engines.node` exige `>=22.13.0`. Los scripts conservan el flag porque es inofensivo en
versiones nuevas.
