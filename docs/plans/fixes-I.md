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
