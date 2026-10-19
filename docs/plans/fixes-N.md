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
