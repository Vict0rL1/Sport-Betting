# Riesgo de cartera y coste de oportunidad

«AAPL es el 15 % de la cartera» dice dónde está el dinero. Aquí se contesta otra
cosa: **¿cuánto del riesgo de la cartera lo pone AAPL?** y **¿es esta idea nueva
mejor que lo que ya tengo, por lo suficiente como para pagar el cambio?**

## Contexto común: `backend/app/contexto_cartera.py`

Pesos y series en dólares, una sola vez, con las reglas de la cartera:

- varios lotes del mismo símbolo = una posición (también en `/api/portfolio/riesgo`
  y, para decidir, en `posiciones_para_decidir`: cantidad sumada, coste medio
  ponderado y el stop más protector de los fijados);
- sin precio → sin peso, fuera y nombrada (no vale cero);
- sin moneda o sin tipo de cambio → fuera y nombrada (no se supone dólar);
- cada serie se convierte con el tipo de **su** fecha: una acción canadiense mide
  también su riesgo de divisa.

Solo lee el histórico de la caché, salvo que se pida descargar.

## Contribución al riesgo: `portfolio_risk.contribucion_al_riesgo`

Descomposición de Euler de la volatilidad (anualizada, retornos diarios en fechas
comunes, ventana de dos años):

```
σ_p          = √(wᵀ Σ w)
marginal_i   = (Σw)_i / σ_p
componente_i = w_i · marginal_i        (suman σ_p)
%_i          = componente_i / σ_p      (suman 100 %)
```

Por posición: peso, volatilidad, contribución %, marginal, correlación y beta con
la cartera, beta frente a SPY si su serie está, **riesgo por unidad de peso** (>1:
aporta más riesgo que dinero), sector, industria y moneda. Concentración: top 3
por capital frente a top 3 por riesgo.

Una posición sin histórico suficiente queda **DESCONOCIDA**: se quita la más corta
hasta que el tramo común alcanza el mínimo, y el total dice qué fracción del peso
describe («el riesgo real es mayor que el medido, no igual»).

**Clústeres** (`clusters_de_riesgo`), modulares y con criterios objetivos:
sector, industria, moneda, correlación medida ≥ 0,70 (enlace simple,
`sizing.agrupar_por_correlacion`) y beta ≥ 1,3. Cada uno con su peso y su
contribución. No es un modelo de factores y no lo finge.

`riesgo_de_anadir` simula la idea nueva al peso que propone el motor (reescalando
el resto): volatilidad antes y después, su contribución y su correlación.

API: `GET /api/portfolio/contribucion?descargar=`. El análisis de empresa incluye
la sección `riesgo` (lo que aporta si la tienes; lo que aportaría si no).

## Coste de oportunidad: `analysis/coste_de_oportunidad.py` + `app/oportunidad.py`

No dice «vende X y compra Y». Concluye una de cinco:

| Veredicto | Cuándo |
|---|---|
| `NO_ACCION` | la señal de la idea no es de compra |
| `COMPRAR_CON_EFECTIVO` | el efectivo cubre el tamaño permitido |
| `REVISAR_PARA_FINANCIAR` | una posición es claramente peor, por más del umbral y los costes — candidata a **revisión**, no orden de venta |
| `NO_TRADE` | nada actual es claramente peor, o no cabe (y se cita el límite) |
| `INDETERMINADO` | falta un dato que decide: el efectivo (si no cabe con el efectivo desconocido, se dice que es una conclusión del supuesto) |

**Entradas, sin inventar ninguna.** Tamaño máximo del dimensionador de siempre
(cartera abierta, confianza de la idea como entrada declarada). Efectivo
anotado por el usuario (`POST /api/portfolio/efectivo`, migración 0008; la última
anotación por moneda manda; sin anotar = desconocido). De cada posición, su última
lectura **congelada** (acción, tesis, valoración, confianza): no se reanaliza la
cartera entera; sin lectura, «analízala primero».

**Reglas visibles.**

- *Atractivo* (idea y posiciones): señal (comprar +2 … vender −3), tesis
  (intacta +1, puntos cruzados −2), valoración frente a su historia (barata +1,
  cara −1: crecimiento implícito del DCF inverso frente al crecimiento histórico,
  con márgenes de −2 / +5 pp), confianza (alta +1, baja −1), riesgo por peso > 1,5
  (−1).
- *Prioridad de revisión*: el motor ya dice soltarla (+3 vender, +2 reducir), tesis
  con puntos cruzados (+3) o sin vigilancia (+1), cara (+2), riesgo por peso > 1,2
  (+1/+2), correlación ≥ 0,70 con la idea (+1: cambiarla no duplica exposición),
  evidencia baja (+1), sobreponderada (+1).

**Anti-churn.** Mejora mínima de 3 puntos **más** un punto por cada 1 % de coste
del cambio (comisión, horquilla y deslizamiento por lado, más divisa si cambia la
moneda, más impuestos si se indica el tipo). Con plusvalía e impuestos
desconocidos se exige un punto más y se dice que el coste real es mayor. Lo
comprado hace menos de 30 días no se propone. `NO_TRADE` es una respuesta válida
y frecuente.
