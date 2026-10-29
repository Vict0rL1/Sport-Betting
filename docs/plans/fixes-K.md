# Lote K · La app en el móvil: que se vea bien y que responda (2026-10-17)

Lo pidió el dueño: «mejorar cómo se mira la app en el celular y mejorar las interacciones
dinámicas». Mismo método que los lotes anteriores: primero se mide, cada hallazgo se reproduce
con un test que falla ANTES de tocar el código y después va el arreglo más pequeño.

## K0 · Auditoría a 390 y 360 px

App construida, servidor de demostración (`scripts/e2e-server.mjs`) y Chromium con
`isMobile` y `hasTouch`, en claro y oscuro. Se recorrieron las 18 rutas, una ficha de partido,
la hoja «Deportes» y el recorrido de bienvenida. Capturas de cada pantalla y, en cada una:
desbordamiento horizontal, zonas de toque, texto de menos de 12 px, saltos de diseño (CLS) y el
tiempo de cambiar de deporte, también con la red y la CPU de un móvil (150 ms, 1,6 Mbps, CPU ×4).

Lo que está bien: ninguna página se desplaza de lado, ningún error de consola ni petición
fallida, y el movimiento reducido ya se respeta en toda la app.

Lo que no:

1. **La hoja «Deportes» se cierra sola.** Abierta justo después de entrar en fútbol, se cierra
   cuando la página añade la liga a la dirección (`/futbol` → `/futbol/epl`). Con la red de un
   móvil, el hueco es de varios cientos de milisegundos; en Fly, con la máquina despertando, de
   segundos.
2. **Al entrar en un deporte, la primera pantalla es «Hoy» de todos los deportes.** En Fútbol se
   ven siete partidos de hockey (unos 420 px de lista) y lo de fútbol empieza debajo. Esa lista
   tiene además su propio desplazamiento (`max-h-[22rem]`): el dedo mueve la caja, no la página.
3. **La página salta al cargar.** En cada deporte, el interruptor «Qué hay hoy / ¿Acertó?» aparece
   cuando llegan los resultados y empuja todo 45 px hacia abajo.
4. **Las tablas esconden el número que importa.** «Lo que el modelo ve más probable» (NFL, NHL,
   tenis) mide 736 px en una caja de 356: la columna «Modelo» empieza en el borde y el resto queda
   fuera. «Los partidos» (520 px) esconde Mercado y Cuota. Nada indica que hay más a la derecha;
   tampoco en la fila de deportes de la cabecera.
5. **Cambiar de deporte espera al código.** Con la red de un móvil, el primer cambio enseña
   «Cargando…» (un texto, sin la forma de lo que viene) durante 1,2 s. Y si el servidor no
   contesta (la máquina de Fly parada), un deporte que no se había abierto no se abre.
6. **Tocar no responde.** Ningún botón tiene estado «pulsado», en el móvil no hay `hover`, y el
   destello gris del navegador lo quita Tailwind: al tocar no se ve nada hasta que cambia la
   pantalla. (En la primera versión de este plan decía que se veía el destello; la prueba de K6
   lo desmintió.)
7. **La hoja y la barra inferior no se mueven.** La hoja aparece de golpe, en una rejilla de 5
   columnas para 7 deportes (5 + 2), con etiquetas de 11 px. Lo que se despliega aparece sin
   transición.
8. **Zonas de toque pequeñas.** En la cabecera, «Buscar» mide 36×24 y la píldora de estado 30×18.
   En NHL y NFL, 28–35 objetivos no llegan al mínimo de WCAG 2.5.8 (24 px sin espacio alrededor):
   «Abrir partido ›» (81×20), «¿Cuánto fiarse?» (298×22) y los nombres de equipo de las tablas
   (21 px de alto).

## Plan

Cada punto con su prueba que falla antes. Casi todas están en `web/e2e/movil.spec.ts`, a 390 px con
pantalla táctil.

## K1 · La hoja «Deportes» se cerraba sola

- **Test (falla antes):** las ligas tardan 1,5 s. Se entra en Fútbol, se abre la hoja y llega la
  liga (`/futbol` → `/futbol/epl`): la hoja tiene que seguir abierta. Elegir un deporte (también el
  mismo) y «atrás» sí la cierran.
- **Arreglo:** la hoja se cerraba con cualquier cambio de dirección. Ahora se cierra al navegar
  (PUSH o «atrás»), no cuando la página reescribe la suya (`replace`). Elegir la cierra siempre.

## K2 · En el móvil, la primera pantalla de cada deporte era «Hoy»

- **Test (falla antes):** con siete partidos hoy, a 390 px se ven tres y «Ver los 7 partidos»; la
  lista no tiene desplazamiento propio; las ligas de fútbol quedan por encima de la barra inferior.
  A 1280 px no cambia nada (siete filas, sin botón).
- **Arreglo:** por debajo de 640 px, tres filas y el botón («Ver menos» para volver). El
  desplazamiento propio de la lista (22 rem) queda solo desde 640 px. Desplegada del todo no se
  guarda como alto a reservar.

## K3 · El interruptor de «Hoy» empujaba la página 45 px

- **Test (falla antes):** con los resultados retrasados 1,2 s, la primera fila de «Hoy» no se mueve
  cuando llegan.
- **Arreglo:** los resultados cuentan desde que se piden. Mientras llegan, «¿Acertó?» lleva a su
  propio «cargando…».

## K4 · Las tablas de partidos escondían la probabilidad del modelo

- **Test (falla antes):** en Tenis a 390 px, nada de «Lo que el modelo ve más probable» ni de «Los
  partidos» queda a la derecha de la pantalla (antes, 39 elementos).
- **Arreglo:** por debajo de 640 px las dos son una lista: el partido, la selección y la
  probabilidad del modelo grande a la derecha; debajo, mercado, diferencia, cuota mínima y
  devolvería. Las celdas comparten código con la tabla, que sigue igual en el escritorio.
- **Test (falla antes):** lo que se desplaza de lado se difumina por el lado donde hay más (a la
  derecha al principio, a la izquierda al final).
- **Arreglo:** `desliza-x` en `index.css`, una máscara que sigue al desplazamiento con una línea de
  tiempo de CSS, sin JavaScript. Sin nada que desplazar no hay difuminado, y un navegador sin
  `animation-timeline` se queda como antes. Va en las 17 cajas con desplazamiento horizontal (menos
  la de la ficha de liga, que tiene borde) y en la fila de deportes de la cabecera.

## K5 · Cambiar de deporte esperaba al código

- **Test (falla antes):** al rato de entrar se han pedido los siete deportes. Con la red cortada,
  la UFC, que no se había abierto, se abre y dice que no le llegan los datos. Antes (comprobado
  con la precarga apagada) el trozo no llegaba, la app recargaba la página para buscarlo y sin red
  quedaba la pantalla «No internet» del navegador: la app desaparecía.
- **Test (falla antes):** con el trozo de la NFL retenido, se ve el esqueleto de tarjetas y no
  «Cargando…».
- **Arreglo:** `lib/precarga.ts` precarga las diez pestañas cuando el navegador está ocioso
  (`requestIdleCallback`, o un temporizador en Safari). Con «ahorro de datos» o sin red no precarga
  nada. La espera enseña `SkeletonList`. Tests unitarios en `precarga.test.ts`.

## K6 · Tocar no daba respuesta

- **Test (falla antes):** con el dedo encima, un botón de la barra inferior se atenúa; al soltar
  vuelve.
- **Arreglo:** en pantallas sin hover, lo que se toca se queda al 60 % mientras se pulsa. Solo lo
  más interno: una tarjeta-enlace con botones dentro no se atenúa entera.

## K7 · La hoja y la barra, con movimiento

- **Test (falla antes):** la hoja se anima al abrir, tiene los siete deportes en 4 + 3 con botones
  de 44 px o más, se cierra deslizándola hacia abajo y un toque sin desplazar no la cierra. Con
  movimiento reducido, no se anima.
- **Arreglo:** la hoja sube desde abajo (240 ms) y el fondo se oscurece con un fundido. Tiene un asa
  y sigue al dedo: si baja más de 60 px se cierra, si no vuelve. El puntero se captura solo al
  empezar a arrastrar, para no quitarle el clic al botón del deporte. Iconos de 44 px y etiquetas
  de 12 px.
- **Test (falla antes):** tocar la pestaña en la que ya se está vuelve arriba.
- **Arreglo:** como en las apps del teléfono; con movimiento reducido, sin animación. En la barra,
  una píldora detrás del icono marca dónde se está (además del color), y las etiquetas pasan a 12
  px.

## K8 · Zonas de toque

- **Test (falla antes):** se mide por dónde «cuenta» cada control. En la cabecera, «Buscar» y la
  píldora de estado llegan a 40 px o más; en una tarjeta, «Ver N motivos más», «Abrir partido ›»
  y «¿Cuánto fiarse?» llegan a 24 (WCAG 2.5.8), y ninguno tapa lo que se ve del de al lado.
- **Arreglo:** `.toque` añade, con puntero grueso, una capa invisible que también es el botón: 10
  px arriba y abajo en la cabecera y 4 en las tarjetas, donde los controles van apilados a 8 px.
  Con 10 en todos, la de «Abrir partido ›» tapaba 2 px de «Ver 5 motivos más»; la prueba lo vio.

## K9 · El servidor de los e2e bajaba resultados de internet (encontrado al verificar)

- **Qué pasaba:** a los 5 minutos de arrancar, `scripts/e2e-server.mjs` corría el trabajo
  «resultados» y bajaba los resultados de los seis deportes con archivo propio (fútbol, baloncesto,
  béisbol, NFL, NHL y UFC), en procesos hijo que escribían la base mientras las pruebas la leían.
  La batería dura más de 5 minutos, así que lo que llegaba cambiaba los datos debajo de las
  pruebas: «NHL sin datos» y «UFC sin datos» fallaban según el minuto. Además, los tests no deben
  usar la red. También explica por qué el primer servidor de la auditoría tenía hockey.
- **Test (falla antes):** `calidad.spec.ts`, K9. `/api/scheduler` del servidor de los e2e no tiene
  «resultados».
- **Arreglo:** `RESULTS_REFRESH_HOURS=0` en el servidor de los e2e: el trabajo no se registra.
- **Revisión de `data-guardian`:** confirmado, nada bloquea. Antes, 9 trabajos con «resultados»;
  después, 8. Con un bloqueo de red, cero salidas. El clima hizo 0 consultas porque solo mira los
  próximos partidos de NFL y MLB que no son de demostración, y en la base del e2e no hay ninguno.
  Lo demás que sale a la red (cuotas, cierre de cuotas, bullpen, asistente de Telegram) no se
  registra sin clave o sin datos. Encontró K11.

## K11 · El servidor de los e2e heredaba los canales de aviso del .env (revisión de `data-guardian`)

- **Qué pasaba:** el entorno del servidor de los e2e es el de quien corre los tests, con solo las
  claves de cuotas y de S3 vaciadas, y dotenv rellena lo que falta con el `.env`. Así llegaban
  Telegram, el webhook, el correo, las notificaciones push y la clave de Anthropic.
  «Generar el de hoy» (`producto.spec.ts`) avisa por todos los canales configurados: en una
  máquina con Telegram en el `.env`, cada pasada de los e2e mandaba un resumen de demostración al
  Telegram de verdad. En CI no pasa porque no hay esos secretos, y en este contenedor tampoco.
- **Y Anthropic:** con `ANTHROPIC_API_KEY` en el `.env`, «Preguntar a los datos» (`/api/ask`)
  elige la consulta con el modelo de Anthropic: salida a la red y gasto en la cuenta de quien corre
  los tests. Hoy ningún e2e pregunta nada, pero el primero que lo hiciera saldría a la red.
- **Tests (fallan antes):** `calidad.spec.ts`, K11.
  - `/api/notifications/canales` no tiene ningún canal configurado.
  - `/api/ask` contesta con el enrutador de siempre, sin nota de un modelo.
- **Reproducido** sin red, con el servidor en otros puertos (sin tocar el de las pruebas): un
  `fetch` que bloquea y apunta toda salida que no sea a esta máquina, y un `TELEGRAM_BOT_TOKEN`, un
  `WEBHOOK_URL` y una `ANTHROPIC_API_KEY` falsos en el entorno.
  - Antes: Telegram y webhook salían configurados, `/api/ask` intentó llamar a
    `api.anthropic.com` (bloqueado) y las dos pruebas fallaban.
  - Después, con el mismo entorno: ningún canal, ningún intento de salida, y las dos pasan.
- **Arreglo:** el servidor de los e2e vacía esas variables, igual que S3. Vacías y no ausentes,
  porque dotenv no pisa una que ya existe.

## K10 · Una pantalla nueva se abría a media altura (encontrado al verificar)

- **Test (falla antes):** con Confianza bajada hasta el final, ir a Tenis la abre arriba (antes, a
  338–1.885 px según los datos).
- **Arreglo:** al navegar a otra pantalla (PUSH), vuelve arriba. Una dirección que la página
  reescribe (la liga, un filtro) no mueve nada. «Atrás» no se toca y queda como estaba: lo intenta
  el navegador, que no siempre llega. Medido: Confianza a 1.500 px, Tenis, «atrás», y vuelve a
  264 px, porque la pantalla aún no ha cargado sus datos cuando el navegador lo intenta.

## K12 · Lo que encontró la revisión de `ui-tester`

Revisión en Chromium a 390, 360 y 1280 px, más 768, 320, 280 y el borde de 639/640, en claro y
oscuro y una pasada en inglés, con toques de verdad por CDP. Para comparar construyó la versión de
antes del lote (bf1066d) y la sirvió aparte. 198 cargas de página: 0 errores de consola, 0
peticiones fallidas y 0 desbordes. axe sin infracciones en Tenis a 390 y 1280, también con la hoja
abierta. Antes del lote había una `scrollable-region-focusable` a 390, que K arregló. Nada
bloqueante. Arreglado, cada uno con su prueba que falla antes (`movil.spec.ts`, «K12»):

- **Medio · El alto que se reservaba para «Hoy» se quedaba viejo.**
  - Al desplegar «Ver los N partidos», plegar el panel y recargar, la carga siguiente reservaba
    el alto abierto: un hueco de unos 300 px y luego un salto (CLS 0,29; antes del lote, 0,001).
  - Causa: mientras estaba desplegado no se guardaba ningún alto, tampoco al plegarlo.
  - Ahora, desplegado, se guarda el alto sin las filas que la próxima vez no saldrán; plegado, el
    plegado. La prueba recarga con «Hoy» retenido y compara lo reservado con lo que mide al llegar.
- **El difuminado tapaba más de lo que quedaba.** Entre 740 y 768 px (un iPad en vertical), la
  tabla de selecciones sobraba 2 px y salía con la última columna atenuada. Ahora cada lado crece
  con los primeros 2 rem de desplazamiento que le quedan (`animation-range`): si sobran 2 px, se
  difuminan 2.
- **Con el foco del teclado, el anillo salía cortado** por la máscara en los lados difuminados.
  Ahora, con el foco del teclado, no hay máscara.
- **En el escritorio, el texto de esas tablas perdía el suavizado de subpíxel.** La máscara lo
  pasaba a gris, y solo se nota en pantallas de 1x con ClearType. Desde 1024 px no hay máscara:
  allí las tablas caben.
- **Pulsar el fondo oscuro de una hoja lo aclaraba** (K6 lo atenuaba al 60 %). Los fondos de la
  hoja de deportes y de la de filtros no se atenúan.
- **Más controles pequeños llegan a 24 px**, sin tapar lo que se ve del de al lado: los enlaces del
  pie (Informes, Bandeja, Ajustes, Diagnóstico, Glosario, ahora con 8 px entre líneas si se
  parten), «Ver contra qué se ha medido» y las filas de «¿Cuánto fiarse?».
- **En inglés,** el botón decía «See all 7 games» y la cabecera «7 matches»: ahora «See all 7
  matches».

Se queda como está, a propósito:

- **Si los resultados fallan, el interruptor de «Hoy» desaparece y la lista sube 45 px.** Es K3
  al revés: antes saltaba cuando los resultados llegaban bien (lo normal) y no cuando fallaban. Se
  prefiere el caso normal.
- **La primera visita reserva para «Hoy» un alto aproximado.** Las filas miden entre 62 y 101 px
  según lo largos que sean los nombres. Afecta solo a la primera vez; desde la segunda se reserva
  lo medido.
- **La píldora de la barra y el asa de la hoja tienen poco contraste** (1,2:1 y 1,5–1,7:1). Son
  adorno: dónde se está lo dicen la etiqueta (16,7:1 frente a 6,2:1) y `aria-current`, y el asa no
  es un control. En claro, la píldora baja un poco el contraste del icono de color, que ya estaba
  por debajo de 3:1 antes del lote.
- **«Ver los N partidos» se mantiene al cambiar de pestaña** hasta recargar: es el mismo panel en
  todas.

Ya pasaba antes del lote (comparado con bf1066d), y no se toca aquí:

- «Atrás» no devuelve a la altura de la lista. Está en «Fuera de este lote».
- «¿Acertó?» en un perfil nuevo pliega el panel mientras carga.
- A 360 px, «Wolverhampton» se parte por la mitad en «¿Acertó?».
- A 320 y 280 px, la etiqueta «Posible value: …» sale 11 px de la pantalla.
- En inglés, frases que vienen del servidor siguen en español, y hay formatos de número mezclados
  («67.0 %» junto a «88.0%»).

## Fuera de este lote

- **Que «atrás» vuelva exactamente donde se estaba.** Haría falta guardar la posición de cada
  pantalla y restaurarla cuando hayan llegado sus datos. Es independiente de K10, que no lo
  empeora.
