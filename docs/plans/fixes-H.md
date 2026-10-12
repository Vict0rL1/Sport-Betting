# Lote H · Copias a prueba de cortes y sesiones que caducan con la entrada (2026-10-12)

Tras la PR #12. Mismo método que los lotes A–G: cada hallazgo se reproduce con un test que falla
ANTES de tocar el código; después, el arreglo más pequeño. Los tres estaban anotados: H1 por
`data-guardian` (revisión de 8522ca1, «info, anterior») y H2–H3 en `fixes-G.md` («fuera de este
lote… para una tarea aparte»). Revisan `data-guardian` (H1 y la migración de H2) y
`security-reviewer` (H2 y H3).

## H1 · Una copia a medias parecía una copia buena

**Verificado.** `hacerCopia` (`server/src/db/backup.ts`) hace `VACUUM ledger INTO` directamente
sobre el nombre final `ledger-<fecha>.db` y comprueba la integridad después. Si el proceso muere
a mitad (un corte, un `kill`, el disco lleno), queda un fichero con nombre de copia:
- `copiasLocales()` lo cuenta, y la rotación borra por él una copia buena más vieja;
- `npm run restore` lo ofrece como copia.

Además, el nombre lleva la fecha al segundo y se borraba antes de escribir: dos copias en el
mismo segundo dejaban una sola.

- **Test (falla antes):**
  - `escribirCopiaAtomica(destino, escribir)`: si `escribir` falla a mitad o deja algo que no es
    una base, `destino` no existe.
  - Dos `hacerCopia` con la misma `ahora` dejan dos copias íntegras.
- **Arreglo:**
  - Cada escritor escribe en su propio temporal, `ledger-<fecha>.db.<pid>-<azar>.parcial`. No casa
    con `PATRON_COPIA`: ni la rotación, ni `restore`, ni las huellas lo ven.
  - Después se comprueba: con algo dentro, `integrity_check`, y las tablas `paper_bets` y
    `prediction_log` (la regla de `restore`; una base vacía pasa `integrity_check`).
  - `fsync`, y se publica con un enlace, que nunca pisa: si el nombre está cogido, el siguiente
    libre (`ledger-<fecha>-2.db`…). En un disco sin enlaces (FAT, exFAT) se renombra mirando antes.
    Al final, el `fsync` de la carpeta.
- **Revisión de `data-guardian`:**
  - Con un temporal común, la copia programada y `npm run backup` en el mismo segundo se borraban
    el temporal el uno al otro, y podían publicar un fichero a medio escribir. Se reprodujo, y de
    ahí el temporal por escritor y el enlace.
  - Una base vacía pasaba la comprobación.
  - La migración 22 no tenía prueba del camino `ALTER`.
  - Todo con prueba que falla antes (salvo la de la migración, que cubre un hueco).

## H2 · Una sesión sobrevive a un cambio de contraseña o de TOTP

**Verificado.** `sesionDe` (`server/src/auth/sessions.ts`) solo mira que la sesión exista, no
esté revocada y no haya caducado. Una sesión creada antes de cambiar `APP_PASSWORD`, `APP_USER` o
de activar `TOTP_SECRET` sigue entrando. Como la caducidad se desliza con el uso, puede durar
para siempre. Cambiar la contraseña porque se filtró no echaba a quien ya estaba dentro.

- **Test (falla antes):**
  - Una sesión abierta con la contraseña A no entra en una app arrancada con la B.
  - Una abierta sin TOTP no entra con TOTP activo.
  - Con la misma configuración, sí: reiniciar no echa a nadie.
  - Una sesión anterior al arreglo (sin huella) no entra.
- **Arreglo:**
  - Cada sesión guarda una huella de la entrada, en una columna `sessions.huella` (migración 22):
    `HMAC-SHA256(clave = el token de la cookie, usuario + contraseña + secreto TOTP si está
    activo)`. La base solo guarda el SHA-256 del token, así que la huella no sirve para comprobar
    una contraseña sin la cookie.
  - `sesionDe` revoca la sesión que no casa con la configuración del proceso. Si solo la
    rechazara, volvería a entrar al deshacer el cambio, y la lista no la enseñaría para cerrarla.
    Arrancar con un `.env` equivocado cuesta, como mucho, volver a entrar.
  - La lista de sesiones enseña todas las vivas: sin el token no se puede saber cuál vale. Las que
    se presentan con otra entrada ya quedaron revocadas.
  - Las sesiones de antes del arreglo no tienen huella: tras actualizar, hay que entrar una vez.
- **Revisión de `security-reviewer` (bloqueante en la primera versión):**
  - La primera versión guardaba por sesión un `scrypt` de la contraseña con su sal. Con una copia
    de la base (local o en S3) se podía adivinar la contraseña sin límite de intentos: lo
    reprodujo en 5 intentos y 214 ms con una contraseña floja. Los parámetros por defecto de Node
    quedan 8 veces por debajo del mínimo de OWASP.
  - Las sesiones rechazadas sin revocar volvían al deshacer el cambio.
  - El primer listado tras un arranque bloqueaba el proceso un scrypt por sesión.
  - La huella atada al token quita las tres cosas. Cada una tiene prueba que falla con la primera
    versión.

## H3 · Con TOTP, el error de entrada decía si la contraseña era buena

**Verificado.**
- `POST /api/auth/login` respondía «Código incorrecto» con la contraseña buena y el código malo,
  y «Contraseña incorrecta» en los demás casos.
- Basic Auth con TOTP hacía lo mismo: «Código TOTP requerido» solo con la contraseña buena.

El límite de cinco intentos lo hace impracticable, pero sobra.

- **Test (falla antes):** con TOTP, contraseña mala con código bueno y contraseña buena con código
  malo dan la misma respuesta, en el login y en Basic Auth.
- **Arreglo:**
  - Un solo mensaje con TOTP: «Contraseña o código incorrectos». Sin TOTP sigue siendo
    «Contraseña incorrecta».
  - En Basic Auth, la pista de la cabecera `X-TOTP-Code` sale siempre que haya TOTP, sin depender
    de la contraseña.

## Fuera de este lote

- **Cerrar las demás sesiones de una vez.** Tras cambiar una contraseña filtrada, una sesión
  robada que no se use mientras tanto sigue viva, y volvería a entrar si se vuelve a la
  configuración de antes. Sin el token no se puede saber cuál vale, y guardar algo derivado de la
  configuración traería de vuelta el ataque sin conexión. Hoy la lista de sesiones las enseña todas
  y se cierran una a una. Un botón «Cerrar las demás» es el siguiente paso natural.
- **Cookie y copia juntas.** Con una cookie (aunque esté revocada o caducada) y una copia de la
  base, la huella de esa sesión permite probar contraseñas rápido, si no hay TOTP. Hacen falta dos
  robos distintos, y la cookie viva ya da entrada. Opcional: vaciar la huella al revocar.
- **Si el enlace sale bien pero no se puede quitar el temporal** (EBUSY en Windows), `hacerCopia`
  falla aunque la copia ya esté publicada y buena, y no anota la fecha. Sin forma de provocarlo en
  una prueba, queda anotado.

- **Copias fuera de la máquina.** Es configuración, no código: `BACKUP_S3_*` en el `.env` (AWS,
  R2, B2 o MinIO). El doctor ya lo avisa.
- **Restos `.parcial`.** Los que deje un corte (y su `-journal`) no se borran solos: no son copias,
  no estorban a la rotación y se ven a simple vista. Pueden pesar tanto como el libro mayor. Una
  línea del doctor que los liste queda para otra vez.
- **El `fsync` de la carpeta ignora cualquier error, no solo «no se puede en este sistema».** Un
  EIO ahí no se notaría hasta un corte de luz. Sin forma de provocarlo en una prueba, queda anotado.
- **La migración 22 ya se aplicó al libro mayor de trabajo de este contenedor** al verificar (abrir
  la base migra). No se renumera ni se cambia: lo que haga falta después va en la 23.
