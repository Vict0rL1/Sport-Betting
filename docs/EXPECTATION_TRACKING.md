# Expectativas frente a resultados

Registrar qué se esperaba **antes** de un evento y compararlo **después** con lo que
salió. Resultados trimestrales primero; la forma sirve para investor days,
actualizaciones de guidance, decisiones regulatorias, lanzamientos u otros.

## Tablas (migración 0007)

| Tabla | Qué guarda | Garantías |
|---|---|---|
| `catalyst_events` | símbolo, tipo, periodo («2026-Q3»), cierre del periodo, fecha prevista | `UNIQUE(symbol, tipo, periodo)`, `CHECK` del tipo |
| `expectations` | métrica, `fuente_tipo`, fuente, valor / rango / operador, unidad, `informacion_hasta`, `registrado_en`, detalle | **inmutable** (ORM + triggers), `UNIQUE(event_id, metrica, fuente_tipo, fuente)`, `CHECK` de fuente y de cifra, FK al evento |
| `event_actuals` | métrica, valor, fuente (documento), `publicado`, linaje | solo se añaden filas (una reexpresión es otra fila), FK al evento |

Las lecturas, clasificaciones y calibraciones **no** se guardan: son funciones
deterministas de esas tres tablas y se recalculan con la versión vigente de las
reglas.

## Fuentes, nunca mezcladas

| `fuente_tipo` | De dónde sale | Marca |
|---|---|---|
| `consenso` | `eps_estimate` y `revenue_estimate` del calendario de Finnhub | — |
| `guidance` | previsiones extraídas de un 8-K/10-Q ya analizado, **solo con la cita verificada** | `generado_por: ia` (la cifra la extrajo una IA; métrica, periodo y unidades los asigna el código) |
| `modelo_interno` | mismo trimestre del año anterior × (1 + mediana del crecimiento interanual de 4 trimestres); márgenes = media de 4 trimestres | método e insumos en `detalle` |
| `reglas` | los puntos de invalidación métricos de la tesis, invertidos (la tesis exige margen ≥ 18 %) | `trigger_id`, valor previo |
| `usuario` | KPIs sectoriales u otras variables anotadas a mano | `generado_por: usuario` |

Cada fuente tiene su columna en la lectura y su propia calibración.

**Escala.** El consenso y el guidance, que vienen de fuera, se comparan antes de
registrarse con el último trimestre publicado de la misma métrica
(`comprobar_escala`): ingresos entre 0,2× y 5×, BPA entre 0,02× y 50×. Fuera de
la banda, «escala dudosa»: no se registra y se dice por qué (un consenso en miles
se leería como una sorpresa del −99,9 % y estropearía la calibración). Sin
trimestre comparable, o con pérdidas en un lado, `sin_referencia`: se registra
sin juzgar. El resultado de la comprobación viaja en `detalle.escala`.

## Sin información futura

La validez se mide sobre `registrado_en` —la única prueba que tiene el sistema de
cuándo conoció la expectativa— con la regla común (`punto_en_el_tiempo`). El corte
del evento es la fecha prevista o la primera publicación de un resultado real, lo
que llegue antes:

- registrada después del corte → no cuenta, ni en la lectura ni en la calibración;
- registrada **el mismo día** → no cuenta: los resultados salen antes de abrir o
  después de cerrar, y una fecha no dice cuál;
- capturar con el evento ya conocido se **niega** (409);
- un consenso que ya trae el resultado real en el calendario no se registra.

## Resultados reales

`POST /api/expectativas/eventos/{id}/resultados` lee el trimestre de EDGAR:
ingresos, BPA, márgenes bruto y operativo, beneficio y FCF, con etiqueta XBRL,
formulario, número de acceso y fecha. Los trimestres conservan la cifra publicada
**primero** (no la reexpresada); el segundo y tercer trimestre de flujo de caja,
que los 10-Q dan solo acumulados, se derivan como acumulado − acumulado anterior;
el cuarto como año − nueve meses. El BPA del cuarto trimestre no se deriva.

La dirección del guidance (sube / baja / se mantiene / mixta) sale de la
comparación entre trimestres ya hecha: cifras extraídas por IA con cita, variación
calculada por código.

## La lectura

Métrica a métrica: **supera**, **en línea** (tolerancia: 1 % en ingresos, 2 % en
BPA, medio punto en márgenes), **por debajo**, o **desconocido** si no hay real.
Un BPA esperado negativo no produce porcentajes: se da la diferencia.

En conjunto vota **una fuente por métrica** (consenso > guidance > usuario > modelo
interno). Votos en las dos direcciones = **MIXTO**, sin compensar: batir en
ingresos con el margen por debajo y el guidance a la baja no es un buen
trimestre. Sin votos = desconocido; con métricas sin real, `parcial`.

Impacto en la tesis: cada punto métrico queda **confirmado**, **debilitado** (se
cumple, pero un punto más cerca del umbral que el último trimestre conocido),
**invalidado** o **sin resolver** (noticias, crecimientos plurianuales).

## Calibración

`GET /api/expectativas/calibracion?symbol=` — por fuente: n, error medio absoluto,
**sesgo con signo** (positivo = lo real salió por encima: se esperaba de menos),
% dentro de tolerancia, métrica mejor prevista y empresas menos previsibles. Con
menos de 5 pares, el número describe la muestra, no a la fuente.

## API

```
POST /api/expectativas/eventos                     crear evento
POST /api/expectativas/{symbol}/proximos-resultados  evento desde el calendario + captura
POST /api/expectativas/eventos/{id}/capturar       capturar (se niega si ya se conoce)
POST /api/expectativas/eventos/{id}/expectativas   expectativa manual
POST /api/expectativas/eventos/{id}/resultados     reales desde EDGAR
GET  /api/expectativas/eventos/{id}                lectura completa
GET  /api/expectativas/calibracion                 calibración
```

`?symbol=` es opcional en `eventos` y `calibracion`: vacío (o solo espacios) significa «todos».
Un ticker se recorta y se pasa a mayúsculas; uno con caracteres no válidos (o con más de 12)
es un 422 con el mensaje «Símbolo inválido», el mismo en toda la API (`app/simbolos.py`).
