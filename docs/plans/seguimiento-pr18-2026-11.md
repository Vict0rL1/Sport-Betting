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
| R9 | El tope por día de `decideBook` compara el día del PARTIDO de la candidata con lo pendiente agrupado por día de COLOCACIÓN. Una apuesta del viernes para el sábado cuenta en el viernes. | Confirmado en el código |
| R10 | Sin cruce entre bancos: el banco de papel y las estrategias pasan su propia exposición y sus propias pérdidas (`openExposure`, `perdidas`) y no leen `bets`. Solo la cartera personal lee el registro personal. | Verificado: no hay defecto |
| R11 | La reproducción histórica de estrategias pasa `hoy: 0`: el límite diario no actúa al reproducir. | Comportamiento existente de la estrategia; se documenta y no se cambia |
| R12 | El banco de la cartera (`ExposurePanel`) es un número en `localStorage` sin moneda; el banco personal de Ajustes (`bancoPersonal`) tampoco tiene moneda. | Confirmado |

## Matriz

| Id | Requisito | Estado | Prueba |
| --- | --- | --- | --- |
| A | Base verificada, línea base real, documentación reconciliada | Hecho | este documento; `web/src/lib/dinero.test.ts` |
| B1 | Contrato de contabilidad del riesgo escrito | Pendiente | |
| B2 | Dinero exacto en los límites y la exposición | Pendiente | |
| B3 | Monedas separadas en todo cálculo de riesgo | Pendiente | |
| B4 | Cálculo incompleto explícito (cuatro estados) | Pendiente | |
| B5 | Fronteras e integración probadas | Pendiente | |
| C | Explicaciones estructuradas y bilingües, siete deportes | Pendiente | |
| D | Jerarquía visual y móvil | Pendiente | |
| E | Calibración y rendimiento en el tiempo | Pendiente | |
| F | Vista previa de la importación CSV | Pendiente | |
| G | Fiabilidad de los avisos | Pendiente | |

## Decisiones

(Se completan en cada fase.)

## Revisiones y su destino

(Se completan en cada fase.)

## Diferido

- **Sincronizar las vistas guardadas con la cuenta.** Fuera de este trabajo por el brief; no se añaden
  tablas de cuenta.

## Textos de PR

(Se completan al final.)

## Informe de entrega

(Al final.)
