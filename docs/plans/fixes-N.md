# Lote N · Lo que encontró la revisión en el navegador de L y M (2026-10-19)

Revisión de `ui-tester` sobre L+M (cf85cca), en Chromium a 390, 360, 320, 280 y 1280 px, claro y
oscuro, español e inglés, con la red y la CPU de un móvil, sobre la base de los e2e y sobre una
copia de los datos del contenedor. Para saber si algo ya pasaba antes, construyó 6c3f435 (antes de
L) y 0dacf77 (L). Cada hallazgo tiene su prueba que falla antes (`web/e2e/movil.spec.ts`,
`saltos.spec.ts`, `idioma.spec.ts`).

## N1 · «Atrás» volvía a la altura, pero no al partido, en las listas de muchos días

- **Encontrado:** NHL con datos de verdad (24 partidos en 5 días). A 390 px, el partido abierto
  volvía a su sitio en 10 casos de 24, y llegaba a quedar 7.825 px desplazado. A 1280, los cinco
  más hondos quedaban a 300–1.050 px.
- **Causa:** cada día se pinta al acercarse a la pantalla (`content-visibility: auto`) y, mientras
  tanto, reserva 900 px. Al volver, la lista se monta de nuevo y los días de fuera de la pantalla
  reservaban 900 px, no lo que medían. La misma altura caía en otro partido.
- **Test (falla antes):** Tenis con seis días de partidos. Se abre uno de los últimos desde mitad de
  pantalla y, al volver, tiene que estar donde estaba. Antes quedaba 2.800 px más abajo.
- **Arreglo:** `SeccionDia` recuerda lo que mide cada día en cada entrada del historial y lo
  reserva al volver.
- **Medido después**, con los mismos barridos de la revisión: NHL a 390 px, 24 de 24 en su sitio;
  a 1280, 13 de 13.

## N2 · Tocar «¿Acertó?» dejaba la semana abierta para siempre, y cada carga saltaba

- **Encontrado:** tras M1, la visita siguiente saltaba 0,87–0,96 (fútbol, NFL, NHL, Destacados).
  El panel medía 136 px hasta que llegaban los resultados, y luego 1.655. El alto guardado pasaba
  del tope de 1.200 px y no se usaba.
- **Arreglo:**
  - Tocar «¿Acertó?» lo deja abierto solo en esa visita. La siguiente nace plegado, como dice su
    diseño.
  - El alto se guarda junto con lo pedido al cargar (la vista, y si nace abierto o plegado), y
    solo se usa si se pide lo mismo. El tope pasa a 6.000 px.
  - Mientras llegan los resultados, el panel reserva el alto que tenía. También plegado: en el
    móvil, el resumen ocupa dos líneas y el panel crecía 24 px.
- **Tests (fallan antes):**
  - tocar y recargar: nace plegado y nada salta;
  - abierto a propósito: CLS 0,75 → menos de 0,05;
  - sin partidos hoy: 0,21 → menos de 0,05;
  - plegado: el panel no crece al llegar el resumen (antes, de 46 a 70 px).
- **Un fallo por el camino:** el primer intento guardaba el estado que se pintó, no el que se
  pidió. Sin partidos hoy, el panel cae en los resultados aunque se pidiera «Hoy», y Tenis con
  datos de verdad pasó de 0,003 a 0,22. Lo cazó la medición, y ahora tiene su test (el de «sin
  partidos hoy»).
- **Medido con datos de verdad:**
  - abierto a propósito: 0,001–0,023;
  - tras tocarlo: 0,013–0,023.
  - Queda una excepción, la primera visita después del toque en Destacados (0,07). Todavía no hay
    alto recordado para el panel plegado, y ese salto de 27 px coincide con la píldora de estado
    de la barra superior. Desde la segunda visita, ya hay alto recordado.

## N3 · «No hay partidos próximos para esta liga» mientras llegaban las ligas

- **Encontrado:** en fútbol, baloncesto y béisbol. Sin datos del deporte, también salía junto a «No
  hay datos de … todavía», diciendo que «el modelo está listo».
- **Test (falla antes):** con las ligas retenidas no sale, y sin datos (la base del e2e) tampoco.
- **Arreglo:** esqueleto hasta la primera respuesta de partidos. Sin ninguna liga con datos, solo
  «No hay datos».

## N4 · La fila de los contadores crecía al llegar

- **Encontrado:** en el móvil, con muchos partidos y el aviso de datos viejos, la fila de
  «Actualizar» crecía 36 px a 390 y 63 a 320 (béisbol, 0,011).
- **Test (falla antes):** la fila y «Detalles» no se mueven cuando llegan los contadores.
- **Arreglo:** la fila recuerda lo que midió en cada pestaña y a cada ancho, y lo reserva mientras
  llegan los contadores. El hueco queda entre «Actualizar» y «Detalles», así que «Detalles» ya
  está en su sitio.

## N5 · El formulario de apuesta abierto mientras cargaban los paneles bajaba 500 px

- **Encontrado:** bajaba 500 px y salía de la pantalla, con lo escrito dentro. Pasaba también, y
  siempre, al llegar con un borrador desde «Mi selección».
- **Test (falla antes):** las dos maneras de abrirlo.
- **Arreglo:** abierto así, el formulario va encima de los paneles hasta que se cierra. Abierto con
  los paneles ya en pantalla, va donde siempre: después del banco del modelo.

## N6 · A 359 px salían los dos veredictos

`max-[359px]` es «menos de 359 px». Ahora es `max-[360px]`, el complemento exacto de
`min-[360px]`. La prueba de M3 pasa también a 359 px.

## N7 · «ganó» medía 1,4 px menos y quedaba 2,7 px más cerca del nombre

- **Arreglo:** «ganó» tiene su propio interlineado, y la separación es un espacio ensanchado a 8 px.
  Si baja de línea, empieza alineado con el nombre; con margen, quedaba 2 px a la derecha.

## N8 · Detalles

- Los esqueletos de Apuestas y Diagnóstico decían «Cargando partidos» al lector de pantalla. Ahora
  dicen «Cargando…».
- Si `/api/bets` falla, Apuestas lo dice, en vez de «Todavía no has registrado ninguna apuesta».
- En inglés, las ingestas de Diagnóstico decían «añadidas / actualizadas».

## Comprobado, sin cambio

- **Las preguntas de ejemplo de «Preguntar a los datos» salen en español aunque la app esté en
  inglés.** Son consultas, y el intérprete del servidor solo entiende español («cara a cara»,
  «quién gana», «contra»): traducirlas las rompería. Va con las frases del servidor en inglés
  (`docs/plans/fixes-M.md`, «Fuera de este lote»).
- **Tras recargar en un partido, «atrás» no vuelve a la altura:** las alturas viven en memoria,
  igual que antes de L.
- **Arrastrar la barra de desplazamiento no detiene la vuelta.** No se puede emular sin pantalla,
  y en el móvil no hay barra.
- **La fila de ligas reserva una línea.** Con varias ligas con datos, en el móvil se parte en dos o
  tres (+40 / +81 px, simulado). En la copia de los datos de verdad cada deporte tiene una sola liga.
  Si crece, se arregla como N4.
- **La píldora de estado de la barra superior** aparece al llegar el estado y empuja «Buscar» 78
  px a la izquierda. Sola cuenta 0,0005. Es del armazón de la app, no de L.

## Verificación

typecheck, lint, tests, build, verify:data y audit en verde; Playwright, 162 de 162 con el servidor
recién arrancado. En la pasada anterior fallaron dos:

- La prueba de N8 en inglés dependía de la hora: la única ingesta de la base del e2e llega a los
  minutos de arrancar el servidor. Ahora lleva su propia ingesta.
- «K12: en inglés, el botón de "Hoy" dice "matches"» falló una vez (el botón no apareció en 5 s),
  con las pruebas en paralelo. Sola (3 de 3), con su fichero (2 de 2) y en la pasada siguiente,
  pasa. Se apunta como intermitente.

## Lo que encontró la revisión en el navegador del lote N

`ui-tester` sobre 68842c6, comparado con L+M (cf85cca). Confirma los arreglos con sus propios
barridos:

- **Atrás:** el partido abierto vuelve a su sitio en 24 de 24 casos a 390 px (antes 10), y en 13 de
  13 a 1280 (antes 8).
- **«¿Acertó?»:** el salto pasa de 0,87–0,96 a 0,0013, y en la matriz de 36 estados queda en 0,0016
  como mucho.
- **N3 y N5:** ni «No hay partidos próximos» mientras carga, ni el formulario bajando.
- **N6 y N7:** limpios en 141 anchos.
- **Fallos:** 39 escenarios de fallo, y ningún esqueleto se queda para siempre.

Arreglado, cada uno con su prueba que falla antes:

- **N9 · La reserva de la fila de contadores se soltaba antes de tiempo (la causó N4).** En fútbol,
  baloncesto, béisbol y NFL, el aviso de datos viejos es el de la liga elegida, y la liga se elige
  un render después de llegar los contadores. La fila se encogía 35 px y volvía a crecer. Con el
  aviso de todas las ligas forzado, fútbol pasaba de 0,106 a 0,200; con los datos de verdad,
  béisbol de 0,011 a 0,027.
  - **Arreglo:** con la liga sin elegir, la pestaña avisa de que el aviso está pendiente
    (`avisoPendiente`), y la fila sigue reservando hasta entonces.
  - **Medido después**, con los datos de verdad y la CPU de un móvil: béisbol, fútbol, baloncesto,
    NFL y NHL, 0,001.
- **N10 · «Atrás» desde el glosario dejaba Confianza 1.500 px más abajo (ya pasaba desde L7).**
  - **Causa:** la vuelta acababa en cuanto la página tenía alto. Luego llegaban las secciones de
    encima (la evaluación y la analítica), y el anclaje del navegador, para no mover lo que se veía,
    bajaba la página lo que crecían.
  - **Arreglo:** desde que se vuelve hasta que la persona toca, desplaza o teclea (o 10 s como
    mucho), el navegador no recoloca la página (`overflow-anchor: none`). Alcanzada la altura, ya
    no se mueve.
  - **Por qué no un tiempo fijo:** el primer intento lo dejaba en los 3 s que hay para llegar, y con
    lo de encima tardando más, fallaba igual.
  - **Por qué no esperar a que la página deje de crecer:** el segundo intento lo hacía, pero la
    página se queda quieta mientras espera algo y no avisa: parada 4 s, sin crecer.
  - **Test:** con la evaluación y la analítica tardando 4 s al volver, el enlace queda donde estaba.
    Antes quedaba fuera de la pantalla, a −872 px.
  - **El test también medía mal:** tras «atrás» no hay documento nuevo, y esperar a «networkidle»
    no espera a nada. Medía antes de que llegara lo de encima, y en la pasada en paralelo falló.
    Ahora espera a que lleguen las cuatro respuestas.
- **N11 · La primera vez, sin partidos hoy, «¿Acertó?» era una tarjeta vacía de 324 px (la causó
  N2).** Se reservaba el alto habitual de «Hoy» abierto en un panel que se pinta plegado. Ahora
  solo se reserva lo que se midió de verdad.
- **N12 · «No hay partidos próximos para esta liga» salía junto a un error de carga, y en la NFL
  sin datos.** Igual que N3: con la petición fallida no se sabe, y sin datos no es verdad.
- **N13 · «@» quedaba a 2,8 px del visitante.** Antes de M estaba a 4. Ahora tiene un margen de 4 px
  y sin espacio: sigue sin poder empezar una línea.

Comprobado, sin cambio:

- **A 280 px, «el nombre de la app baja de línea cuando llega la píldora de estado».** No se
  reproduce. Con la base del e2e y con la copia de los datos de verdad, a 280 px la barra mide 96
  px antes y después de la píldora, y el nombre ocupa dos líneas en los dos casos. Una explicación
  posible es el cambio de fuente: IBM Plex Sans llega después de pintarse con la del sistema
  (`font-display: swap`). Sin una prueba que falle, no se toca.
- **Dentro de «¿Acertó?» abierto, el resumen pasa de una línea a dos al llegar (0,02),** y la
  primera visita después de tocarlo salta 0,02–0,07. Es la primera vez que se pinta plegado y no
  hay alto recordado. Desde la segunda visita, 0,0013.
- **Ya pasaban antes de L:**
  - con los resultados fallando y sin partidos hoy, «Hoy» desaparece y la página sube;
  - «atrás» después de girar el teléfono en el partido no deja la lista donde estaba: lo recordado
    es de la otra anchura.
