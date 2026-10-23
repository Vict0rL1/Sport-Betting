# Lote M · Pantallas estrechas: nada se sale ni se parte por la mitad (2026-10-19)

Tres hallazgos de la revisión de `ui-tester` del lote K, que ya pasaban antes de K (apuntados en
`docs/plans/fixes-L.md`, «Fuera de este lote»). Cada uno con su test que falla antes, en
`web/e2e/movil.spec.ts`, a 390 px con pantalla táctil y a la anchura de cada caso.

## M1 · Con un perfil nuevo, tocar «¿Acertó?» plegaba el panel

- **Test (falla antes):** sin nada guardado de «Hoy», se toca «¿Acertó?». El panel sigue abierto,
  con «Qué hay hoy» para volver, y al recargar sale igual. Antes se plegaba entero y solo quedaba
  la cabecera, con «Cómo le fue al modelo cargando…».
- **Causa:** sin preferencia guardada, «¿Acertó?» nace plegado (`panelAbierto`), para que la tabla
  de la semana no empuje cada pestaña al cargar. Esa misma regla se aplicaba al cambiar de vista
  con el panel abierto.
- **Arreglo:** cambiar de vista guarda el panel como abierto si no había preferencia. La carga
  siguiente sale como se dejó, y el alto que se reserva coincide con el que tiene.

## M2 · La ficha «Posible value» se salía de la tarjeta

- **Test (falla antes):** a 360, 320 y 280 px, cada ficha «Posible value: …» de Tenis acaba dentro
  de su fila, y la fila dentro de la pantalla. Antes, la de «Alexander Zverev» se pasaba 4 px de su
  fila a 360, y acababa 11 px fuera de la pantalla a 320 y 51 px a 280. La página la cortaba: no
  había desplazamiento lateral, solo la ficha cortada.
- **Arreglo:** la fila de las dos fichas (fiabilidad y value) baja de línea cuando no caben
  juntas. A 390 px también van ya una debajo de otra: antes cabían justas, al píxel.

## M3 · «Wolverhampton» se partía por la mitad en «¿Acertó?»

- **Test (falla antes):** a 360, 320 y 280 px, la palabra «Wolverhampton» ocupa una sola línea, y
  el veredicto se ve una vez. Antes ocupaba dos líneas a 360 («Wolverhampt / on Wanderers») y tres
  a 320.
- **Arreglo:** «ganó» va en la misma línea de texto que el nombre, en vez de ir aparte sin
  encogerse. A 360 px, el nombre pasa de 90 a 140 px. Por debajo de 360 px no bastaba: el nombre
  se quedaba en 100 px a 320 y en 60 a 280, y la palabra mide 102. Ahí, el veredicto («✓ acertó»)
  va debajo, delante de «el modelo dijo…», y el nombre usa su sitio.

## Fuera de este lote

- **En inglés, frases que vienen del servidor salen en español.** Pasa en el titular y los puntos
  de la tarjeta («Lo más probable: gana…»), Confianza, Apuestas y Bandeja, y los números mezclan
  formatos. Esas frases las escribe el servidor, en el `predict.ts` de cada deporte. Arreglarlo
  es mandar los datos para que la web redacte en cada idioma, o mandar las dos frases. Toca la
  predicción de los seis deportes: va en un lote propio, con la revisión de `quant-reviewer`.
