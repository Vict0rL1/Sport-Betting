# Revisión independiente del PR 17: corrección, confianza y flujo personal (noviembre de 2026)

Encargo: el brief de seguimiento de la revisión independiente del PR 17 (fases A–G). Base verificada:
`main` en `c1f95b9` (merge del PR 17). Rama de trabajo: `claude/tennis-prediction-app-jlhgxh`, desde esa
base. Los commits son locales; el brief prohíbe empujar, desplegar, gastar créditos de cuotas y mandar
avisos reales.

**La revisión original no está disponible en este entorno.** Es
`/Users/victor/Downloads/ECON260/Sport_Betting_PR17_Review_and_Claude_Followup.md`, y la sesión corre en un
contenedor sin acceso a ese Mac (ninguna carpeta compartida). Se ha trabajado con los hallazgos tal como
los resume el brief; donde el resumen no basta, se dice.

## Relevo

- **Base.** `c1f95b9`, árbol limpio. Node 22.23, npm 10.9.
- **Para mirar la app.**
  - Demostración: `npm run build` y, desde `web/`, `node ../scripts/e2e-server.mjs` (puerto 7390).
  - Datos reales: una copia en un `DATA_DIR` temporal, con el programador apagado
    (`AUTO_REFRESH_MINUTES=0 RESULTS_REFRESH_HOURS=0`), sin claves ni transportes de avisos. Nunca `data/`.
- **Fase activa.** Se apunta abajo, en «Estado».

## Fase A: la línea base (20-nov)

- **Comprobaciones en `c1f95b9`.** typecheck, lint, 741/741 tests del servidor, 117/117 de la web y
  build en verde.
- **Capturas «antes».** 1280, 1600, 390 y 320 px; claro y oscuro; español e inglés. Sobre una copia de la
  release de datos con el programador apagado. Sin desbordes horizontales ni errores de consola.
- **Confirmado en el navegador.**
  - **B4.** `/partidos?deporte=nhl&liga=khl` decía «No hay partidos de NHL programados en los próximos
    7 días» con 52 partidos de la NHL en la lista: el filtro de competición estaba puesto y escondido
    (el selector solo salía con más de una competición).
  - **B5.** Las filas no decían de cuándo era la estimación, ni la versión, ni de dónde salían el
    partido y las cuotas.
- **Confirmado en el código.**
  - **B1.** «¿Acertó?», los resultados recientes y la evaluación en vivo puntuaban la publicación
    original, mientras el historial llamaba «evaluada» a la final congelada.
  - **B2.** 1,02 × 1,25 → 1,27 en el servidor y 1,28 en la vista previa; 1,05 × 2,30 → 2,42 y 2,41;
    3 × 1,005 → 3,01 en los dos (lo exacto es 3,015 → 3,02).
  - **B3.** Un fallo al leer lo guardado salía como «Guardar» (no guardada), y cada fila del historial
    pedía la lista entera.
  - **B6.** La afirmación de que el fútbol registra partidos de demostración era falsa.
- **En la copia de datos reales no hay ninguna predicción en vivo resuelta** (0 en los siete deportes):
  B1 no mueve ninguna cifra real hoy; el defecto se reproduce con datos sintéticos en los tests.

## Decisiones

- **B1. Política de evaluación `final-congelada-v1`** (`server/src/evaluation/evaluada.ts`).
  1. Se puntúa la final congelada en `prematch_final`: la última estimación capturada antes del
     inicio, elegida por la hora y nunca por el resultado.
  2. Sin final congelada se puntúa la publicación original, marcada **legado**, y se cuenta aparte.
  3. Una final ilegible se excluye y se cuenta; nunca se cambia en silencio por otro número.
  4. Un partido sin publicación anterior al inicio no entra en ninguna vía.
  5. La final se lee en el orden del registro. En el tenis, cuya clave no fija el orden de los
     jugadores, unos nombres al revés se reordenan; si no casan (sin contar espacios ni formas
     Unicode), la final se excluye. En los demás deportes, la UFC incluida, la clave fija el orden.
  - **Por qué la final y no la publicación.** El brief nombra cuatro conceptos distintos (publicación
    original, última registrada, final congelada evaluada, legado) y pide probar «sin final» y
    «legado». Además, el explorador enseña la última estimación: al empezar, lo último que vio la
    persona es lo que se puntúa.
  - **Lo que no cambia.** El banco de papel, las estrategias, Destacados y la cabecera de las pestañas
    actúan al publicar y siguen con la publicación. La deriva sale de `publicacionesResueltas()`, sin
    pasar por la política, porque recorta importes que se apuestan al publicar.
  - **API.** `/api/resultado` devuelve en `probabilidades` las evaluadas; la publicación va en
    `publicada`, y `evaluacion` dice qué se puntuó (cambio de significado, documentado en la ruta).
- **B2. Dinero exacto** (`server/src/dinero.ts`).
  - Apuesta y cuota como fracciones decimales exactas (BigInt), con un solo redondeo al céntimo, la
    mitad hacia arriba.
  - La web usa una copia idéntica (`web/src/lib/dinero.ts`); un test falla si las dos difieren. La web
    se construye sin el servidor, por eso es una copia y no una importación.
  - Las apuestas guardadas no se reescriben: el pago se calcula al leer, también con importes antiguos
    de más de dos decimales.
- **B3.** Una sola lectura de `/api/guardadas` por pantalla (`GuardadasProvider`), con fases explícitas
  (`web/src/lib/remoto.ts`): cargando, apagado (404), error inicial, listo, actualizando y error de
  refresco con los últimos datos buenos.
- **B4.**
  - Los cambios discretos de filtro (fecha, deporte, competición, quitar un filtro) se apilan en el
    historial y «atrás» los deshace.
  - Escribir en la búsqueda reemplaza la entrada, para no dejar una por letra.
- **C.**
  - Orden de Partidos: fecha → búsqueda, competición, «Guardados» y más filtros → deporte → filtros
    activos → recuento, frescura y densidad → lista.
  - Densidad cómoda o compacta: una preferencia de este navegador (`predictor.densidad`), fuera de la
    URL y de «Quitar filtros».
  - `useCarga` y `FalloCarga`/`AvisoRefresco` (`components/ui/carga.tsx`): un fallo de carga no es una
    lista vacía ni un «Cargando…» eterno. Se aplican a Ajustes (interruptores y cadencias, que no
    miraban `r.ok`) y a los canales de aviso.
- **D.**
  - Ficha en el orden del brief: título → veredicto → estimación vigente con hora y versión → lo que
    el número no es → entradas → historial → mercado → acciones personales.
  - El historial (`web/src/lib/historial.ts`) resume original → última con Δpp por resultado, «el
    favorito cambió», versiones y Δ por fila.
  - D2: panel lateral desde 1280 px, un diálogo modal con la ficha (`?panel=`). Escape, el fondo y
    «atrás» lo cierran, y el foco vuelve a la fila. Debajo de 1280 px, o con Ctrl/⌘, la página
    completa.
  - D3: un partido de demostración no tiene mercado con el que comparar; la sección lo dice en vez de
    enseñar cuotas.
- **E.**
  - **E1.** «Seguidos» (avisos: el partido, o un equipo o jugador seguido) y «Guardados»
    (estimaciones guardadas para comparar) son filtros distintos. Antes «Guardados» mezclaba las dos
    cosas.
  - **E2.** Vistas guardadas de Partidos en este navegador (`web/src/lib/vistas.ts`): nombre,
    aplicar, renombrar y quitar. Se guarda la consulta tal cual: «hoy» sigue siendo hoy y una fecha
    elegida a mano se queda fija.
  - **E3.** Nota personal en cada estimación guardada: `PATCH /api/guardadas/:id`, columnas nuevas
    `note` y `note_updated_at` (v30). Es un dato editable aparte; la instantánea no se toca.
  - **E4.** `/guardadas` («Mis estimaciones guardadas») pone cada guardada al lado de la última
    registrada de ese partido, con Δpp. Si los resultados no casan, no se compara.
  - **E5.** `bets.snapshot_id` (v30). Una apuesta se puede apuntar desde la ficha con la estimación
    vigente.
    - El enlace se valida al crear y al cambiar deporte o partido (misma instantánea, deporte y
      partido) dentro de una transacción, y se puede quitar.
    - Las apuestas de antes quedan sin enlazar, y lo dicen.
    - `verify:data` comprueba los enlaces.
- **F.**
  - **F1.** Rendimiento empieza por «Cómo se mide»: la política, las cohortes, el periodo, la
    muestra y la diferencia entre acertar y ganar dinero. Lleva una tabla por deporte de cuántas
    predicciones se evaluaron con la final, cuántas son legado y cuántas quedan fuera
    (`/api/evaluation`).
  - Los paneles de modelos en la sombra, versiones, experimentos, alertas y riesgo dicen cuándo no
    se pudieron cargar. Antes, «ninguna alerta» o un «Cargando…» eterno.
  - **F2.** Mis apuestas filtra abiertas o liquidadas, con recuento. La pastilla del deporte elegido
    ya no desaparece con el filtro puesto, el mismo defecto que B4; un test lo reproducía.
- **G.**
  - **G1.** La zona de Ajustes vale en los formateadores comunes: `formato().fecha`,
    `formatDateTime`, `shortTime`, `dayKey`, `todayKey` y `daysFromToday`, con
    `formatearInstante` en `lib/zona.ts`.
    - Cubre la medianoche, el cambio de hora y las fechas o zonas inválidas: «—», y la zona del
      navegador si la guardada no vale.
  - **G2.** Los errores de validación de las apuestas llevan un `code` estable con parámetros. La web
    los traduce, y un test comprueba que cada código del servidor tiene frase en es y en. El
    `message` en español sigue para la API.
  - **G3.** Horas de silencio opcionales (`server/src/notifications/silencio.ts`, Ajustes ›
    Notificaciones).
    - La ventana va en la hora local de la zona: el cambio de hora no la mueve, y puede cruzar la
      medianoche. Desde = hasta se rechaza.
    - Solo callan los canales externos: la bandeja lo recibe todo y «Enviar prueba» nunca se calla.
    - Suprimir: no se envía y se anota. Aplazar: cola `notification_pending` (v31), una vez por
      clave (gana la última), al acabar la ventana, y caduca en N horas; el programador la vacía
      cada 5 minutos.
- **B5.** La procedencia va en una línea siempre visible (la hora de la estimación) y un desplegable
  accesible por teclado: versión, fuente del partido, y fuente, número de casas y frescura de las
  cuotas. Un partido empezado dice «Empezado», nunca «en directo».

## Matriz

| Id | Requisito | Estado | Prueba |
| --- | --- | --- | --- |
| B1 | Una identidad evaluada para etiqueta, veredicto, agregado, exportación y evaluación en vivo | Hecho | `evaluada.test.ts`, `evaluada.integracion.test.ts`, `evaluada.revision.test.ts`, `evaluada.reconstruida.test.ts` |
| B2 | Dinero exacto, igual en vista previa, API, lecturas, resúmenes y exportación | Hecho | `server/src/bets/dinero.test.ts`, `web/src/lib/dinero.test.ts` |
| B3 | Estado guardado veraz, compartido, con recuperación | Hecho | `web/src/lib/remoto.test.ts`, `e2e/revision-pr17.spec.ts` (B3 ×2) |
| B4 | Filtro de competición visible y quitable; vacío honesto; enlace, fecha, quitar y atrás | Hecho | `e2e/revision-pr17.spec.ts` (B4 ×2) |
| B5 | Procedencia por fila; nunca «en directo» por la hora | Hecho | `explorador.test.ts` (B5), `e2e/revision-pr17.spec.ts` (B5) |
| B6 | Documentación desfasada del registro del fútbol | Hecho (solo docs) | evidencia en `rediseno-2026-11.md` |
| C | Orden de filtros, densidad persistida, estados de carga reutilizables | Hecho | `lib/densidad.test.ts`, `lib/remoto.test.ts`, `e2e/revision-pr17.spec.ts` (C ×2) |
| D | Orden de la ficha y límites del número | Hecho | `e2e/revision-pr17.spec.ts` (D1) |
| D1 | Historial: original, última, Δpp, versiones, evaluada | Hecho | `lib/historial.test.ts`, `e2e/revision-pr17.spec.ts` (D1) |
| D2 | Panel lateral en escritorio (foco, Escape, atrás, desplazamiento) | Hecho | `e2e/revision-pr17.spec.ts` (D2 ×2) |
| D3 | Mercado solo con cuotas reales compatibles | Hecho en parte | demostración sin mercado; el mercado ganador ya era el mismo que el del modelo |
| E1 | Seguir y guardar, distintos | Hecho | `lib/explorador.test.ts` (E1), `e2e/partidos.spec.ts` (recorrido 2) |
| E2 | Vistas guardadas (nombre, aplicar, renombrar, quitar; fechas relativas) | Hecho | `lib/vistas.test.ts`, `e2e/revision-pr17.spec.ts` (E2) |
| E3 | Notas en las guardadas (editables, aparte de la evidencia) | Hecho | `watchlist/notas.test.ts`, `db/v30.test.ts`, `e2e/revision-pr17.spec.ts` (E3/E4) |
| E4 | Guardada contra la última | Hecho | `watchlist/notas.test.ts` (E4), `e2e/revision-pr17.spec.ts` (E3/E4) |
| E5 | Apuesta enlazada a una instantánea (aditivo; las de antes, sin enlazar) | Hecho | `bets/enlazada.test.ts`, `db/v30.test.ts`, `e2e/revision-pr17.spec.ts` (E5) |
| F1 | Rendimiento: política, cohortes, periodo, muestra, exclusiones; las mismas definiciones | Hecho en parte | definiciones y exclusiones; gráficos de calibración nuevos y desglose: no |
| F2 | Mis apuestas: abiertas/liquidadas, filtros visibles, monedas, enlace a la estimación | Hecho | `e2e/revision-pr17.spec.ts` (F2, E5) |
| G1 | Zona en toda la app (medianoche, cambio de hora, inválidos) | Hecho en parte | `lib/zonaFormato.test.ts`; quedan llamadas sueltas (abajo) |
| G2 | Explicaciones del servidor localizadas por id y parámetros | Hecho en parte | errores de apuestas (`lib/apiError.test.ts`, `bets/enlazada.test.ts`); motivos de las tarjetas y descripciones de funciones, no |
| G3 | Horas de silencio (zona, medianoche, inicio = fin, suprimir/aplazar, caducidad, sin duplicados) | Hecho | `notifications/silencio.test.ts`, `db/v31.test.ts` |

## Revisiones y su destino

- **quant-reviewer, B1 (primera pasada): no commitear.** Seis hallazgos; todos con un test que los
  reproducía antes de arreglarlos.
  1. **Bloqueante.** La deriva pasaba a puntuar la final y cambiaba los recortes de importe del banco
     de papel. Arreglado con `pPublicada`.
  2. **Bloqueante.** En el tenis, una final con los jugadores al revés puntuaba al jugador equivocado.
     Arreglado con la orientación por nombres.
  3. La exportación del baloncesto marcaba todo como excluido. Arreglado: cinco de las siete
     consultas de la exportación nombraban columnas inexistentes y caían a `SELECT *`.
  4. Un partido excluido volvía a entrar como reconstruido. Arreglado.
  5. La evaluación en vivo no decía cuántas predicciones eran final, legado o excluidas. **En parte:**
     los recuentos por deporte están en `/api/evaluation`; no hay umbrales de muestra por tipo.
  6. Una publicación tardía se trataba distinto según la vía. Arreglado: una sola regla.
- **quant-reviewer, segunda pasada (B1 arreglado y B2).** Sin bloqueantes; los seis arreglos se
  sostienen. Cada hallazgo, con su test:
  - **M1.** La ventana de la deriva dependía de la política. Arreglado: sale de las publicaciones.
  - **M2.** `/api/prematch` no aplicaba la regla de la publicación tardía. Arreglado.
  - **M3.** La evaluación por horizontes leía las instantáneas por posición. Arreglado: se orientan
    como el registro, y un partido que no casa no se empareja.
  - **L1.** En las medias, lo arriesgado es la apuesta menos la vuelta de la media perdida. Así el
    ROI es −100 % y d − 1 exactos.
  - **L2.** Las apuestas antiguas de más de dos decimales suman igual en apostado y en beneficio.
  - **L3.** La UFC tiene orden fijo: ya no se trata como de orden libre.
  - **L4.** Los nombres se comparan sin espacios de más ni diferencias Unicode.
  - **L5.** Abierto, abajo.
  - El banco de papel y su comprobación en `verify:data` se quedan como están, con el visto bueno de
    la revisión: apuestas simuladas, escritas una vez, con tolerancia de 0,011.

- **ui-tester (B–D en el navegador, 1280/1600/1279/390/320, claro y oscuro, es/en).** Sin
  bloqueantes: sin desbordes, claves sin traducir ni errores de consola; diálogo, foco y «atrás»
  correctos. Lo que señaló:
  1. Zona táctil de «Procedencia» de 18 px. Arreglado: 24 px.
  2. El panel seguía abierto al estrechar la ventana. Arreglado: por debajo de 1280 px, la página
     completa.
  3. Nombres cortados a 320 px con la procedencia abierta. Se queda: el nombre entero va en
     `title`.
  4. Textos. Arreglados: la etiqueta de versión duplicada, el «. ·» del veredicto, «No se pudieron
     cargar…», la concordancia en inglés y de qué resultado es la final congelada.
  5. El aviso de guardadas salía una vez por fila. Arreglado: una vez por ficha.
  6. «Más filtros» no parecía un control. Arreglado: borde y flecha.
  7. El desplegable de la píldora de estado se sale a 390 px. Es anterior a este cambio: abajo.
  8. El foco tras cerrar un panel abierto por enlace se perdía. Arreglado: va al título.
  - Efecto secundario: siguió un partido en la copia temporal de datos (no en `data/`).
- **data-guardian (v30, notas, apuestas enlazadas, exportaciones y lectores).** Nada bloqueante para
  los datos: v30 es aditiva e idempotente, los 64 triggers siguen, ninguna fila inmutable se toca, y
  se probó con copias (v29 → v30, reaplicar, instalación nueva, `DB_LAYOUT=single`).
  1. **Medio.** Un PATCH de deporte o partido no volvía a comprobar el enlace. Arreglado: dentro de
     `updateBet` y en una transacción, con su test.
  2. `verify:data` no comprobaba los enlaces. Arreglado (533 comprobaciones).
  3. El test de v30 no cubría reaplicarla. Arreglado.
  4. Las etiquetas hacen mal el viaje de ida y vuelta por CSV (`["x"]` → `["[\"x\"]"]`). Es
     anterior a este cambio: abajo.

- **security-reviewer (horas de silencio, rutas nuevas, panel, vistas, borrador).** Lo probado y
  seguro:
  - autenticación (401) y peticiones de otro sitio (403) en `PATCH /api/guardadas`;
  - validación de `snapshot_id` y de la zona (cadenas de 200 KB, espacios, `Etc/GMT+14`);
  - notas como texto de React, sin `dangerouslySetInnerHTML`, y las fórmulas de `aCsv`;
  - sin redirección abierta en las vistas guardadas, y el borrador se vuelve a comprobar en el
    servidor.
  - Los hallazgos, cada uno con su test:
    1. **Medio.** El esquema de respuesta de `/api/ajustes` quitaba `silencio`: Ajustes enseñaba el
       silencio apagado mientras el servidor callaba los avisos. Arreglado.
    2. Una configuración guardada a mano con una zona rota hacía que `notificar` lanzara. Arreglado:
       se vuelve a validar al leer, y ante un error se envía normal.
    3. Un formateador nuevo por minuto en `finDeSilencio`. Arreglado: uno por zona.
    4. La cola sin purgar si el trabajo está apagado, y títulos cortados a 200. Arreglado: se purga
       al aplazar, tiene tope y no se corta.
- **data-guardian (v31, cola de aplazados).** La tabla va bien en el libro mayor: `history.db` se
  publica y se reemplaza. v31 es idempotente en las dos disposiciones y los 64 triggers siguen.
  - Los hallazgos:
    1. **Medio.** El doctor contaba lo silenciado como envíos fallidos. Arreglado con
       `resumenEnvios()`, que excluye el canal `silencio`, con su test.
    2. Validar lo guardado al leerlo: el mismo arreglo que el de seguridad 2.
    3. Con los canales apagados, la cola se vaciaba sin rastro; además se borraba antes de enviar,
       y un aplazamiento fallido se anotaba como aplazado. Arreglado: se queda y caduca anotada, se
       borra después de enviar, y el fallo se anota.
    4. Sin tope ni purga. Arreglado: tope de 200, con lo que desborda anotado, y purga al aplazar.
    5. `notification_pending` faltaba en las tablas de operación de `split.ts`. Arreglado.
  - Queda dicho: restaurar una copia hecha durante las horas de silencio puede repetir un aviso ya
    enviado.

## Pendientes conocidos

- **Umbrales de muestra por tipo.** La evaluación en vivo no los tiene para final y legado; enseña
  los recuentos. La revisión quant lo acepta mientras no se enseñe una métrica por tipo.
- **L5. Una segunda fórmula de beneficio en los límites de pérdida** (`staking/policy.ts:167`). Es
  anterior a este cambio:
  - calcula con coma flotante;
  - trata un cashout sin importe como 0;
  - y `lossState` (`:223`) suma todas las monedas juntas.
  - Tocarla cambia cuándo saltan los límites: queda para un cambio propio, con quant-reviewer.
- **El desplegable de la píldora de estado** (cabecera) se sale de la pantalla a 390 y 320 px. Es
  anterior a este cambio; lo vio el ui-tester.
- **Etiquetas de apuestas por CSV.** Se exportan como JSON y al importar se leen como una sola
  etiqueta. Es anterior a este cambio; lo vio el data-guardian.
- **G1, lo que falta.** Unas 55 llamadas sueltas a `toLocale*String` en las pestañas de cada deporte,
  tarjetas y paneles usan aún la zona del navegador. Los formateadores comunes ya usan la elegida.
  Además, los días de «¿Acertó?» se cortan en la hora del servidor (`today.ts` diaLocal), y
  Rendimiento lo dice.
- **G2, lo que falta.** Los motivos de las tarjetas («En hierba, … llega con mejor Elo») y las
  descripciones de `features.json` salen del servidor en español. El patrón ya está (código y
  parámetros, traducidos en la web, con un test de cobertura); falta aplicarlo a esas frases
  (I18N-1).
- **F1, lo que falta.** Gráficos nuevos de calibración y en el tiempo y el desglose por partido desde
  Rendimiento. Los de antes (Analítica, evaluación en vivo) siguen.
- **Las vistas guardadas viven en este navegador** (como la densidad y la zona). Llevarlas a la
  cuenta pide una tabla y una revisión de data-guardian.

## Informe de entrega (20-nov)

- **Hecho:** B1–B6, C, D (D1, D2 y D3), E1–E5, F2 y G3.
- **Hecho en parte** (la matriz dice qué falta y por qué):
  - F1: las definiciones y las exclusiones; no hay gráficos ni desglose nuevos.
  - G1: los formateadores comunes; quedan llamadas sueltas.
  - G2: los errores de las apuestas; no los motivos de las tarjetas ni las descripciones de funciones.
- **Revisiones:**
  - quant-reviewer, tres pasadas: B1 con 6 hallazgos (2 bloqueantes); B1 arreglado y B2 con 3
    medios y 5 bajos.
  - data-guardian, dos pasadas: v30 y v31.
  - security-reviewer, una pasada.
  - ui-tester, una pasada.
  - Todos los hallazgos tienen destino arriba; los que se arreglaron, con un test que antes fallaba.
- **Migraciones nuevas, solo aditivas:**
  - v30: `bets.snapshot_id`, `saved_predictions.note` y `note_updated_at`;
  - v31: `notification_pending`.
- **Seguridad de los datos:** ninguna fila inmutable se actualiza ni se borra. No se ha tocado
  `data/`, ni se han usado holdouts, `--unlock`, créditos de cuotas, avisos reales ni despliegues.
- **Capturas antes y después**, en el scratchpad de la sesión: `antes-b/`, `despues-b/` y las
  comparaciones de `comparar-b/`.
- **Sin empujar.** El brief lo prohíbe. Los commits están en la rama local
  `claude/tennis-prediction-app-jlhgxh`.

## Comandos y resultados

- Línea base en `c1f95b9`: typecheck, lint, 741/741 servidor, 117/117 web, build: en verde.
- Tras B a G (final):
  - typecheck, lint y build en verde; 793/793 tests del servidor y 138/138 de la web;
  - `verify:data` 533/533 y `audit` 6051/6051 sobre la copia temporal de la release, sin `--force`;
  - Playwright 203/203 (`npx playwright test --trace off`).
- Tras B, C y D:
  - typecheck, lint y build en verde; 774/774 tests del servidor y 130/130 de la web;
  - Playwright 194/194 con B (después, `revision-pr17.spec.ts` 10/10 con C y D);
  - `verify:data` 532/532 y `audit` 6051/6051, sobre una copia de la release de datos en un
    `DATA_DIR` temporal (sin `--force`).
