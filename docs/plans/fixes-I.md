# Lote I · Fiabilidad: el doctor sin trazas, tests sin restos, un e2e que no depende de la hora (2026-10-16)

Mismo método: cada hallazgo se reproduce con un test que falla ANTES de tocar el código; después,
el arreglo más pequeño.

## I1 · El doctor moría con una traza cuando la base se negaba a abrir

**Verificado.** `npm run doctor` llama a `getDb()` en muchos sitios: el cupo de The Odds API, las
últimas descargas y seis secciones. Cuando `comprobarLibroMayor` se niega (falta `ledger.db` y
hay huellas de que lo hubo), la primera lectura lanzaba una excepción sin capturar. Salía una
traza de pila y ninguna sección más, justo cuando el doctor hace más falta. El mensaje de la
negativa ya traía el remedio, pero llegaba enterrado en la traza.

- **Test (falla antes):**
  - `doctor.e2e.test.ts`: con un DATA_DIR que solo tiene `ledger.db.existe`, el doctor sale con 1,
    enseña «La base no se abre» en DATOS Y COPIAS con `npm run restore`, sin traza, y no crea un
    `ledger.db`.
  - `checks.test.ts`: `comprobarAperturaBase` convierte el mensaje en un hallazgo. La primera línea
    es el texto; las líneas con «·» y sus continuaciones son las acciones; el resto, detalle.
- **Arreglo:**
  - El doctor abre la base una vez, al principio, y guarda el error si se niega.
  - Lo que lee la base (cupo, descargas, secciones) se salta sin ella.
  - El hallazgo va con su remedio en «QUÉ HACER».

## I2 · Cada proceso de test dejaba su DATA_DIR en /tmp

**Verificado.** `server/src/test/setup.ts` crea un DATA_DIR temporal por proceso de test y nunca
lo borraba. En este contenedor había más de 8.000 carpetas, cada una con sus bases.

- **Test (falla antes):** `aislamiento.test.ts`. Un proceso con `setup.ts` escribe en su DATA_DIR y
  sale: la carpeta ya no existe. Con `CONSERVAR_DATOS_TEST=1` se queda.
- **Arreglo:**
  - El proceso que crea la carpeta la borra al salir (`process.on('exit')`).
  - Un proceso hijo que hereda `DATA_DIR` sin cargar `setup.ts` no borra nada. Uno que lo carga
    crea y borra la suya.
  - En Windows, una base aún abierta no se borra y se queda, como antes.
- **Medido:** un `npm test` entero (568 tests) ya no deja ninguna carpeta nueva.

## I3 · «Tenis punto a punto» fallaba el 12 de octubre desde las 09:00 UTC

**No se reproduce.** La sospecha era la hora del día: los partidos de demostración del tenis salen
a las 11:00, 13:30, 16:00 y 19:30 (hora local) y se saltan los que ya pasaron, así que lo que hay
en `/tenis` cambia a lo largo del día.

- **Barrido.** Servidor (semilla y API) con el reloj desplazado y el navegador con
  `page.clock.setSystemTime`. El test pasó a las 11 horas probadas: 09:00, 10:59, 11:01, 12:00,
  13:29, 13:31, 15:59, 16:01, 19:29, 19:31 y 22:30 UTC. 11 de 11.
- **El test no ha cambiado desde el 9 de octubre**, y aquel día volvió a pasar en CI a las 10:24
  y en local por la noche. No hay un fallo que reproducir, así que no se toca el test: el método
  pide un test que falle antes del arreglo, y «arreglar» lo que pasa sería inventar.
- **Lo que sí cambia, para la próxima vez:**
  - Playwright guarda la traza de cada test que falla (`trace: 'retain-on-failure'`): red,
    consola, DOM y capturas de cada paso, en `web/test-results/`.
  - En CI, el trabajo de e2e la sube como artefacto (`e2e-trazas`, 7 días) si falla.
  - Antes, un fallo intermitente no dejaba nada que mirar.
