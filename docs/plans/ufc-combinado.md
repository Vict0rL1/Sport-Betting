# UFC: un segundo intento, registrado antes de mirar

Escrito y subido **antes** de calcular nada. La UFC no pasó la prueba de publicación (ver
[../UFC.md](../UFC.md)): el Elo de luchador gana a la moneda, a «más peleas» y al Elo básico, pero
no queda demostrado que gane a «el de mejor récord» (en todo lo puntuable Δ −0,0028 [−0,0056,
+0,0000]; en 2025, +0,0038). Este es el segundo y último intento con estos datos. Si no pasa, la UFC
se queda en sombra y no se buscan más variantes hasta que haya algo nuevo (más temporadas o cuotas
para medir contra el mercado).

## Qué se prueba

Una regresión logística **sin término independiente** (así es simétrica: dar la vuelta a los dos
luchadores da la vuelta a la probabilidad) sobre diferencias entre los dos, todas con lo que se
sabía antes de la pelea:

| Rasgo | Qué es |
|---|---|
| `elo` | la diferencia de Elo del modelo vigente, en logit (Δ × ln 10 / 400) |
| `record` | logit(récord suavizado de uno) − logit(del otro), el récord de la referencia que no se ganó |
| `edad` | diferencia de edad el día de la pelea, en décadas (0 si falta una fecha de nacimiento) |
| `alcance` | diferencia de alcance, por 10 cm (0 si falta una medida) |
| `experiencia` | ln(1 + peleas en la UFC) de uno menos el del otro |

Dos candidatos, fijados aquí y ninguno más:

- **C1, Elo + récord**: `elo`, `record`.
- **C2, Elo + récord + ficha**: los cinco.

Penalización L2 fija, λ = 1 (no se ajusta). Las fechas de nacimiento y el alcance son de la ficha de
ufcstats: no cambian con el tiempo, así que no traen información del futuro. Que falte una medida
no se usa como rasgo, porque que falte depende en parte de cuánto peleó después el luchador.

## Cómo se evalúa

- **Walk-forward por año**: las predicciones del año Y salen de una logística ajustada solo con las
  peleas decididas de los años anteriores (desde 1994, calentamiento incluido). Así todas las
  predicciones puntuadas son fuera de muestra.
- **Se puntúan exactamente las mismas peleas** que en la prueba anterior (tras 500 de calentamiento,
  victorias de peleas atribuidas, sin el holdout).
- **Elección entre C1 y C2**: el menor log loss en los años de entrenamiento (puntuables, antes de
  2025). 2025 no se mira para elegir.
- **La prueba para publicar, una vez, con el elegido**: la misma regla de antes. Gana a las cuatro
  referencias (moneda, más peleas, mejor récord, Elo básico) con el intervalo del bootstrap
  emparejado por debajo de cero, **en todo lo puntuable y en 2025 por separado**. Y, para cambiar el
  modelo vigente, mejora al Elo solo en 2025 con el intervalo por debajo de cero.
- **2026 en adelante es el holdout**: no entra ni en el ajuste ni en la puntuación.

Los dos resultados (la elección y la prueba) van al registro de experimentos, salga lo que salga.

## Resultado

(Se rellena después de correrlo, sin cambiar nada de lo de arriba.)
