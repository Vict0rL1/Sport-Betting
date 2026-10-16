# Lote J · Ninguna web ajena cambia nada en la app, y los restos de copias se ven (2026-10-16)

Mismo método: cada hallazgo se reproduce con un test que falla ANTES de tocar el código; después,
el arreglo más pequeño.

## J1 · Una página de otro sitio podía hacer POST a la app

**Verificado.** `security-reviewer` lo anotó en el lote I como «bajo, solo si un día hay un dominio
propio». Al mirarlo es más amplio:

- Un POST «simple» (`text/plain` o sin cuerpo) no lleva preflight de CORS: el navegador lo manda
  aunque la app no lo permita, y solo esconde la respuesta.
- Sin contraseña, lo normal en el portátil con la API en 127.0.0.1, no hace falta ninguna cookie.
  Cualquier web que visitaras podía hacer que tu navegador generara informes, cambiara ajustes o
  disparara cualquier ruta POST sin cuerpo.
- Con contraseña, solo lo frenaba la cookie `SameSite=Strict`, que no frena a un subdominio hermano.
- Un login desde otro sitio también entraba.

- **Test (falla antes):** `server/src/security/origen.test.ts`.
  - POST con `Sec-Fetch-Site: cross-site` o `same-site`: 403.
  - Sin esa cabecera, con un `Origin` de otro sitio: 403.
  - El login desde otro sitio, con contraseña, da 403 y no abre sesión.
  - Siguen pasando la propia pantalla, curl (sin cabeceras), un origen de `CORS_ORIGINS`, el proxy
    de Vite (`same-origin`) y un navegador viejo con Origin igual al Host. GET no se mira.
- **Arreglo:** `server/src/security/origen.ts`, un `onRequest` registrado antes de la puerta.
  - Afecta a POST, PUT, PATCH y DELETE en cualquier ruta.
  - Con `Sec-Fetch-Site`, pasa `same-origin` o `none`. Sin ella, el `Origin` tiene que ser
    exactamente el host:puerto de la petición.
  - Un origen de `CORS_ORIGINS` pasa siempre: es la lista de quien sí puede llamar desde fuera.
  - Sin contraseña, solo se atiende (también a GET) a `localhost`, a una IP literal o a los nombres
    de `APP_HOSTS`. Eso cierra el rebinding de DNS.
  - El proxy de Vite ya no cambia el Host hacia la API local (`scripts/proxy-api.mjs`).
- **Revisión de `security-reviewer` (bloqueante en la primera versión).** Todo con prueba que falla
  antes:
  - **Alto:** la comprobación miraba `req.url` en crudo con `startsWith('/api')`, y el router
    decodifica los escapes. Un POST de otro sitio a `/%61pi/refresh` ejecutaba `/api/refresh`
    (gasta créditos de The Odds API). Lo reprodujo en un Chromium real. Ahora se miran todas las
    rutas.
  - **Medio:** el proxy de Vite (`changeOrigin: true`) cambiaba el Host a `127.0.0.1:7374`. El
    móvil en la misma wifi, por HTTP a la IP (sin `Sec-Fetch-Site`), llegaba con Origin
    `192.168.x.y:7373` y se le negaba hasta el login. Ahora el proxy hacia la API local no cambia
    el Host, y la comparación es del host:puerto entero (antes solo el nombre, y valía cualquier
    puerto de la misma máquina). Comprobado con Vite de verdad en la IP del contenedor: el móvil
    da 200 y otro sitio, 403.
  - **Medio, de antes:** rebinding de DNS sin contraseña, arreglado con la lista de hosts.
  - **J2:** una copia que se está escribiendo ahora mismo salía como «resto que se puede borrar».
    Ahora solo cuentan los de hace más de una hora.
- **Segunda pasada de `security-reviewer`:** las cinco, cerradas. Lo comprobó con un Chromium real,
  solo y detrás de Vite, y con un rebinding simulado. Una nota baja, arreglada con prueba que falla
  antes: un `VITE_API_BASE` que apunta a esta misma máquina se trataba como remoto, y volvía a
  cambiar el Host. Ahora 127.0.0.1, localhost y [::1] cuentan como API local.

## J2 · Los restos de copias cortadas a medias no los veía nadie

**Verificado.** Lo anotó `data-guardian` en el lote H. Un corte a mitad de una copia deja su
`ledger-….db.<pid>-<azar>.parcial` (y quizá su `-journal`). No es una copia: ni la rotación ni
`restore` lo ven. Pero puede pesar tanto como el libro mayor, y el doctor no lo decía.

- **Test (falla antes):** `checks.test.ts`. Con restos, una línea informativa en DATOS Y COPIAS con
  cuántos son, lo que pesan y sus nombres. Sin ellos, nada.
- **Arreglo:** el doctor lista los `ledger-*.parcial*` de la carpeta de copias de hace más de una
  hora (uno más reciente puede ser una copia escribiéndose). No los borra: lo dice y quien quiera
  los borra a mano.
