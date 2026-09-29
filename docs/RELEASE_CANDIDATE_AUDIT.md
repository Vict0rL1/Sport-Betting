# Auditoría para Release Candidate 1

Fecha: 2026-09-29 · Base: `e3265f5` · 826 tests en verde · 32 puntos en `TODO.md`

El criterio de esta auditoría no es «¿funciona?» sino **«¿falla de forma
segura?»**. Son preguntas distintas y la segunda es la que decide si un sistema
de inversión se puede usar. Un sistema que acierta el 60 % de las veces y falla
de forma segura el otro 40 % es utilizable. Uno que acierta el 70 % y el otro
30 % falla en silencio, no.

Por eso la clasificación de abajo no ordena por «cuánto código hay que tocar»
sino por **qué pasa cuando el dato no está**.

---

## El patrón que se repite: el dato ausente empuja siempre hacia comprar

Cinco de los seis P0 son el mismo error con distinta ropa:

> Falta un dato → se sustituye por un valor neutro → el valor neutro resulta
> ser el favorable → el sistema recomienda más exposición **por tener menos
> información**.

Esto es lo contrario de lo que debe pasar. La ignorancia tiene que **encoger**
la posición, no agrandarla. Cada P0 de abajo está verificado ejecutando el
código, no leyéndolo: la columna «comprobado» trae el número real.

---

## P0 — Crítico: producen una decisión incorrecta en silencio

### P0-1 · Un precio `NaN` produce una recomendación de COMPRAR

`analysis/decision.py` · `decide()`

La guarda es `if price is None or not price.get("last")`. `NaN` no es `None` y
es *truthy*, así que pasa entera. Después, todas las comparaciones con `NaN`
devuelven `False`, y el flujo cae en la rama favorable.

```
decide({"score": 0.5}, {"last": nan, "daily_vol_pct": 2.0, "above_sma200": True})
  → action: "comprar"
    levels: {"stop": nan, "objetivo": nan, "peso_bruto_pct": 5.5}
```

El `peso_bruto_pct: 5.5` **no es NaN**: es un número real, calculado solo desde
`stop_pct`, y viaja íntegro a `sizing.dimensionar()`. O sea que una cotización
corrupta produce una orden de compra dimensionada.

**Impacto**: máximo. Viola los principios 6, 7 y 11 a la vez.

### P0-2 · Un precio negativo o cero también

Mismo sitio. `last = -50.0` es *truthy* → `action: "comprar"`, `stop: -40.85`.
Ningún precio de mercado es negativo: si llega uno, el dato está corrupto y la
respuesta correcta es `sin_datos`, no una compra con stop negativo.

### P0-3 · Una volatilidad `NaN` desactiva el objetivo de volatilidad ENTERO

`analysis/sizing.py` · `volatilidad_cartera()` + `dimensionar()`

`total` se contamina con `NaN`; `math.sqrt(NaN)` es `NaN`; `if total > 0` es
`False` con `NaN`, así que la función devuelve `None`. En `dimensionar`,
`if vol_llena and ...` es `False` → **`escala = 1.0`, no se recorta nada**.

```
candidatas: A (vol 40 %), B (vol NaN)
  → escala_aplicada: 1.0      ← el límite NO se ejecutó
    vol_estimada_pct: None    ← la UI pinta «—»
    recortes: [solo los del tope por posición]
```

Lo peor es la combinación: la pantalla muestra «—» en la volatilidad estimada,
que se lee como «no hay dato», cuando lo que ha pasado es que **un límite de
riesgo no se ha ejecutado**. No hay ninguna diferencia visible entre «la
volatilidad está dentro del objetivo» y «el objetivo no se comprobó».

Es exactamente la familia del bug del límite por correlación de `e0067d7`.

### P0-4 · Una posición sin volatilidad reduce la volatilidad de la cartera

`analysis/sizing.py` · `volatilidad_cartera()`

`simbolos = [s for s in pesos if vol_anual.get(s)]` excluye en silencio lo que
no tiene volatilidad medida. El resultado es que **menos datos = menos riesgo
aparente = más compra autorizada**.

```
50/50 con ambas vols al 40 %       → 0,3464
50/50 y a B le falta la vol        → 0,2000   (−42 % de riesgo aparente)
```

El filtro `vol_anual.get(s)` además descarta una volatilidad legítima de `0.0`.

### P0-5 · Sin series de retornos, el tope por correlación no se ejecuta y no se dice

`analysis/sizing.py` · `dimensionar(retornos=None)`

```
5 candidatas al 9 %, sin retornos
  → clusters: []
    ¿algún aviso de que la correlación no se pudo medir?: False
```

El bug de `e0067d7` se arregló **en el sitio que llama** (`routers/signals.py`
alimenta los retornos desde el spark), pero la función sigue fallando abierta
para cualquier otro camino: si `_retornos_desde_spark` devuelve `{}` —porque los
historiales tienen longitudes dispares, o porque hay menos de dos símbolos con
spark suficiente— el tope desaparece sin dejar rastro.

Un límite que puede no ejecutarse **tiene que decir que no se ejecutó**. Esa es
la lección del bug original y no está aprendida del todo.

### P0-6 · Deuda desconocida se convierte en deuda cero e infla la valoración un 95 %

`routers/valuation.py:119` y `routers/deep_dive.py:203`

```python
"net_debt": (deuda - (ultimo.get("cash") or 0.0)) if deuda is not None else 0.0
```

Y en `analysis/valuation.py`: `equity_value = enterprise_value - net_debt`.

```
FCF 1.000 M, g 5 %, r 10 %, 100 M de acciones
  con 8.000 M de deuda neta conocida : 83,95 $/acción
  si la deuda NO se conoce  (→ 0)    : 163,95 $/acción   (+95 %)
```

Una empresa sobre la que no sabemos la deuda se valora **como si no tuviera
ninguna**, que es el supuesto más optimista posible. `routers/stocks.py:252`
hace lo correcto en la misma situación (`else None`): la inconsistencia entre
dos sitios que calculan lo mismo es en sí misma un hallazgo.

### P0-7 · Crecimiento ausente se sustituye por un 3 % inventado, en silencio

`routers/valuation.py:136` · `routers/deep_dive.py:200`

```python
historico = crecimiento.get("fcf_cagr") or crecimiento.get("revenue_cagr") or 0.03
```

Dos fallos en una línea. El `or` encadenado convierte un crecimiento ausente en
un supuesto del 3 % que nunca se declara como supuesto; **y** convierte un
crecimiento real de `0.0` en ese mismo 3 %, porque `0.0` es *falsy*. Una empresa
que no crece se valora como si creciera al 3 %.

---

## P1 — Necesario antes del RC1

| # | Punto | Por qué |
|---|---|---|
| P1-1 | **No existe una frontera de validación de datos** | `providers/base.py` documenta la forma del payload pero nada la comprueba. `router.fetch()` devuelve lo que sea que traiga el proveedor —`None`, `NaN`, `0`, negativos— y la caché lo persiste. Es la causa raíz de P0-1 a P0-4. |
| P1-2 | **No existe el estado UNKNOWN** | Hoy `None` significa a la vez «no existe», «no se pudo consultar», «caducado» y «error». Sin distinguirlos no se puede cumplir el principio 7. |
| P1-3 | **Alembic no existe** | `init_db()` hace `create_all()`. Añadir una columna a un modelo no toca una base ya creada: el esquema y el código divergen en silencio. |
| P1-4 | **`api_cache` no se limpia nunca** | Las filas caducadas se ignoran al leer pero no se borran. Crecimiento sin techo. |
| P1-5 | **Un payload corrupto se cachea y se sirve durante todo el TTL** | No hay validación antes de `cache.set()`. |
| P1-6 | **Sin caída a caché vieja marcada como STALE** | Si todas las fuentes fallan, `AllProvidersFailedError`. Hay un dato de hace 10 minutos en la caché que sería perfectamente utilizable **si se marcara como viejo**. Hoy se prefiere el apagón. |
| P1-7 | **`Position` no guarda la divisa** | La divisa se lee del quote en vivo. Si el quote falla, la posición pierde su moneda; si el proveedor cambia de opinión, el histórico se recalcula con otra. |
| P1-8 | **Las conversiones FX no dejan traza individual** | `convertir()` devuelve un `float` pelado. `convertir_cartera` guarda `tipos_usados` a nivel de cartera, no por conversión. |
| P1-9 | **Sin test end-to-end del ciclo completo** | Hay tests por módulo y por endpoint, ninguno que recorra ticker → decisión → sizing → cartera → riesgo. |
| P1-10 | **Sin cooldown de alertas** | Resuelto a medias: una alerta salta una vez y no repite. Pero no hay reevaluación ni rearme, así que el caso «sigue cumpliéndose 3 h después» no existe. Falta registrar última evaluación, último resultado y último error por alerta. |
| P1-11 | **`DataNotFoundError` corta la cadena de fallback** | `router.fetch` la propaga sin probar el resto. El propio `TODO.md` reconoce que yfinance no distingue «no existe» de «red caída». |
| P1-12 | **Sin `decision_snapshot` automático** | `Decision.contexto` existe pero lo rellena el usuario al anotar a mano. No hay congelación automática de lo que el motor vio. |

## P2 — Mantenimiento

- `liquidez_pct` usa `max(0, ...)`, que **esconde** el apalancamiento en vez de avisarlo.
- `agrupar_por_correlacion` usa `abs(c)`: una correlación de −0,85 agrupa dos
  posiciones que en realidad se cubren. Es conservador (falla hacia el lado
  seguro), así que no es P0, pero está sin documentar.
- `RateLimiter.usage()` puede devolver `None` si `windows` viniera vacío.
- `analysis/etf.py:17` — `h.get("weight") or 0.0`: un peso ausente infravalora
  el solapamiento (falla abierto, pero el propio README ya advierte que el
  solapamiento es una cota inferior).
- Duplicación: `matriz_correlacion` existe en `sizing.py` y en `portfolio_risk.py`.

## P3 — Nice-to-have (no se tocan)

Intradía, 13F, segmentos, beta contra otro benchmark, cobertura de EDGAR fuera
de EE. UU. Ninguno bloquea el RC1 y todos están ya en `TODO.md`.

---

## Controles de riesgo: dónde se define, dónde se ejecuta, dónde se prueba

Trazado uno a uno, que es lo que pedía la Fase 2. «Camino de evasión» es la
columna que importa: si existe, el control es decorativo.

| Control | Se define | Se ejecuta | Camino de evasión |
|---|---|---|---|
| Riesgo por operación (1 %) | `decision.RIESGO_POR_OPERACION` | `_niveles()` | precio `NaN`/negativo (**P0-1, P0-2**) |
| Tope por posición (10 %) | `sizing.MAX_POR_POSICION_PCT` | `dimensionar()` paso 1 | ninguno ✅ |
| Tope por sector (25 %) | `sizing.MAX_POR_SECTOR_PCT` | `dimensionar()` paso 2 | sector `None` → todo cae en «Sin sector», que es un grupo real y se limita ✅ |
| Tope por correlación (25 %) | `sizing.MAX_POR_CLUSTER_PCT` | `dimensionar()` paso 3 | **sin retornos no se ejecuta y no avisa (P0-5)** |
| Objetivo de volatilidad (12 %) | `sizing.OBJETIVO_VOL_ANUAL_PCT` | `dimensionar()` paso 4 | **una vol `NaN` lo anula (P0-3); una vol ausente lo relaja (P0-4)** |
| Riesgo abierto total (6 %) | `risk_budget.HEAT_MAXIMO_PCT` | `presupuesto_de_riesgo()` | ninguno ✅ — cuenta `sin_calcular` y avisa |
| Riesgo por grupo (3 %) | `risk_budget.HEAT_GRUPO_MAXIMO_PCT` | `presupuesto_de_riesgo()` | ninguno ✅ |
| Stop perforado | `risk_budget.riesgo_de_posicion()` | idem | ninguno ✅ — `stop >= precio` se trata como posición entera en riesgo |
| Filtros del screener | `screener.evaluate_filters()` | idem | ninguno ✅ — `actual is None → passed False` |
| Dirección del tipo de cambio | `fx.SERIES[...]["por_usd"]` | `a_por_usd()` | ninguno ✅ — `comprobar_banda()` detecta la inversión |
| Posición no convertible | `fx.convertir_cartera()` | idem | ninguno ✅ — queda fuera del total y se nombra |
| Alerta no evaluable | `alertas.evaluar()` | idem | ninguno ✅ — cuatro estados desde `e3265f5` |

**Los tres módulos que ya fallan cerrados —`risk_budget`, `screener`, `fx`—
tienen algo en común**: devuelven `None` ante la ausencia y **cuentan** lo que no
pudieron evaluar. Los que fallan abiertos sustituyen la ausencia por un número.
Ese es el patrón a propagar, y es la forma de la solución de la Fase 3.

---

## Plan de ejecución

1. **Frontera de validación** (`app/datos/`): un tipo `Dato` con estado
   `VALID | UNKNOWN | STALE | ERROR` y saneadores en la entrada de proveedor.
   Resuelve P1-1, P1-2 y la raíz de P0-1..P0-4.
2. **P0-1, P0-2** — `decide()` rechaza precios no finitos, negativos o cero.
3. **P0-3, P0-4, P0-5** — `sizing` deja de fallar abierto: lo que no se puede
   medir se dice, y un límite que no se pudo comprobar se declara.
4. **P0-6, P0-7** — la valoración no inventa deuda ni crecimiento.
5. Alembic, limpieza de caché, traza FX, snapshot de decisión.
6. Test end-to-end con los siete escenarios de la Fase 4.
7. `docs/RC1_CHECKLIST.md`.
