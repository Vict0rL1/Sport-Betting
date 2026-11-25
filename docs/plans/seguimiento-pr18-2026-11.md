# Seguimiento del PR #18: riesgo, explicaciones, Partidos, Rendimiento, importación y avisos (noviembre de 2026)

Encargo: el brief de seguimiento del PR #18 (fases A–G). Este documento sigue la convención de
`revision-pr17-2026-11.md`: plan, matriz, hallazgos confirmados y por verificar, decisiones, pruebas,
revisiones, diferido e informe de entrega. Se actualiza en cada fase.

## Base y relación con el PR #18

- **Verificado el 23-nov, 22:50 UTC.**
  - `main` (local y remoto) está en `c1f95b9` (merge del PR 17).
  - El PR #18 sigue **abierto y sin fusionar**; su cabeza remota es `92339dc` (antes, `0aeafcd`) y no
    tiene conflictos con `main`.
  - Árbol limpio. No hay `AGENTS.md` en el repositorio.
- **Rama de trabajo:** `claude/seguimiento-pr18`, creada desde `92339dc`. Así el PR #18 se puede revisar
  tal como está y este trabajo va encima. Los commits son **locales**: el brief no autoriza empujar,
  fusionar, editar el PR remoto ni desplegar.
- **Migraciones:** el libro mayor llega a la v31 (`avisos-aplazados`). La siguiente sería la v32.

## Fase A: línea base (23-nov, en `92339dc`)

Corrida completa en el commit de partida, el 23-nov entre las 08:12 y las 08:19 UTC. Los registros
están en el scratchpad de la sesión, fuera del repositorio.

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck` | en verde |
| `npm run lint` | en verde |
| `npm test` | servidor 801/801, web 148/148 |
| `npm run build` | en verde |
| `npm run verify:data` | 533/533 |
| `npm run audit` | 6007/6007 |
| `npm run doctor -- --sin-red` | sale con 1: lo esperado aquí (abajo) |
| `npx playwright test --trace off` | 208/208 |
| CI del PR #18 en `92339dc` | 8/8 |

- **El conjunto de datos de `verify:data` y `audit`.** Un `DATA_DIR` temporal:
  - `history.db` es una copia de la release de datos publicada, migrada a la v28 de historia;
  - `ledger.db` lo creó la app el 19-nov, tiene la v31 y **0 apuestas personales**.
  - Nunca `data/`.
- **Por qué el `audit` cambia de un día a otro.** Revisa cada partido próximo dentro de su ventana.
  Con la copia congelada, cada día quedan menos dentro:
  - 31 partidos (6047 comprobaciones) el 21-nov;
  - 21 partidos (6007) el 23-nov a las 08:14 UTC.
  - No es un fallo ni un cambio de código.
- **`doctor`: 2 errores, los dos esperados aquí** (no hay `.env` ni `ODDS_API_KEY`). Sus 8 advertencias
  describen la copia congelada, no el código:
  - la copia del libro mayor es de hace más de 36 h;
  - el bullpen falló al no haber red;
  - el tenis tiene el último resultado de enero;
  - hay predicciones de NFL y NHL sin resultado;
  - el servidor no está arrancado.

### Documentación reconciliada

- **`web/src/lib/dinero.ts` es una COPIA, no una reexportación.** Es idéntica byte a byte a
  `server/src/dinero.ts`, y `web/src/lib/dinero.test.ts` falla si difieren. El comentario de cabecera
  de los dos ficheros decía «reexporta»; ahora dice lo que hay. El CHANGELOG, el plan del PR 17 y la
  descripción del PR #18 ya decían «copia idéntica».
- **Cifras antiguas, etiquetadas con su fecha y su commit**, sin reescribirlas
  (`revision-pr17-2026-11.md`, «Comandos y resultados»):
  - 793/138/203 son de `0aeafcd` (20-nov);
  - 801/148/208 son de `92339dc` (21 y 23-nov).
- **El informe de entrega del 20-nov** decía «G1 en parte» y «sin empujar», y era verdad ese día. Se
  conserva, con una nota: `92339dc` cerró G1 y, después, el propietario pidió empujar.
- **La descripción del PR #18** se quedó en las cifras y los «en parte» de `0aeafcd`. No se edita en
  remoto (el brief no lo autoriza): el texto corregido está abajo, en «Textos de PR».

## Hallazgos: confirmados y por verificar

Las pistas de riesgo del brief, comprobadas en el código de `92339dc`:

| # | Pista | En el código | Llamadores activos | Estado |
| --- | --- | --- | --- | --- |
| R1 | `profitOf` calcula con coma flotante | `staking/policy.ts` `profitOf` | `lossState` → cartera personal | Confirmado en el código; reproducción en B |
| R2 | Un cashout sin importe cuenta como beneficio 0 | `(payout ?? stake) - stake` | íd. | Confirmado en el código; reproducción en B |
| R3 | `lossState` suma todas las monedas | `SELECT … FROM bets` sin moneda | `/api/staking/book`, `decideBook`, `scripts/staking.ts` | Confirmado en el código; reproducción en B |
| R4 | `pendingExposure` y `exposureBreakdown` suman todas las monedas | íd. | `decideStake` (puerta 6), `decideBook` | Confirmado en el código; reproducción en B |
| R5 | `lossState` cuenta por `placed_on` (día de colocación) | `WHERE placed_on >= lunes` | íd. | Confirmado en el código; reproducción en B |
| R6 | El banco de papel y las estrategias cuentan por `settled_at` | `perdidasRealizadas` | `paper/bankroll.ts`, `estrategias/index.ts` | Confirmado: dos reglas distintas para lo mismo |
| R7 | Los cortes de día y semana usan la hora del servidor | `getFullYear()`/`getDate()` en `lossState` y `perdidasRealizadas` | todos los anteriores | Confirmado en el código; reproducción en B |

Además, vistos al trazar los llamadores:

| # | Hallazgo | Estado |
| --- | --- | --- |
| R8 | `settled_at` es **cuándo la app registró** la liquidación, no cuándo ocurrió. `createBet` pone «ahora» a una apuesta que entra ya liquidada (también cada fila de un CSV), y `updateBet` lo vuelve a poner en cualquier cambio de estado (también al corregir «ganada» a «perdida»). | Confirmado en el código |
| R9 | El tope por día de `decideBook` compara el día del PARTIDO de la candidata con lo pendiente agrupado por día de COLOCACIÓN. Una apuesta del viernes para el sábado cuenta en el viernes. | Confirmado y reproducido (89,97 € el sábado contra 60 € de tope); arreglado en B |
| R10 | Sin cruce entre bancos: el banco de papel y las estrategias pasan su propia exposición y sus propias pérdidas (`openExposure`, `perdidas`) y no leen `bets`. Solo la cartera personal lee el registro personal. | Verificado: no hay defecto |
| R11 | La reproducción histórica de estrategias pasa `hoy: 0`: el límite diario no actúa al reproducir. | Comportamiento existente de la estrategia; se documenta y no se cambia |
| R12 | El banco de la cartera (`ExposurePanel`) es un número en `localStorage` sin moneda; el banco personal de Ajustes (`bancoPersonal`) tampoco tiene moneda. | Confirmado |

## Matriz

| Id | Requisito | Estado | Prueba |
| --- | --- | --- | --- |
| A | Base verificada, línea base real, documentación reconciliada | Hecho | este documento; `web/src/lib/dinero.test.ts` |
| B1 | Contrato de contabilidad del riesgo escrito | Hecho | cabecera de `staking/contabilidad.ts`; «Decisiones» abajo |
| B2 | Dinero exacto en los límites y la exposición | Hecho | `staking/riesgo.test.ts` (R1), `staking/contabilidad.test.ts` (cada estado, decimales de más) |
| B3 | Monedas separadas en todo cálculo de riesgo | Hecho | `riesgo.test.ts` (R3, R4, punta a punta), `contabilidad.test.ts` (monedas, exposición) |
| B4 | Cálculo incompleto explícito (cuatro estados) | Hecho | `contabilidad.test.ts` (cotas, decisión), `e2e/seguimiento-pr18.spec.ts` (B) |
| B5 | Fronteras e integración probadas | Hecho | `riesgo.test.ts` (R5, R7, R8), `contabilidad.test.ts` (igualdad, ±1 céntimo, cambio de hora, zona inválida), `paper/perdidas.test.ts` (sin cruces) |
| C | Explicaciones estructuradas y bilingües, siete deportes | Hecho en los siete deportes (24-nov), salvo el texto del motor de confianza. Hechos: NHL, UFC y NFL (la tarjeta, y la lectura y los factores de la ficha), el tenis entero (C 2), el fútbol (C 3), el baloncesto y el béisbol (C 4), y en la ficha común lo que usó el modelo, el «¿Y si…?», qué mueve la probabilidad y el aviso (C 5). Falta: el texto del motor de confianza (ver «Diferido») | `web/src/i18n/explicaciones.test.ts`, `server/src/explicaciones/coherencia.ts` en `nhl/publicada.test.ts`, `ufc/publicada.test.ts` y `prediction/formatoTexto.test.ts` |
| D | Jerarquía visual y móvil | Hecho (24-nov) lo que salió de la auditoría de ui-tester: la fila de Partidos, el panel de lo más probable en el móvil, las zonas de toque, el error de NHL y UFC y, de la pasada final (25-nov), el nombre del grupo a 320 px. Sin hacer: las insignias de las tarjetas, la carga, la fila de deportes a 320 px y el panel lateral (ver «Diferido») | `e2e/partidos.spec.ts` (D, cinco), `e2e/seguimiento-pr18.spec.ts` (D, tres), `e2e/movil.spec.ts` (K4 y K12) |
| E | Calibración y rendimiento en el tiempo | Hecho (24-nov), con las definiciones de quant-reviewer. El corte del gráfico de deriva de siempre, hecho el 25-nov. Sin hacer: el panel del favorito (opcional) y los pendientes por periodo (ver «Decisiones», E) | `server/src/evaluation/calibracion.test.ts` (17), `calibracion.rutas.test.ts`, `e2e/seguimiento-pr18.spec.ts` (E, dos) |
| F | Vista previa de la importación CSV | Hecho | `server/src/bets/importar.vista.test.ts`, `e2e/seguimiento-pr18.spec.ts` (F) |
| G | Fiabilidad de los avisos | Hecho | `server/src/notifications/entrega.test.ts`, `server/src/db/v32.test.ts`, `notifications/silencio.test.ts` |

## Decisiones

### B. El contrato de la contabilidad del riesgo (`riesgo-v1`, `server/src/staking/contabilidad.ts`)

- **Banco.** Dinero de UNA moneda (EUR, USD o GBP) y sus apuestas. Hay tres clases de banco y no se
  cruzan:
  - el registro personal (`bets`) en esa moneda;
  - el banco de papel (`paper_bets`);
  - cada estrategia (`strategy_bets`).
  El papel y las estrategias pasan a la decisión su propia exposición y sus propias pérdidas.
- **La moneda del banco de la cartera.** La define la propia cartera (`ExposurePanel`): importe y
  moneda, juntos, en este navegador, como ya lo era el importe. No es un filtro de vista. La API la
  recibe explícita (`/api/staking/book?moneda=`).
  - Sin ella, ninguna apuesta personal se atribuye al banco. Si hay alguna en la semana, los límites
    quedan sin evaluar.
  - Nunca se toma la moneda de un filtro de Mis apuestas, ni se supone para las apuestas sin moneda.
- **Qué mide un límite:** la PÉRDIDA NETA REALIZADA, igual que antes. Es la suma de los beneficios,
  positivos y negativos, de lo liquidado en el periodo. Una nula o un push suman 0.
  - Se mide en céntimos, con `dinero.ts`, el mismo pago que el registro y la exportación.
  - El límite es −⌈banco × %⌉ en céntimos, redondeado una vez. Con pérdidas en céntimos enteros,
    «pérdida ≥ ⌈banco × %⌉» es exactamente la comparación de antes, «pérdida ≥ banco × %». Al principio
    se redondeó hacia abajo, que era un céntimo más estricto; la revisión quant lo corrigió.
  - Se alcanza con una pérdida neta igual o mayor, como antes.
  - Los porcentajes no cambian: 5 % diario y 10 % semanal por defecto, o los de la política versionada.
- **Día.** El día en que se LIQUIDÓ, en la zona de la política. Antes contaba el día de colocación: una
  apuesta del domingo perdida el lunes se perdía el domingo. `settled_at` es cuándo la app registró la
  liquidación:
  - pasó de pendiente a liquidada en la app → ese día;
  - entró ya liquidada (a mano o por CSV) → algún día entre la colocación y el registro. Si son el
    mismo día, ese. Si no, **no se inventa**: ni la colocación ni el registro;
  - liquidada sin `settled_at` (solo editando la base a mano) → algún día desde la colocación.
  - Corregir el resultado de una apuesta ya liquidada ya no mueve su `settled_at` (R8).
- **Zona y semana.**
  - La zona es APP_TIMEZONE o, si no está, la del servidor: la de los informes.
  - Una APP_TIMEZONE mal escrita deja los límites sin evaluar; no cae a otra zona en silencio. Y se
    avisa: `npm run doctor` da un error y el servidor lo registra al arrancar. Sin esto, el banco de
    papel y las estrategias se paraban sin que nada lo dijera.
  - La zona de visualización de la web no mueve un límite.
  - La semana va de lunes a domingo en esa zona.
  - La fecha de colocación por defecto también es «hoy» en esa zona.
- **Lo que no se sabe, con cotas.** Cada apuesta con un dato desconocido aporta un intervalo, no un
  número. Son la moneda nula, el día de liquidación desconocido, el cashout sin importe, el estado
  desconocido y el importe ilegible.
  - `alcanzado`: también en el mejor caso.
  - `por-debajo`: también en el peor.
  - `sin-evaluar`: depende de lo que no se sabe.
  - Así un dato que falta nunca es 0 y, si no cambia el veredicto, tampoco bloquea. Lo desconocido se
    cuenta y se enseña (`incidencias`).
- **Cuatro estados, distintos en la API y en la pantalla:**
  - completo y por debajo;
  - límite alcanzado: `blockedBy` «límite de pérdida DIARIA/SEMANAL alcanzado»;
  - sin evaluar: «límites de pérdida sin evaluar: falta información», y la cartera dice qué falta;
  - sin apuestas que contar: `apuestas: 0`.
  - «Sin evaluar» NUNCA devuelve un importe positivo.
- **Exposición pendiente:** en céntimos, por moneda. Lo de otra moneda no cuenta. Para los topes se usa
  la cota de arriba: lo de la moneda del banco más lo sin moneda, que podría ser suyo. Como un bote sin
  moneda, si es del banco, está en la moneda del banco, esto no mezcla unidades. Un importe ilegible no
  tiene cota: la puerta 6 no apuesta, y la cartera lo enseña como «sin cota» y no como 0.
  - **Por día, el día del PARTIDO** (R9). Es el de la instantánea enlazada, con la misma convención
    que las candidatas: la fecha UTC del inicio.
  - Lo pendiente sin día de partido conocido (la mayoría de las apuestas a mano) cuenta en el tope de
    CUALQUIER día, porque puede jugarse en cualquiera. Así el tope diario nunca se pasa por no saber
    el día; a cambio, es más estricto, y la cartera lo dice en una nota.
  - Antes contaba el día de colocación, que es inventar el día del partido.
- **Banco de papel y estrategias:** la misma zona y la misma semana, en céntimos.
  - **Cambio de comportamiento a sabiendas.** Si APP_TIMEZONE no es la zona del servidor, el corte del
    día del banco de papel y de las estrategias pasa de la hora del servidor a la de APP_TIMEZONE, también
    para versiones de política ya guardadas (`policy_version_id`). Es el mismo calendario para todos los
    bancos (R7). Sin APP_TIMEZONE, nada cambia.
  - Un beneficio que falta, en una liquidación de la semana, deja el periodo sin evaluar en vez de
    contar 0. `settle()` nunca lo deja nulo, así que no cambia nada en una instalación sana.
  - Su día ya era el de liquidación.
- **API.** `/api/staking/book` recibe `moneda`, devuelve `moneda`, `contrato` y `exposicion` (segura y
  máxima), y `loss` lleva `evaluable` y `estado`.
  - Un banco ilegible o una moneda desconocida dan 400, con código. Antes, un banco ilegible se cambiaba
    por 1000 en silencio.
- **verify:data** comprueba las puertas y los topes sin leer las apuestas personales de la instalación
  que verifica. Antes dependían de ellas.

### C. Las explicaciones, estructuradas (`server/src/explicaciones/`)

- **Qué había.** Cada deporte escribía como frases en español:
  - el titular y las viñetas (`summary`);
  - los avisos de fiabilidad (`reliability.reasons`);
  - en la ficha, la «lectura» (`reasoning.text`) y las etiquetas de los factores.
  La web las pintaba tal cual, también en inglés. Son unos 110 sitios en los siete deportes.
- **Cómo queda.** Cada frase es un CÓDIGO estable con PARÁMETROS tipados:
  - `txt`: nombres, tal cual;
  - `int`: enteros sin miles, como un Elo;
  - `num` y `signo`: decimales fijos;
  - `pct`: probabilidad;
  - `lista`: nombres unidos con «y» o «and»;
  - `miles`: con separador de miles.
- **Catálogo del servidor** (`catalogo.ts`), sin imports. El servidor sigue escribiendo la frase en
  español con él, así que la API conserva `bullets`, `reasons`, `text` y `label`, y gana
  `explicaciones` al lado (compatibilidad con clientes, el asistente y los informes).
  - Cambio cosmético: el «%» y los rangos llevan espacio duro, el formato de `numeros.ts`, en vez del
    espacio normal de algunos deportes.
- **La web** (`web/src/lib/explicacion.ts`):
  - escribe `explica.<código>` con su catálogo y los formatos del idioma;
  - con un código desconocido, o sin código, enseña la frase del servidor, nunca una clave;
  - un párrafo con una pieza desconocida sale entero del servidor.
- **Coberturas.**
  - `es.ts` lleva la misma frase que el servidor;
  - `en.ts` la traduce con los mismos parámetros;
  - no hay claves `explica.*` sin código;
  - en español, la web escribe exactamente la frase del servidor;
  - en cada deporte estructurado, cada frase de la API es la escritura de su código (`coherencia.ts`).
- **No cambia ningún número.** Se escribe lo que el modelo ya calculó, y un dato que falta elige otro
  código o no se dice.
- **Probabilidad, frescura y evidencia** siguen separadas como ya lo estaban:
  - el titular dice la probabilidad;
  - los avisos de fiabilidad hablan de la muestra y de lo que el modelo no sabe;
  - la evidencia histórica vive en Rendimiento.
  - No se añade ninguna «confianza alta» nueva.
- **DESCONOCIDO.** CLAUDE.md lo fija como el valor de lo que falta, y el brief del PR 17 admitía «su
  equivalente localizado» al enseñarlo. Las explicaciones estructuradas no lo usan. Queda como estaba en
  las fichas (término fijo); no se cambia aquí.

### Orden de trabajo (decisión del 24-nov)

Después de la fase C (1) se hicieron F y G antes que el resto de C. Las dos tocan la integridad del libro
mayor (qué entra al importar) y la honradez de lo que la app afirma («enviado»), y una pista sin hacer ahí
pesa más que cuatro deportes aún en español, que tienen reserva: la frase del servidor. El mecanismo de C
ya está y el resto de deportes es mecánico.

Después de empujar la primera tanda, el propietario pidió seguir con lo que quedaba. Orden de la segunda
tanda:
- el resto de C, deporte a deporte (C 2 a C 4) y luego la ficha común (C 5);
- E, con las definiciones de quant-reviewer antes del código;
- D al final: sale de una auditoría en el navegador hecha sobre la web ya cambiada por C y E.

### F. La importación por CSV, transparente (`server/src/bets/importar.ts`)

- **Lo que había.**
  - Se importaba a ciegas: la persona solo sabía después qué había entrado.
  - Las filas que pasaban de 1.000 se ignoraban sin decirlo.
  - El `settled_at` exportado se tiraba, y un histórico importado dejaba la semana de los límites «sin
    evaluar».
  - Una fila con `snapshot_id` perdía el enlace sin aviso.
- **La vista previa** (`POST /api/bets/import/preview`, `analizarCsv`) NO escribe. Dice:
  - qué filas entrarían y cuáles no, con la línea, el campo y un código que la web traduce;
  - qué columnas no se leen;
  - qué filas pasan del límite;
  - los avisos de cada fila válida.
- **Importar vuelve a leer y validar todo desde cero**, con la misma función: lo que dijo la vista previa
  es lo que hace, y una vista previa no autoriza nada.
- **Avisos** (no impiden importar):
  - `enlace-no-restaurado`: la fila traía `snapshot_id`. Un id de instantánea es de su instalación; aquí
    nunca se engancha, ni a otra con el mismo número, ni a una inventada. La frase que se enseña es la
    del brief: «La apuesta se puede importar, pero su enlace a la estimación original no se puede
    restaurar».
  - `posible-duplicado`: la regla documentada.
    - Es idéntica a una apuesta guardada o a otra fila del fichero en fecha de colocación, deporte,
      evento, mercado, selección, cuota, importe, moneda y estado, ya validados (1,90 y 1.9 son lo mismo).
    - Se avisa y NO se descarta: dos apuestas iguales pueden ser legítimas.
    - No se intenta adivinar por una combinación más laxa.
  - `dia-de-liquidacion-desconocido`: liquidada, sin `settled_at` y colocada antes de hoy. Los límites de
    pérdida no sabrán qué día se liquidó (fase B).
- **`settled_at` del CSV.** Se acepta solo si es un instante ISO CON zona (`…Z` o `…±hh:mm`, como lo
  escribe la exportación), de una liquidada, no futuro y no anterior al día de colocación en la zona de
  la política.
  - Una fecha a secas, `05/11/2026` o una hora sin zona no se adivinan: la fila se rechaza con su código.
  - Si el CSV dice que la apuesta entró ya liquidada en su instalación (`created_at` = `settled_at`), su
    día no se sabía y sigue sin saberse: no se guarda esa fecha, y se avisa.
  - La API no lo acepta en el cuerpo: solo lo pasa el importador.
- **La web** (`ImportarCsv`): pegar o elegir el fichero → «Revisar» → resumen, filas rechazadas con su
  error en el idioma y avisos → «Importar N».

### G. La entrega de los avisos, dicha como es (`server/src/notifications/index.ts`)

- **El defecto.** Lo aplazado por las horas de silencio se borraba de la cola y contaba como «enviado»
  aunque TODOS los canales lo rechazaran (un 503, un token caducado): el fallo se volvía éxito y el aviso
  se perdía. Tampoco había reintentos. Reproducido en `entrega.test.ts`.
- **Ahora:**
  - **«Enviado» = aceptado por al menos un canal.** «Aceptado», porque ningún proveedor confirma que la
    persona lo vio. La pantalla de prueba dice «aceptada por el canal».
  - **Si ninguno lo acepta**, se queda con su intento y su error (v32: `attempts`, `last_error`) y se
    reintenta con espera (5, 10, 20, 40 min), hasta 5 intentos o hasta que caduque.
  - **Un 4xx que no sea 408 ni 429 es definitivo** y no se reintenta.
  - **Lo descartado queda anotado**, igual que lo caducado y lo que no cabe en la cola.
  - **Al menos una vez, no «exactamente una vez».** Se envía y después se quita. Una caída entre medias,
    o una copia restaurada de antes del envío, lo repite. El webhook lleva la misma `Idempotency-Key`
    (un resumen, sin contenido) en cada intento del mismo aviso. Telegram, el correo y Web Push no la
    admiten.
  - **Lo que ya estaba y se comprobó:**
    - la cola sobrevive a un reinicio (está en la base);
    - lo caducado no se envía;
    - con los canales apagados, se queda y caduca anotado;
    - la misma clave, la última versión;
    - el tope de 200;
    - el cambio de hora de la ventana (`silencio.test.ts`).
- **v32 `intentos-de-avisos`.** Columnas nuevas con valor por defecto, aditiva e idempotente, probada:
  sube desde v31 con avisos dentro, se reaplica y la instalación nueva ya las tiene.
- La garantía, para quien opera, está en `docs/NOTIFICACIONES.md`.

### E. Calibración y rendimiento en el tiempo (`server/src/evaluation/calibracion.ts`)

Las definiciones las fijó quant-reviewer ANTES de escribir código, sobre el código de `6a3edd2` (los
casos que lo reproducen están en sus scripts de la revisión).

- **Qué estaba mal, confirmado.** El diagrama de fiabilidad (`evaluation/reliability.ts`) cuenta cada
  SALIDA como una observación: tres por partido en el fútbol, y dos espejadas en los binarios (la
  cubeta i es la 9 − i).
  - Con 50 partidos al 50 % que ganó siempre el local, sale «perfecto».
  - Un sesgo hacia el local no se ve.
  - Además mezcla registrada y legado y todas las versiones.
- **Qué NO se toca.** Ese diagrama, su ECE y `/api/monitoring` se calculan como antes, porque de ellos
  cuelgan el PSI y la alerta de deriva. Solo cambian sus rótulos: «por salida» y «deriva del modelo,
  cifra cruda al publicar».
  - **Una excepción**, de la revisión de quant-reviewer (ver «Revisiones», fase E). En el fútbol, una
    publicación cuya suma se aparta de 1 en más de 0,001 ya no se renormaliza: se excluye, también en
    estos dos y en lo demás que lee `predicciones()` (segmentos, la evaluación en vivo, los informes y
    `doctor`).
  - Las bien formadas dan lo mismo: el registro guarda cinco decimales y suman 0,99999.
  - La copia de datos de las pruebas no tiene filas de fútbol, así que no se ha visto ningún cambio en
    ella.
  - Los multiplicadores de importe salen de `trust/drift.ts`, que lee las publicaciones tal cual
    (`publicacionesResueltas`) y no cambia. Ni el banco de papel, ni las estrategias, ni los
    destacados leen estas cifras.
  - No se reejecuta ningún backtest.
  - No se lee ningún holdout.
- **La fuente.** `prediccionesConMotivos` (`evaluation/live.ts`): pre-partido, resueltas, evaluadas
  con `final-congelada-v1`, y cada exclusión con su motivo.
- **E1 `calibracion-partido-v1`.**
  - **Cohortes.** Registrada (por defecto) y legado, en paneles distintos y nunca juntas. Lo
    reconstruido NO entra: reproduce temporadas que pueden ser de reserva.
  - **Unidad.** Un partido por panel. En los binarios, la probabilidad del local (o del jugador 1, o
    del luchador A). En el fútbol, tres paneles: local, empate y visitante, sin sumar sus n.
  - **Cubetas.** 10 fijas, con índice `min(9, ⌊10p + 1e-9⌋)`. Wilson al 95 %. Con menos de 30
    partidos no se dibuja la cubeta (su n sí se enseña); de 30 a 99, orientativa.
  - **Conjunto.** Calibración en grande (z = (Σy − Σp)/√Σp(1 − p)), que ve el sesgo, y Spiegelhalter,
    que ve el exceso o el defecto de confianza.
  - **Veredicto.**
    - Con menos de 100 partidos, «insuficiente».
    - Si no, «descalibrado» cuando cualquiera de los dos pasa de z* = Φ⁻¹(1 − 0,05/2m), con m = 2 por
      panel (2,2414 en binarios, 2,6383 en el fútbol).
    - Si no, «sin evidencia», nunca «calibrado».
    - No hay veredicto por cubeta: con 10 cubetas, una falsa alarma sale el 40 % de las veces.
- **E2 `rendimiento-periodo-v1`.**
  - **Métrica.** Brier como en `metrics.ts` (Σ(p − y)²/2): menos es mejor, y la referencia uniforme es
    0,25 o 1/3. Se puntúa la probabilidad evaluada, nunca `pModelo`.
  - **Periodos.** Mes por defecto, o semana ISO, calendario fijo y sin ventana móvil. El día es el del
    inicio del partido en la zona de la política; con una `APP_TIMEZONE` inválida no hay serie
    (`zona-invalida`).
  - **Grupos.** Una serie por cohorte y versión evaluada (sin versión, su propio grupo). Se emiten
    todos los periodos del primero al último; los vacíos, sin valores.
  - **Por punto.**
    - n, Brier con media ± 1,96·sd/√n, log loss y mezcla de ligas.
    - La comparación con el mercado en los MISMOS partidos.
    - Con menos de 30, sin valores; de 30 a 99, insuficiente; de 100 a 499, orientativa.
  - **Titular.** La media de la serie (= la media de los puntos pesada por n), sin cifra por debajo de
    100. Ninguna frase de tendencia, ninguna «versión mejor», nada de dinero.
  - **Exclusiones.** Por periodo y motivo, aparte: no son de ninguna versión.
- **Una sola fuente para todo.** El gráfico, la tabla, el desglose (`/api/evaluation/rendimiento/partidos`)
  y la exportación (`evaluadas`) salen de `filasEvaluadas`.
- **Sin hacer, por alcance:**
  - el panel del favorito (opcional en la revisión);
  - los partidos pendientes por periodo;
  - la mezcla de versiones de calibración;
  - cortar en `MIN_VENTANA` el gráfico de deriva de siempre, que solo se rotula.

### D. Jerarquía visual y móvil

Sale de una auditoría de ui-tester en el navegador (24-nov, sobre la fase E sin confirmar), a 1280, 390
y 320 px, en claro y oscuro. Con los datos de entonces solo había partidos próximos de NFL y NHL. Cada
arreglo tiene antes un test de Playwright que fallaba por el motivo del hallazgo.

- **La fila de Partidos** (`components/partidos/FilaPartido.tsx`).
  - Los nombres se parten en líneas (`break-words`), sin `truncate` ni `title`. Se descartó un tope de
    dos líneas: un nombre cortado sigue sin leerse en un móvil.
  - La probabilidad del favorito a 18 px y la del resto a 15, como los nombres. El tamaño sube solo en
    la del favorito, que es la cifra que se busca.
  - El enlace mide como mucho 38 rem (608 px): a 1280 px, los números quedaban a unos 700 px de los
    nombres.
  - «›» al final de la fila, dentro del enlace y `aria-hidden`: el nombre accesible del enlace no
    cambia.
- **El panel de lo más probable** (`components/ui/picks.tsx`).
  - En el móvil (`MOVIL`, `lib/useMediaQuery.ts`) empieza cerrado; en el escritorio, abierto, como
    antes. El estado inicial se lee una vez: girar el teléfono no lo cierra.
  - Las columnas «Mercado» y «Dif.» se quitan solo si NINGUNA fila tiene precio de mercado, y «Pago si
    gana» solo si ninguna tiene cuota. Si una fila lo tiene, las demás siguen con «—», que es lo que
    se sabe de ellas.
- **Zonas de toque.** `min-h-6` (24 px, el mínimo de WCAG 2.2, 2.5.8) en los siete controles medidos.
  En las pantallas táctiles `toque` ya las agrandaba; ahora miden 24 px también con ratón.
- **NHL y UFC con error.** El vacío («No hay partidos próximos…, es normal entre temporadas») sale solo
  si la petición fue bien.
- **El texto del error no cambia.** Las páginas de los siete deportes dicen la frase del catálogo y,
  detrás, la causa técnica («Error: /meta → HTTP 500»). En una app de un solo operador, esa causa es
  lo que dice qué falló; quitarla escondería un dato. Partidos, que junta siete fuentes, lo dice sin
  ella.
- **No se cambió (hallazgo 6).** En «Destacados», «Añadir a mi selección» sigue siendo el botón
  principal y «Abrir partido» el enlace: añadir a la selección es el trabajo de esa página. El enlace
  sí sube a 24 px.

## Revisiones y su destino

### Fase B

- **quant-reviewer.** Contrato correcto y dinero idéntico a `bets.ts`:
  - un oráculo aleatorio, sobre 4.000 casos, 8.000 periodos y cuatro zonas, no encontró ningún
    veredicto falso;
  - parámetros, Kelly, topes y porcentajes, sin cambiar.

  | # | Sev. | Hallazgo | Destino |
  | --- | --- | --- | --- |
  | 1 | Medio | R9: aplazarlo en silencio inventaba el día del partido | Arreglado: día del partido de la instantánea o, si no se sabe, en el tope de cada día; nota en la cartera (`riesgo.test.ts`, R9) |
  | 2 | Medio | Una APP_TIMEZONE mal escrita paraba el papel y las estrategias sin alarma | Arreglado: error en `doctor` (`doctor/checks.test.ts`) y al arrancar |
  | 3 | Bajo | El corte del día del papel y de las estrategias cambia bajo políticas ya guardadas | Documentado arriba («Cambio de comportamiento a sabiendas») y en el CHANGELOG |
  | 4 | Bajo | ⌊⌋ era un céntimo más estricto que antes | Arreglado: ⌈⌉ (`contabilidad.test.ts`, 1234,56 €) |
  | 5 | Bajo | Lo en juego sin cota salía como 0 | Arreglado: `used: null` y `sinCota` en la API, «sin cota» en la cartera |
  | 6 | Info | Lo liquidado sin `settled_at` tiene un intervalo hasta «nunca» | Correcto y holgado; solo afecta a filas editadas a mano. Sin cambio |
  | — | — | El ejemplo ilustrativo de `npm run staking` leía el registro personal | Arreglado: contexto inventado, como verify:data |

- **data-guardian.** Nada bloqueante:
  - `bets` no tiene disparadores;
  - no hay migración nueva;
  - ninguna fila inmutable se toca.

  | # | Sev. | Hallazgo | Destino |
  | --- | --- | --- | --- |
  | 1 | Bajo | Liquidada sin `settled_at` y corregida: se ponía «ahora» | Arreglado: solo pendiente → liquidada pone la hora (`riesgo.test.ts`, R8b) |
  | 2 | Bajo | La importación ignora el `settled_at` exportado | Fase F |
  | 3 | Bajo | `today()` dependía del formato `en-CA` | Arreglado: `local()` (formatToParts) |
  | 4 | Info | Las apuestas corregidas ANTES de este cambio ya tienen la hora de la corrección | No se puede arreglar sin inventar una fecha. Se documenta |
  | — | Info | `liquidadasPersonales` recorre la tabla entera | 8–10 ms con 100.000 filas, una vez por petición: aceptable, sin índice |

### Fase F

- **data-guardian.** Nada engancha una instantánea, la importación vuelve a validar cada fila, y la ida y
  vuelta conserva eventos, etiquetas, notas con comillas, celdas con apóstrofo y `settled_at`.

  | # | Sev. | Hallazgo | Destino |
  | --- | --- | --- | --- |
  | 1 | Alto | `Date.parse` aceptaba `2026-11-21`, `2026`, `05/11/2026` o una hora sin zona, y los límites de pérdida se fiaban del día que salía (en Nueva York, una fecha a secas caía el día antes de colocarse) | Arreglado: solo instantes ISO con zona; si no, `importar.liquidacion-sin-zona` (`importar.vista.test.ts`) |
  | 2 | Medio | La ida y vuelta convertía un día desconocido (entró ya liquidada) en uno conocido | Arreglado: con `created_at` = `settled_at` no se guarda la fecha y se avisa |
  | 3 | Bajo | El límite inferior no miraba la zona de la política | Arreglado: el día de liquidación en esa zona, no antes del de colocación |
  | 4 | Bajo | El aviso de duplicado fallaba con el estado o la moneda cambiados | Arreglado: la huella sin estado ni moneda |
  | 5 | Bajo | Leer todas las apuestas: 0,3–0,4 s con 100.000 | Arreglado: solo las de las fechas de colocación del fichero (`idx_bets_day`) |
  | 6 | Info | Cada fila se guarda por separado (como antes): una caída a media importación deja una parte | Se mantiene. Al reimportar, los avisos de duplicado lo dicen |

- **security-reviewer (fase F).**
  - Comprobado y bien:
    - la vista previa va detrás de la autenticación, del control de origen y del interruptor;
    - 413 por encima de 256 KB, y 400 y no 500 con cuerpos raros;
    - nada se inyecta en la web: todo son nodos de texto;
    - consultas con parámetros;
    - `settled_at` no se puede fijar por la API.
  - Un hallazgo bajo: una cabecera de 110.000 columnas bloqueaba el proceso 1,8 s y la respuesta las
    devolvía todas. Arreglado en `d67c46c`: el mapa de columnas se hace una vez y se devuelven 50
    nombres como mucho.

### Fase G

- **data-guardian.** v32 es aditiva e idempotente:
  - en el libro mayor separado (el nombre sin calificar va a `ledger.notification_pending`), en un solo
    fichero y en una instalación nueva;
  - no pide nada a la copia ni a la restauración;
  - ninguna fila inmutable se toca;
  - `resumenEnvios` y el doctor cuentan bien.

  | # | Sev. | Hallazgo | Destino |
  | --- | --- | --- | --- |
  | 1 | Bajo | Si mientras se enviaba v1 llegaba v2 con la misma clave, quitar v1 borraba v2 sin enviarla (o v2 heredaba los intentos de v1) | Arreglado: borrar y reintentar por clave y versión (`created_at`) (`entrega.test.ts`) |
  | 2 | Bajo | Una versión nueva heredaba los intentos de la vieja y podía descartarse tras un solo intento | Arreglado: el upsert pone `attempts = 0` y `last_error = NULL` |
  | 3 | Info | El resumen del trabajo no decía reintentos ni descartes; la nota de caducada no decía el último error | Arreglado |

- **security-reviewer.**
  - Comprobado y bien:
    - los reintentos tienen tope (un 429, cinco intentos);
    - un 404 se descarta a la primera;
    - `Idempotency-Key` es un resumen de 32 caracteres hexadecimales, sin contenido y sin inyección de
      cabeceras;
    - el token de Telegram no se cuela en los errores;
    - «aceptada por el canal».
  - Un hallazgo bajo, anterior a este trabajo y que este trabajo extendía: un `WEBHOOK_URL` con
    `usuario:contraseña@` o un token en la ruta acababa entero en el mensaje de error, y de ahí en
    `notification_log`, en `last_error` y en las notas. Arreglado: `sinSecretos` quita los valores
    configurados (`WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, `SMTP_PASS`, `SMTP_USER`, `VAPID_PRIVATE_KEY`) y
    cualquier `//usuario:contraseña@` antes de guardar o devolver un error, también en «probar»
    (`entrega.test.ts`).
  - Lo que ya estaba guardado no se reescribe: el registro solo se añade.

### Fase E

- **quant-reviewer, diseño (antes del código).**
  - Confirmó el defecto del diagrama de fiabilidad y dio sus repros.
  - Cambió cuatro decisiones de mi propuesta:
    - la unidad «solo el favorito», que esconde el sesgo hacia el local y el empate;
    - la semana ISO por defecto, que se queda sin muestra en 4 de 7 deportes;
    - lo reconstruido «aparte», que pasa a excluido por holdout;
    - un juicio de conjunto por ECE, cuyo valor esperado con 100 partidos perfectos es 0,093.
  - Todo está aplicado: ver «Decisiones», E.
- **quant-reviewer, implementación.**
  - Comprobado y bien:
    - las definiciones, z* y los bordes de cubeta;
    - las semanas de 169 y 167 h con el cambio de hora;
    - `/api/evaluation/reliability` y `/api/monitoring` idénticos a los de antes, en una base real;
    - nada importa la reconstrucción.

  | Sev. | Hallazgo | Destino |
  | --- | --- | --- |
  | Medio | El desglose mezclaba filas de varios puntos si no llegaban la cohorte y la versión | Arreglado: las pide (400 si no) (`calibracion.revision.test.ts`) |
  | Medio (anterior) | En el fútbol, una publicación que no suma 1 se renormalizaba antes de la política de evaluación y se puntuaba, mientras que la exportación `predicciones` la excluía | Arreglado en `live.ts`: va tal cual a la política y se excluye como `publicacion-invalida` (test con base real). Las bien formadas dan lo mismo. Queda la tercera vía, «¿Acertó?» (`today.ts`), en «Diferido» |
  | Bajo-medio | El conjunto de un panel daba lo observado y las pruebas con cualquier n (3 partidos: «pasó el 100 %») | Arreglado: nada observado por debajo de 30 ni pruebas por debajo de 100 |
  | Bajo-medio | Un formateador de fechas por fila: más de 1 s con 20.000 filas en cada carga | Arreglado: uno por zona |
  | Bajo | Las exclusiones se pueden asignar a una cohorte por su motivo | Arreglado (`cohorteDeMotivo`); a una versión, no, y así se dice |
  | Bajo | Las exclusiones se repetían en cada tabla y no salían si no había series | Arreglado: una vez por sección |
  | Bajo | Un periodo cortado por `desde`/`hasta` no lo decía | Arreglado: `recortado` y los límites del filtro |
  | Bajo | La exportación no avisaba con una zona inválida y no traía los excluidos | Arreglado: `aviso`, y filas con `motivo_exclusion`. Que aquí `desde`/`hasta` son días locales, documentado |
  | Bajo | «Sin evidencia» no nombraba el umbral corregido, junto a un intervalo al 95 % | Arreglado en el texto |
  | Bajo | El gráfico de deriva de siempre dibuja puntos con n ≥ 1, y no hay pendientes por periodo | El gráfico, arreglado el 25-nov: no dibuja los días cuya ventana no llega a `umbrales.minVentana` y lo dice (`seguimiento-pr18.spec.ts`). Los pendientes, diferidos |

  También se añadieron los tests que faltaban: base real, la reconstrucción y el holdout fuera, y el
  desglose con dos versiones.



### Fase D: auditoría de ui-tester (24-nov)

| # | Sev. | Hallazgo | Destino |
| --- | --- | --- | --- |
| 1 | Medio | Partidos a 320 px: los nombres se cortaban y solo se leían con el ratón encima (103 de 134); a 390 px, «Washington Commanders» | Arreglado: se parten en líneas (`partidos.spec.ts`, 320 y 390 px) |
| 2 | Medio | Partidos: la probabilidad no destacaba (15 px, como los nombres) y a 1280 px quedaba a unos 700 px de ellos. La fila no dice qué resultado se espera; solo la cabecera | Arreglado lo primero: 18 px el favorito y la fila con tope de ancho (`partidos.spec.ts`). Lo segundo, diferido |
| 3 | Medio | Partidos: nada visible decía que la fila se abre | Arreglado: «›» al final (`partidos.spec.ts`) |
| 4 | Medio | NHL y NFL a 390 y 320 px: el panel de lo más probable, abierto, medía unos 1.830 px, con columnas de mercado vacías y «Pago si gana» repitiendo la cuota mínima | Arreglado: cerrado en el móvil y sin columnas vacías (`seguimiento-pr18.spec.ts`; K4 y K12 lo abren antes) |
| 5 | Bajo | Tarjetas de NHL y NFL: insignias casi repetidas («CON RESERVAS», «Sin mercado», la incertidumbre…), «CON RESERVAS» frente a «Estimación con reservas», y «En juego, o el resultado aún no está descargado» 19 h después del inicio | Diferido |
| 6 | Bajo | Destacados: «Añadir a mi selección» destaca más que «Abrir partido» | No se cambia (ver «Decisiones», D); el enlace sube a 24 px |
| 7 | Medio | Siete controles de 17 a 20 px de alto | Arreglado: 24 px (`partidos.spec.ts`, `seguimiento-pr18.spec.ts`) |
| 8 | Medio | NHL con `/meta` en 500: el error y, debajo, «No hay partidos próximos» | Arreglado en NHL y UFC (`seguimiento-pr18.spec.ts`) |
| 9 | Bajo | La página sale en blanco hasta la primera respuesta, sin esqueleto | Diferido |
| — | Menor | A 320 px la fila de deportes corta la NHL (se desliza, pero no se ve que se puede); el panel lateral repite «Abrir la página completa» y «Abrir partido ›» | Diferido |

Pasó sin cambios: contraste (≥ 4,84), sin desbordes de página, anillos de foco, estados elegidos no
solo por color, cifras tabulares, filtros que se quitan, volver atrás conserva la dirección y el
desplazamiento, y el panel lateral (foco atrapado, Escape, Atrás, cambio de tamaño, enlace directo).

### C (2) a C (5): quant-reviewer, ¿cambió algo más que el texto? (25-nov)

Sacó los dos árboles (`6a3edd2` y `9bc741e`) y calculó con cada uno lo mismo sobre la base de test:
- 600 predicciones de tenis y 756 casos de `computeReliability`;
- 250 de fútbol y 120 de `describeAvailability`;
- 250 de baloncesto, 250 de béisbol y 1 de NFL;
- 161 `evaluar()` completos: 49 BET, 72 NO BET y 40 SIN MERCADO.

Quitando solo los campos de código nuevos, **cero diferencias** en números, booleanos y estructura:
- la decisión, con sus `razones`, que es lo que se guarda en `prediction_assessments.reasons`;
- la confianza, la estabilidad y la incertidumbre.

Idénticos byte a byte: los siete `DISCLAIMER`, `ETIQUETA_QUE_SI` y los dos `metodo`. Ni la política
ni `strategy_version` cambian.

| Sev. | Hallazgo | Destino |
| --- | --- | --- |
| Bajo | `model_version` cambia en los siete deportes: sus `predict.ts` y `reliability.ts` están en `MODEL_FILES` (`versions.ts`), y la huella es del contenido. Al desplegar, cada partido próximo gana una instantánea inmutable más («nueva versión del modelo»), y la evaluación por versión empieza un grupo nuevo en n = 0 | Se acepta y se dice (CHANGELOG). La huella por contenido es a propósito («si el código del modelo cambia un byte, la huella cambia sola»): sacar de ella un cambio de texto rompería la trazabilidad de cada cifra. Los textos viven ahora en `catalogo.ts`, fuera de `MODEL_FILES`, así que retocarlos ya no cambiará la versión |
| Bajo | El español no es idéntico byte a byte: espacios normales pasaron a duros (U+00A0) en «±25 %» (`porQue`, `supuestos`), alrededor de « – » en los marcadores, y «~5%» → «~5 %», «~-3%» → «~−3 %» en las bajas | Se acepta y se dice (CHANGELOG): es la regla de `es.ts` (D5). Nada guarda ni analiza esas frases |
| Info | Cambios de texto buscados, ya en el CHANGELOG: plurales, coma decimal en la diferencia de Elo, «−3,8» en el h2h, «Gana» fuera del titular ajustado del béisbol, el abridor por id en vez de «null» | Nada que hacer |

### Pasada final de ui-tester (24-nov, sobre `941ad9c`)

A 1280, 390 y 320 px, en claro y oscuro, en español e inglés, con una copia temporal de los datos. Sin
errores de consola ni peticiones fallidas.

| # | Sev. | Hallazgo | Destino |
| --- | --- | --- | --- |
| 1 | Medio | A 320 px el selector de moneda (fase B), en la misma fila que el banco, empujaba la página 35 px fuera de la pantalla (23 en inglés) | Arreglado: el grupo baja de línea (`e2e/seguimiento-pr18.spec.ts`, 320 px en los dos idiomas) |
| 2a | Medio | La tarjeta de la NFL en inglés decía «Most likely: Gana Cincinnati Bengals». Su veredicto es una frase del servidor; en la NHL y la UFC es un nombre | Arreglado: código `nfl.veredicto`, y la comprobación de coherencia cubre también los veredictos (`prediction/formatoTexto.test.ts`, `i18n/explicaciones.test.ts`) |
| 2b | Medio | En la ficha de la NHL y la NFL en inglés siguen en español, con coma decimal: lo que usó el modelo, el «¿Y si…?», el panel de confianza (común a todos los deportes) y el aviso «Estimación estadística…» | Diferido con el resto de C: no son las piezas convertidas en C (1) |
| 3 | Bajo | En inglés, el historial de estimaciones de la ficha dice «60.71 %» con espacio, junto a «60.7%» | Anterior a este trabajo. Diferido |
| 4 | Info | Sin moneda y con el peor caso por debajo del límite, la cartera no enseña las incidencias | Es el contrato: si contando todo lo desconocido como pérdida no se llega al límite, el veredicto es «por debajo» con certeza. El selector enseña «— moneda —». No se cambia |
| — | — | La UFC no tiene combates próximos en los datos: sus tarjetas no se pudieron ver | Cubierta por los tests de servidor y de catálogo |

### Pasada final de ui-tester sobre la segunda tanda (25-nov, sobre `4f99d71`)

144 cargas: 12 páginas a 1280, 390 y 320 px, en claro y oscuro, en español e inglés, sobre una copia
temporal de los datos. Sin desbordes de página, sin errores de consola, sin respuestas ≥ 400 y sin
claves sin traducir.

Solo NHL y NFL tenían partidos próximos en la copia. Las piezas convertidas de los otros cinco
deportes (lo que usó el modelo, el «¿Y si…?», los factores) no se pudieron ver en el navegador; las
cubren los tests de catálogo y de servidor. Los paneles de E no tenían partidos evaluados: se vio su
estado vacío, y los dibujos los cubre Playwright con datos sintéticos.

| # | Sev. | Hallazgo | Destino |
| --- | --- | --- | --- |
| 1 | Medio | Partidos no coincide con la tarjeta y la ficha en 3 de 14 partidos (OTT@FLA 54,0 % frente a 53,9 %; TOR@BOS 64,5 % frente a 64,1 %) | Comprobado en la API: no es un fallo de formato. Partidos enseña la ÚLTIMA instantánea (`partidos/explorador.ts`); la tarjeta y la ficha, la PRIMERA publicación (`prediction/publicada.ts`). Las dos reglas son anteriores a este trabajo (19 y 20-nov), y la ficha solo lo cuenta si difieren 0,5 pp o más. Diferido: pide decidir cuál es «la» cifra (ver «Diferido») |
| 2 | Bajo | En inglés, «0,0 pp» fijo en la columna modelo − mercado | Arreglado: `diferenciaPp` en `lib/formato.ts`, en el idioma y con espacio duro (`formato.test.ts`) |
| 3 | Bajo | En inglés, el «%» con y sin espacio en una misma ficha («56.8%», «56.82 %»), «1,560.7» junto a «Elo 1561» | Anterior; con el «60.71 %» del historial, en «Diferido» |
| 4 | Bajo | En inglés, los ejes de la calibración nueva dicen «50%» y los del diagrama de siempre «50 %» | El nuevo sigue la forma inglesa de `pct`. El de siempre, con el punto 3 |
| 5 | Medio | Español en inglés en Confianza: el aviso de muestra del ECE, «Todavía no hay partidos resueltos…», «0 de al menos 30 datos…», «Elo básico», «Grupos por reglas…» y las líneas de resumen | Todo es texto del servidor anterior a este trabajo (`evaluation/sample.ts`, `trust/evaluation.ts`, `evaluation/walkforward.ts`, `staking/risk.ts`, `evaluation/system.ts`). Los paneles nuevos de E van por el catálogo. Diferido con el resto del texto del servidor |
| 6 | Bajo | A 320 px el nombre del grupo («NHL», «Premier League») se cortaba en «N…» junto al mercado | Arreglado: el mercado baja de línea (`partidos.spec.ts`, 320 y 390 px) |
| 7 | Info | Los ejemplos del asistente del tenis, en español | Es a propósito: la página dice que las preguntas se entienden en español |

## Diferido

- **E, lo que queda.**
  - El panel del favorito, opcional.
  - Los pendientes por periodo: un periodo pasado puede crecer cuando llegan resultados tardíos sin
    estar marcado como parcial.
- **Anterior a este trabajo, encontrado en la fase E:**
  - «¿Acertó?» (`today.ts`) arma la probabilidad del visitante del fútbol como 1 − local − empate, así
    que una publicación que no suma 1 se puntúa allí de otra forma.
  - La reconstrucción (`recent/reconstruct.ts`) reproduce temporadas de reserva sin cerrojo; la NHL
    ignora `puntuable`. Hoy solo se enseña partido a partido; por eso la fase E la excluye.

  Los dos piden su propia revisión.
- **D, lo que queda** (de la auditoría de ui-tester; ver la tabla en «Revisiones», fase D).
  - Las insignias de las tarjetas de NHL y NFL: juntar «Sin mercado» con la frescura en una línea,
    llevar la frase del método a «¿Por qué?» y unificar «CON RESERVAS» con «Estimación con reservas»
    (también en inglés). Toca el texto de siete deportes; pide su propia pasada.
  - «En juego, o el resultado aún no está descargado» 19 h después del inicio: decir que falta el
    resultado. Depende de cuándo se descarga cada deporte.
  - Decir en la fila de Partidos qué resultado se espera, no solo su probabilidad.
  - Un esqueleto mientras carga la primera respuesta.
  - A 320 px, la señal de que la fila de deportes se desliza; los enlaces repetidos del panel lateral.

- **Qué cifra es «la» cifra de un partido** (pasada final de ui-tester, hallazgo 1). Anterior a este
  trabajo.
  - Partidos enseña la última instantánea pre-partido, que es la que se congela al empezar y se
    puntúa.
  - La tarjeta y la ficha enseñan la primera publicación, que es con la que apostaron el banco de
    papel y las estrategias.
  - La ficha solo cuenta la diferencia desde 0,5 pp; por debajo, dos pantallas dan dos cifras sin
    decirlo.

  Elegir una, o enseñar siempre las dos, toca lo que se compromete al publicar: pide al propietario y
  a quant-reviewer.
- **Texto del servidor en Confianza, en español** (pasada final de ui-tester, hallazgo 5): avisos de
  muestra, nombres de las referencias («Elo básico») y notas de riesgo. Es el mismo trabajo que el del
  motor de confianza: códigos en el servidor.
- **C, lo que queda: el texto del motor de confianza** (`server/src/trust/`). Sigue en español:
  - las razones de BET y NO BET y lo que haría falta;
  - las señales de confianza;
  - la calidad de datos;
  - los escenarios y supuestos de estabilidad;
  - lo fuera de distribución, el régimen y los hitos.

  Por qué no se hizo en C:
  - las razones se guardan como texto en `prediction_assessments.reasons` (tabla inmutable);
  - `trust/decision.ts` (FAMILIAS) clasifica las razones con expresiones sobre ese texto, y de ahí
    salen el análisis por familias y los tests de mutantes.

  Hacerlo bien pide:
  - guardar los códigos en una columna nueva (migración, data-guardian);
  - reconocer las familias por código, y por texto en las filas de antes;
  - la revisión de quant-reviewer, porque es el camino que decide si se apuesta.

  Es una pieza aparte, del tamaño de una fase.
- **«60.71 %» en el historial de estimaciones** de la ficha en inglés: un formato distinto del resto
  («60.7%»). Anterior a este trabajo. La pasada final vio más mezclas en inglés: «56.8 %» y «56.8%» en
  la misma ficha, «1,560.7» junto a «Elo 1561», y los ejes del diagrama de siempre con «50 %».
- **La hora del partido en las apuestas personales.** Sin enlace a una instantánea no se sabe el día
  del partido, y lo pendiente cuenta en el tope de cada día (R9, arreglado de forma estricta). Guardar
  esa hora pediría una columna en `bets` (una migración nueva, v33, y data-guardian); no hace falta para que el
  tope sea correcto.
- **Un test intermitente, anterior a este trabajo.** `experiments/recalibracion.test.ts` escribe en el
  `experiments/registry.jsonl` REAL del repositorio y lo restaura con `writeFileSync`, que vacía el
  fichero antes de escribirlo.
  - Si en ese instante `experiments/registry.test.ts` lo lee en otro proceso, lo encuentra vacío y falla
    («el registro real se puede leer»). Pasó una vez el 24-nov, con el árbol de la fase B: la segunda
    corrida dio 825/825 y el registro seguía intacto.
  - Además, si el primer test se cortara a medias, dejaría experimentos de prueba en el registro real.
  - Arreglarlo pide que el registro de los tests sea una copia temporal. Se deja anotado; no se toca aquí.
- **Importar el `settled_at` del CSV.** Lo apuntó data-guardian en la fase B. **Resuelto en la fase F**
  (`7ced606`): se conserva si es un instante ISO con zona y coherente; si no, la fila se rechaza o entra
  con el aviso «día de liquidación desconocido».
- **R11.** La reproducción histórica de estrategias no aplica el límite diario (`hoy: 0`). Es su
  comportamiento; no se toca.

- **Sincronizar las vistas guardadas con la cuenta.** Fuera de este trabajo por el brief; no se añaden
  tablas de cuenta.

## Textos de PR

### 1. PR #18, la descripción

La primera tanda se empujó el 24-nov a la rama del PR #18 (`claude/tennis-prediction-app-jlhgxh`,
`92339dc..6a3edd2`), y la descripción se sustituyó entonces, las dos cosas a petición del propietario.
CI dio 8/8 en `6a3edd2`.

Si se empuja la segunda tanda, la sección «Seguimiento de este PR» de esa descripción pasa a tener dos
partes:
- **Primera tanda** (A, B, C (1), F y G, `4bc88f1`…`6a3edd2`): el texto de ahora.
- **Segunda tanda** (C (2) a C (5), E y D, desde `79b8e31` hasta la cabeza de la rama):
  - las explicaciones de los siete deportes en tu idioma, con 287 códigos en el catálogo;
  - la calibración por partido y el rendimiento en el tiempo;
  - la jerarquía visual y el móvil.

  «No hecho» se queda con:
  - el texto del motor de confianza;
  - lo que queda de E (el panel del favorito, los pendientes por periodo y el corte del gráfico de
    deriva);
  - lo que queda de D (las insignias, la carga, el resultado esperado en la fila, la fila de deportes
    a 320 px y el panel lateral);
  - qué cifra es «la» cifra de un partido (Partidos frente a la ficha), anterior y por decidir.

  La tabla de verificación gana una fila con el último commit.

### 2. Si la segunda tanda va en un PR aparte

**Título:** Seguimiento del PR #18, segunda tanda: explicaciones en tu idioma en los siete deportes, calibración por partido y rendimiento en el tiempo, jerarquía visual y móvil

**Descripción:** la de la «Segunda tanda» de arriba, con «Verificación» y «Revisiones» de este
informe. Sin migraciones: ninguna tabla cambia.

## Informe de entrega

- **Commit de partida:** `92339dc` (cabeza del PR #18 el 23-nov). **Rama:** `claude/seguimiento-pr18`,
  que sigue a `origin/claude/tennis-prediction-app-jlhgxh`.
- **Primera tanda, empujada** el 24-nov a petición del propietario, hasta `6a3edd2`:
  - A `4bc88f1`, B `0d2ca98`, C (1) `41f3d3d`, F `7ced606`, F (seguridad) `d67c46c` y G `941ad9c`;
  - los arreglos de ui-tester y el informe, `6a3edd2`.

  La descripción del PR #18 se actualizó y CI dio 8/8.
- **Segunda tanda, solo local, sin empujar:**
  - C (2) `79b8e31`, C (3) `43cde2f`, C (4) `a9fda76` y C (5) `9bc741e`;
  - E `7171934` y D `6bd1ed5`;
  - `4f99d71`: corrige lo que E decía de lo de siempre (ver «Decisiones», E);
  - los arreglos de las revisiones finales y este informe, en el último commit.
- **Nada fusionado ni desplegado.** No se han gastado créditos de cuotas ni se ha enviado ningún aviso
  real. Ni `--unlock` ni las reservas.

### Verificación final (25-nov, sobre el árbol del último commit)

| Comprobación | Resultado |
| --- | --- |
| `npm run typecheck` | Correcto (servidor y web, con el comando del repositorio) |
| `npm run lint` | Correcto |
| `npm test` | Servidor 875/875; web 155/155 |
| `npm run build` | Correcto |
| `verify:data` (`DATA_DIR` temporal) | 533/533 (sobre `6bd1ed5`; después no cambió el código del servidor) |
| `audit` (`DATA_DIR` temporal) | 6003/6003, como en `6a3edd2` (sobre `6bd1ed5`, como `verify:data`) |
| `doctor -- --sin-red` (`DATA_DIR` temporal) | Sale con 1 por los dos errores esperados aquí: sin `.env` y sin `ODDS_API_KEY`. Las nueve advertencias son de la copia de datos parada: copia de seguridad de hace 94 h, ingestas sin correr y resultados atrasados |
| Playwright (`--trace off`) | 224/224: las 212 de `6a3edd2`, una de C, dos de E y nueve de D. K4 y K12 abren antes el panel, que en el móvil empieza cerrado |
| ui-tester | Auditoría de D (24-nov) y pasada final (25-nov, 144 cargas): sin desbordes, sin errores de consola y sin claves sin traducir. Dos hallazgos arreglados; uno anterior y por decidir (la cifra de Partidos frente a la ficha); el resto, anteriores o con su porqué (ver «Revisiones y su destino») |
| quant-reviewer sobre C (2) a C (5) | Sin cambio de números, decisiones ni razones en 1.351 predicciones, 876 casos y 161 decisiones. Dos bajos aceptados y dichos: `model_version` cambia en los siete deportes y el español cambia en los espacios |

- **Revisión del diff** (`6a3edd2..6bd1ed5`).
  - Nada bajo `data/` ni `experiments/`.
  - Ninguna migración ni disparador.
  - Ni `.env` ni claves: el escáner de secretos pasó en cada commit.
  - `es.ts` y `en.ts` con las mismas claves.
  - Ningún texto fijo nuevo en la web fuera del catálogo.
  - Los endpoints de antes (`/api/evaluation/reliability`, `/api/monitoring`) se calculan como antes, salvo una excepción de la revisión de E: una publicación de fútbol que no suma 1 se excluye en vez de renormalizarse (ver «Decisiones», E). Lo que fija importes no la lee.

### Por fase

- **A, B, F y G: hechas** en la primera tanda (ver arriba y «Revisiones y su destino»).
- **C: hecha en los siete deportes**, salvo el texto del motor de confianza. Ver «Diferido»: pide una
  columna nueva, data-guardian y quant-reviewer.
- **D: hecho** lo que salió de la auditoría de ui-tester y de la pasada final, salvo cinco puntos
  menores que se dejan en «Diferido».
- **E: hecha**, con las definiciones de quant-reviewer y su revisión de la implementación, y el corte
  del gráfico de deriva de siempre (25-nov). El panel del favorito y los pendientes por periodo, en
  «Diferido».

### Decisiones de contabilidad y de evaluación

Están en «Decisiones» arriba. En corto:
- **Riesgo (B):**
  - una moneda por banco;
  - céntimos exactos;
  - el día de liquidación en `APP_TIMEZONE`;
  - lo desconocido como cota, y «sin evaluar» no apuesta;
  - la exposición, por la cota alta.
- **Evaluación (E):**
  - un partido por panel;
  - Wilson, y nada con menos de 30;
  - registrada y legado aparte, y lo reconstruido fuera;
  - un veredicto que nunca dice «calibrado»;
  - el Brier por periodo en la zona de la política;
  - lo de siempre, igual que antes.

Ningún parámetro del modelo, umbral, calibración ni porcentaje ha cambiado.

### Revisiones

Cada hallazgo y su destino están en «Revisiones y su destino»:
- B: quant-reviewer y data-guardian;
- F y G: data-guardian y security-reviewer;
- E: quant-reviewer, antes del código y sobre la implementación;
- D: la auditoría de ui-tester;
- C (2) a C (5): quant-reviewer, sobre si cambió algo más que el texto;
- la pasada final de ui-tester, sobre las dos tandas.

Todos están arreglados con su test, salvo los que se dejan en «Diferido» con su porqué.
