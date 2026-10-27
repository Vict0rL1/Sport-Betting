# Auditoría del 22 de octubre de 2026: lo que quedaba

**Entrada.** El informe de GitHub del 22 de octubre (`github-audit-2026-10-22.md`, con
`github-audit-regressions.mjs` y `github-backup-audit-evidence.json`) revisó el commit `0655c8c`.
Ninguno de los tres ficheros llegó a esta sesión: cada hallazgo se ha comprobado contra el código,
con su prueba que falla antes del arreglo. Después de `0655c8c` solo había entrado `3bca45e` (el
umbral del e2e de N7), que no toca nada de esto.

Reglas: bases de usar y tirar, red simulada, ni un crédito de la API, ni un despliegue, ni una
apuesta, ni una fila del libro mayor reescrita. La copia original no se toca.

## 1. El informe del freno por fuente atrasada (`scripts/auditoriaCopia.ts`)

**Comprobado.** El informe listaba como «competiciones donde ya no se apostaría» todas las que
tenían algo vencido con la fuente atrasada, con el umbral de fábrica (48 h) y sin mirar la política
de la copia. Y metía las que no tienen prueba suficiente (menos de dos días distintos), con
`motivo: null`. En una copia con una política v1 anterior a la clave (como la del 12 de octubre)
el freno está apagado: `trust/decision.ts` da 0 y `trust/assess.ts` no lo calcula. Reproducido con
una copia de prueba: salían `epl` (motivo null) y `nhl`, con el freno apagado.

**Arreglo.** `frenoFuenteAtrasada` en `informe.json`, y su sección en `resumen.md`:

- la política que se aplica, leída por el mismo camino que el banco, las estrategias y la
  confianza (`politica()`, `horasArchivoAtrasado()`): versión, si tiene la clave y su valor, y
  las versiones guardadas;
- el umbral efectivo y si el freno está encendido;
- **restricciones activas**: solo con el freno encendido y con motivo;
- **avisos**: con el freno apagado, dónde frenaría si se encendiera con el valor de fábrica;
- **sin prueba suficiente**: fuente atrasada con menos de dos días distintos; no frena.

No cambia ninguna política: la auditoría no crea versiones (si la copia no tuviera ninguna,
`politica()` sembraría la de fábrica en la copia de trabajo, como la app al arrancar, y el informe
lo dice). Encender el freno sigue siendo crear una versión nueva desde Ajustes.

**Pruebas.** `scripts/auditoriaFreno.test.ts`: con la v1 sin la clave, ninguna restricción, la
NHL como aviso y la Premier sin prueba; con una v2 creada con `nuevaVersion` que lo enciende, la
NHL como restricción con «más de 48 h».

**No comprobado aquí.** Las cifras de la copia del 12 de octubre (12 competiciones, ocho sin
motivo): la copia no está en esta sesión. `npm run auditoria:copia` sobre ella las dirá con el
informe nuevo.

## 2. Surebets de hándicap (`odds/intel.ts`)

**Comprobado.** `surebetDe` agrupaba las líneas por su valor absoluto. A −3,5 a 2,10 y B −3,5 a
2,10 salía como surebet del 4,8 % y las dos pierden si A gana por uno. Tampoco miraba que un total
fuera un Más con un Menos (dos «Over» también salían), y el resultado perdía el signo de cada pata.

**Arreglo.** `surebetDe(market, selecciones)` según el mercado (`tipoMercado`):

- hándicap (`spreads`, `alternate_spreads`, sus periodos): dos selecciones con líneas de signo
  contrario (−3,5 con +3,5);
- total (`totals`, `alternate_totals`…): un Over y un Under con el mismo umbral;
- sin línea (`h2h`, `h2h_3_way`, `btts`, `draw_no_bet`): todas las selecciones, solo cuotas sin
  línea;
- cualquier otro (lay, `team_totals`, que se guarda sin decir de qué equipo es el Over, futuros):
  no da surebet.

Cada pata guarda su línea con signo (`patas[].linea`, también en el esquema de
`/api/odds/intel`) y Destacados la pinta: «Chiefs −3,5», «Bills +3,5», «Over 2,5».

**Pruebas.** `odds/intel.test.ts`: hándicaps del mismo signo, y uno que no es el complementario;
de signo contrario, en los dos sentidos; totales con el mismo umbral, con otro, con dos Over y sin
Under; mercados sin línea, con una línea colada, `team_totals` y `h2h_lay`; y de punta a punta,
`inteligenciaMercado` sobre snapshots guardados. `web/src/components/picks/surebet.test.ts`: cómo
se pinta cada pata.

## 3. Diagnóstico de los fallos de cuotas (`oddsApi.ts`, `oddsQuota.ts`, `odds/metricas.ts`)

**Comprobado.** Una respuesta que no es JSON lanzaba sin anotar el fallo. El tenis lo captura y
cae a la demostración, y la ejecución quedaba como `fixture: 0 próximos · ninguna petición a la
API`, con 0 fallidas, aunque la petición se hizo y falló. Y si el refresco lanzaba, `conRegistro`
guardaba el error con `metrics = NULL`: lo ya recogido se perdía.

**Arreglo.**

- `requestOdds` anota la respuesta que no es JSON como fallida
  (`<competición>: respuesta_invalida (no es JSON)`).
- `listSports` (la lista de competiciones, de la que tira el tenis) anota sus tres fallos: sin red,
  HTTP y JSON. El JSON roto lanza ahora un `OddsApiError('respuesta_invalida')` en vez de un
  `SyntaxError` suelto.
- `registrarCuotas` añade lo recogido al error que lanza el refresco, el mismo error, con su clase,
  su mensaje y su `kind`. Lo que no es un Error se envuelve con su texto, y el original queda en
  `cause`.

**Pruebas.** `odds/metricas.test.ts`, con respuestas simuladas:

- el tenis con una respuesta que no es JSON cae a la demostración y la ejecución dice «1
  fallida»;
- un refresco que hace una petición buena y luego una rota sin capturar guarda el error, y en las
  métricas la petición buena y la fallida;
- lo mismo con un fallo que no es de la API, y con algo lanzado que no es un Error;
- `/sports` con JSON roto, con un 500 y sin red.

## Revisiones (27 de octubre)

**data-guardian y quant-reviewer.** Arreglados, cada uno con su prueba que falla antes:

- **Las anulaciones de Ajustes.** La auditoría no instalaba el lector de `features.anulaciones`,
  como hace `app.ts` al arrancar. Con la política versionada apagada desde Ajustes, el servidor
  frena con las constantes de fábrica y la auditoría decía «freno apagado». Ahora las lee, y el
  informe dice si el interruptor está anulado.
- **`/sports` con JSON que no es una lista** (la página de un proxy con 200) se guardaba en la caché
  diez minutos y no contaba como fallo. Ahora es un fallo anotado y no se guarda.
- **Ajustes de cuentas y textos:**
  - una política guardada ilegible ya no sale como «la política vnull»;
  - con la clave a 0, el aviso dice que encender el freno pide poner un valor (48 h es solo el de
    fábrica);
  - cada competición frenada, avisada o sin prueba lleva sus horas;
  - las vencidas de 48 h ya no llevan la marca del freno;
  - `policy_versions` sale como vacía cuando la copia no tenía ninguna versión;
  - algo lanzado que ni se deja convertir en texto ya no tira las métricas.

**quant-reviewer, comprobado con un simulador de pagos:** la cobertura es buena en líneas medias,
enteras (push), de cuarto y 0, y en los periodos.

**ui-tester:** en 32 combinaciones (1280 y 390 px, claro y oscuro, español e inglés), los
hándicaps salen con «−» y «+», los totales sin signo, y las cifras con coma o punto según el idioma.
Ni desbordes ni errores en la consola.

**Pendiente, de antes de este lote y fuera de su alcance** (para un lote aparte):

- `referenciaDe` hace la mediana del consenso con todas las líneas. Con Pinnacle en 44,5 y otras en
  47,5 da ±13,4 pp que son solo la línea (medio).
- `margenPct` no descuenta el push en líneas enteras y de cuarto: A −3 con B +3 a 2,10 dice 4,8 %,
  y si A gana por tres el beneficio es 0 (bajo).
- En `h2h`, «todas las selecciones» son las guardadas, no las que tiene el mercado. Sin el empate
  guardado, un 1X2 saldría como surebet. No se conoce ningún camino que lo pierda (bajo).
- `doctor.ts` y `scripts/paper.ts` tampoco instalan las anulaciones de Ajustes.

## Límites y lo que no se arregla aquí

- Las ejecuciones de antes de este cambio no se reescriben: siguen diciendo lo que dijeron.
- Las cifras de vencidas no se comparan entre umbrales: 58 predicciones vencidas a 48 h y 142 a
  24 h son cuentas distintas, no una mejora.
- Nada de esto arregla datos: el tenis sigue atrasado mientras la fuente sea TML, los playoffs de
  la MLB siguen sin resultados con `gameType=R`, y lo vencido en producción sigue sin liquidar.
  Son las acciones 5 a 7 de `auditoria-17-octubre.md`.
- El freno por fuente atrasada sigue apagado en una base cuya política es anterior a la clave
  hasta que el dueño cree una versión que lo diga.
