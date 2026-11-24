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
| C | Explicaciones estructuradas y bilingües, siete deportes | En curso: NHL, UFC y NFL hechas; tenis, fútbol, baloncesto y béisbol, no | `web/src/i18n/explicaciones.test.ts`, `server/src/explicaciones/coherencia.ts` en `nhl/publicada.test.ts`, `ufc/publicada.test.ts` y `prediction/formatoTexto.test.ts` |
| D | Jerarquía visual y móvil | Pendiente | |
| E | Calibración y rendimiento en el tiempo | Pendiente | |
| F | Vista previa de la importación CSV | Hecho | `server/src/bets/importar.vista.test.ts`, `e2e/seguimiento-pr18.spec.ts` (F) |
| G | Fiabilidad de los avisos | Pendiente | |

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

## Diferido

- **La hora del partido en las apuestas personales.** Sin enlace a una instantánea no se sabe el día
  del partido, y lo pendiente cuenta en el tope de cada día (R9, arreglado de forma estricta). Guardar
  esa hora pediría una columna en `bets` (migración v32 y data-guardian); no hace falta para que el
  tope sea correcto.
- **Un test intermitente, anterior a este trabajo.** `experiments/recalibracion.test.ts` escribe en el
  `experiments/registry.jsonl` REAL del repositorio y lo restaura con `writeFileSync`, que vacía el
  fichero antes de escribirlo.
  - Si en ese instante `experiments/registry.test.ts` lo lee en otro proceso, lo encuentra vacío y falla
    («el registro real se puede leer»). Pasó una vez el 24-nov, con el árbol de la fase B: la segunda
    corrida dio 825/825 y el registro seguía intacto.
  - Además, si el primer test se cortara a medias, dejaría experimentos de prueba en el registro real.
  - Arreglarlo pide que el registro de los tests sea una copia temporal. Se deja anotado; no se toca aquí.
- **Importar el `settled_at` del CSV.** La exportación lo lleva y la importación lo ignora: un histórico
  importado deja la semana «sin evaluar» hasta el lunes (data-guardian). Se mira en la fase F.
- **R11.** La reproducción histórica de estrategias no aplica el límite diario (`hoy: 0`). Es su
  comportamiento; no se toca.

- **Sincronizar las vistas guardadas con la cuenta.** Fuera de este trabajo por el brief; no se añaden
  tablas de cuenta.

## Textos de PR

(Se completan al final.)

## Informe de entrega

(Al final.)
