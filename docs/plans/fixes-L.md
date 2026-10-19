# Lote L · En el móvil, nada salta al cargar, nada dice «no hay datos» mientras carga, y «atrás» vuelve donde se estaba (2026-10-19)

Lo que dejó pendiente el lote K, medido otra vez. Mismo método: cada hallazgo se reproduce con un
test que falla ANTES de tocar el código; después, el arreglo más pequeño.

## L0 · Medición

Chromium a 390 px con la red y la CPU de un móvil (150 ms, 1,6 Mbps, CPU ×4). Se cuentan los
saltos de diseño (CLS) de cada pantalla con sus causas. «Quien vuelve» es una segunda visita, con
lo que la app recuerda de la primera: es lo de cada día.

Medido sobre dos servidores. El de los e2e solo tiene datos de tenis. El otro usa una **copia** de
los datos del contenedor, con fútbol, NBA, MLB, NFL, NHL y UFC, sin red (un `fetch` que bloquea
toda salida), sin claves y sin canales.

| Pantalla | CLS (quien vuelve) | Causa |
|---|---|---|
| Tenis (datos del e2e) | 0,55 | «Preguntar a los datos», los circuitos y los torneos se pintan antes que los partidos; las dos listas llegan encima y los empujan |
| Diagnóstico | 0,32 | cada sección crece al llegar su comprobación |
| Destacados | 0,28 | «Mi selección» se pinta bajo «Cargando partidos…»; la lista llega y la saca de la pantalla |
| Apuestas | 0,20 | los dos paneles del banco devuelven `null` mientras cargan y luego empujan el historial |
| NFL | 0,15 | «Detalles» baja de línea (+39 px); «No hay datos» mientras cargan las ligas; las listas empujan «Sin línea de las casas» |
| NHL | 0,08 | «Detalles» +39 px; las listas empujan «Sin línea de las casas» |
| Baloncesto, Béisbol, Fútbol | 0,02–0,03 | «Detalles» +39 px; «No hay datos» mientras cargan las ligas |

Además, de la revisión de `ui-tester` del lote K (ya pasaba antes de K): «atrás» no devuelve a la
altura de la lista.

## Plan

- **L1** · «No hay datos de fútbol / baloncesto / béisbol / NFL» salía en cada carga, mientras
  llegaban las ligas: decía que no hay datos cuando aún no se sabe (y saltaba 100 px). Mientras no
  hay respuesta, se reserva el sitio de la fila de ligas y no se dice nada.
- **L2** · «Detalles» bajaba de línea al llegar los contadores. En el móvil va siempre en la suya.
- **L3** · Lo que va debajo de las listas de partidos (tenis, NFL, NHL) espera a que lleguen, con el
  esqueleto en su sitio.
- **L4** · Destacados: el esqueleto en lugar de «Cargando partidos…», y «Mi selección» espera a la
  lista.
- **L5** · Apuestas: los dos paneles del banco y el historial salen a la vez.
- **L6** · Diagnóstico: las secciones esperan a las seis comprobaciones.
- **L7** · «Atrás» vuelve a la altura a la que se dejó la lista.

Cada punto con su prueba que falla antes: `web/e2e/saltos.spec.ts` (L1–L6, a 390 px con pantalla
táctil y sin service worker, reteniendo la respuesta que tarda) y `web/e2e/movil.spec.ts` (L7).

## L1 · «No hay datos» mientras llegaban las ligas

- **Test (falla antes):** con las ligas retenidas, `/futbol`, `/baloncesto`, `/beisbol` y `/nfl` no
  dicen «No hay datos de … todavía». Cuando llegan, sí: la base de los e2e no tiene esos deportes.
- **Arreglo:** mientras no hay respuesta, la fila de ligas guarda su sitio vacío (34–38 px).

## L2 · «Detalles» bajaba de línea

- **Test (falla antes):** con los contadores de la cabecera retenidos, la altura de «Detalles» no
  cambia cuando llegan.
- **Arreglo:** por debajo de 640 px, «Detalles» va siempre en su propia línea.

## L3 · Lo de debajo de las listas saltaba cuando llegaban los partidos

- **Tenis. Test (falla antes):** los partidos tardan 800 ms y la pantalla no salta (CLS < 0,05;
  antes 0,52). **Arreglo:** «Preguntar a los datos», los circuitos y los torneos esperan a la
  primera respuesta de los partidos, con el esqueleto en su sitio (antes, las dos listas los
  empujaban más de 500 px). Si el circuito no tiene torneos, o falla la petición, se pinta igual.
- **NFL. Test (falla antes):** con los partidos retenidos no salen ni la fila de ligas ni «Sin
  línea de las casas». **Arreglo:** lo mismo que en tenis.
- **NHL. Test (falla antes):** con `/api/nhl/meta` retenido no sale «Sin línea de las casas».
  **Arreglo:** hasta saber si hay clave de cuotas, no se culpa a la clave (D14). Antes se daba por
  hecho que no la había.

## L4 · Destacados

- **Test (falla antes):** con la lista retenida, se ve el esqueleto y nada salta al llegar
  (antes 0,057 en el e2e y 0,28 con los datos de verdad).
- **Arreglo:** el esqueleto en lugar de «Cargando partidos…», y «Mi selección» espera a la lista.

## L5 · Apuestas

- **Test (falla antes):** los dos paneles del banco tardan y llegan por separado, primero el banco
  de papel y luego la cartera. Mientras, no sale «Todavía no has registrado ninguna apuesta». Al
  final se ven los dos paneles, y nada ha saltado (con el primer arreglo, 0,22).
- **Arreglo:** los paneles cargan ocultos y salen a la vez que el historial. Mientras, el
  esqueleto espera en su sitio. El primer arreglo solo hacía esperar al historial: el esqueleto
  quedaba debajo de los paneles, y con los datos de verdad el banco de papel llegaba antes y lo
  sacaba de la pantalla (0,16). Lo encontró la medición de después, y el test ahora suelta las dos
  respuestas por separado.

## L6 · Diagnóstico

- **Test (falla antes):** una de las seis comprobaciones (`/api/scheduler`) tarda 800 ms, y nada
  salta cuando llega.
- **Arreglo:** las secciones esperan a las seis comprobaciones, con el esqueleto en su sitio.

## L7 · «Atrás» volvía arriba de la lista

- **Test (falla antes):** en Tenis, con el tercer «Abrir partido ›» en mitad de la pantalla
  (4.732 px), se abre el partido y se vuelve: la lista queda a 4.732 ± 40 px (antes, a 301).
- **Arreglo** (`web/src/lib/desplazamiento.ts`, con 4 tests unitarios): se guarda la altura de
  cada entrada del historial. Al volver, se reintenta en cada fotograma hasta que la página tiene
  alto para llegar. Se deja de intentar si la persona toca, desplaza o teclea, o a los 3 s.
- **El test medía mal al principio.** Con `scrollIntoViewIfNeeded` la página quedaba a 6.695 px,
  pero el enlace estaba 1.551 px por encima de la pantalla: los días de encima se pintan más bajos
  que los 900 px que reservan. Antes de pulsar, `click()` bajaba él mismo a 4.732, y la app volvía
  a 4.732, que era la altura del toque. El test ahora centra el enlace y comprueba que `click()` no
  mueve la lista.
- **Comprobado, sin cambio:** al volver, el navegador intenta su propia restauración, se queda en
  302 y ese desplazamiento se guarda en la misma entrada. Si llegara antes de que la app lea la
  altura guardada, la pisaría. Con la CPU ×1, ×4, ×6, ×10, ×20 y ×30, la app la leyó antes siempre.
  Sin un test que falle, no se toca.

## Resultado

La misma medición de L0, después del lote:

| Pantalla | CLS antes | CLS después |
|---|---|---|
| Tenis (datos del e2e) | 0,55 | 0,03 |
| Diagnóstico | 0,32 | 0,00 |
| Destacados | 0,28 | 0,00 |
| Apuestas | 0,20 | 0,00 |
| NFL | 0,15 | 0,00 |
| NHL | 0,08 | 0,00 |
| Baloncesto, Béisbol, Fútbol | 0,02–0,03 | 0,00–0,01 |

Con los datos de verdad, Tenis queda en 0,00. «Atrás» desde un partido de Tenis vuelve a 4.732 px,
donde se dejó; antes volvía a 301.

## Fuera de este lote

Vistos en la revisión de `ui-tester` del lote K (ya pasaban antes de K). Los tres primeros se
arreglaron en el lote M (`docs/plans/fixes-M.md`); el último sigue pendiente:

- con un perfil nuevo, tocar «¿Acertó?» pliega el panel entero, y mientras carga solo se ve «Cómo
  le fue al modelo cargando…»;
- a 360 px, en las filas de «¿Acertó?», «Wolverhampton» se parte a mitad de palabra;
- a 320 y 280 px, la ficha «Posible value: Alexander Zverev» se sale 11 px de la pantalla;
- en inglés, frases que vienen del servidor salen en español (el titular de la tarjeta «Lo más
  probable: gana…», Confianza, Apuestas, Bandeja), y los números mezclan formatos («67.0 %» junto
  a «88.0%»).
