# NHL (en sombra)

Sexto deporte, **en evaluación y sin publicar**. Interruptor `deportes.nhl`, apagado por defecto.
Mientras su backtest no esté en el registro de experimentos con la misma evidencia que los otros
cinco, la NHL no sale en las pestañas, ni en Destacados, ni en el banco de papel, ni en las
estrategias: está en `DEPORTES_SOMBRA` (`server/src/sports.ts`), no en `SPORT_IDS`. El plan está en
[plans/phase-8.md](plans/phase-8.md).

## Datos

`npm run update-data:nhl` baja, temporada a temporada, los partidos **terminados** de los
calendarios que publica sportsdataverse en GitHub (copia de la API de la NHL), de la 2009-10 a la
actual, a la tabla de historia `nhl_games`: fecha, temporada (por su año de inicio), tipo (regular o
playoffs), equipos por abreviatura, goles y la fuente. Esa fuente no dice si hubo prórroga o tanda:
`final_period` queda vacío (no se supone «REG»). El marcador final de la NHL ya cuenta la prórroga o
la tanda como un gol, que es como cuenta los totales el modelo.

**Marcadores de relleno.** Nueve temporadas del calendario (2009-10 a 2012-13 y 2018-19 a 2022-23)
traen un marcador falso: todos los partidos «3-2», o el local que gana siempre. La ingesta lo detecta
y toma los goles de las «team box» de la misma fuente, cruzadas por orden de fecha **solo si los dos
equipos coinciden en todos los partidos**; si no cuadra uno, la temporada no se guarda y la ingesta
lo dice. Las nueve cruzaron enteras.

`npm run update-data:nhl -- --fuente nhl --desde 2015-10-01 --hasta 2025-06-30` usa en cambio la API
web pública de la NHL (`api-web.nhle.com`), semana a semana, que sí dice cómo acabó cada partido. Si
una fuente no contesta, el comando lo dice y sale con error: no se escribe nada inventado. Cada
ejecución queda en `ingestion_runs`.

## Modelo

Un Elo de equipo (K 6, ventaja de campo de 35 puntos y multiplicador por diferencia de goles, como
el resto de deportes de equipo) y, encima, una Poisson por equipo. El reparto de los goles de la
liga entre los dos equipos se busca para que la probabilidad de ganar —prórroga y tanda incluidas,
a la mitad de la fuerza del Elo— sea exactamente la del Elo. De ahí salen el moneyline, el empate a
60 minutos y el total de goles, sin contradecirse. Los parámetros son los de partida: el ajuste por el registro (abajo) no encontró otros mejores de forma
demostrable.

## Evaluación

`npm run backtest:nhl` recorre los partidos en orden, predice cada uno con el Elo de antes de
jugarlo y lo puntúa (log loss, Brier, acierto y ECE) contra dos referencias: «siempre el local» con
su tasa histórica hasta ese día y un Elo básico sin margen ni Poisson. Los primeros 300 partidos
son calentamiento y no se puntúan. **El holdout final de la NHL empieza en la temporada 2025-26**
(`experiments/holdout.ts`): el Elo sigue el calendario por ella, pero no se puntúa ni se enseña.

Con 21.960 partidos (octubre de 2026), sobre los 20.214 puntuables de 2009-10 a 2024-25:

| | Log loss |
|---|---|
| Modelo | **0,6731** (Brier 0,2402, ECE 1,45 pp) |
| Siempre el local | 0,6896 · el modelo, −0,0165 [−0,0193, −0,0135] |
| Elo básico | 0,6805 · el modelo, −0,0073 [−0,0090, −0,0057] |

`npm run backtest:nhl -- --ajustar [--registrar]` prueba una rejilla de K, ventaja de campo y vuelta
a la media entre temporadas (elegida en 2009-10 → 2023-24, validada una vez en la 2024-25) y los goles
de la liga tomados de la última temporada. Ninguno mejora de forma demostrable a los valores de
partida; los dos experimentos están en el registro como no concluyentes.

Con el interruptor encendido, la misma evaluación sale en **Confianza › Diagnóstico** («NHL en
sombra») y en `GET /api/nhl/sombra`; el doctor cuenta los partidos guardados y avisa si el
interruptor está encendido con la tabla vacía.

## Para publicarla

1. Bajar la historia donde la red lo permita (`update-data:nhl`).
2. Ajustar K, campo y goles de liga como experimentos registrados, con validación en la 2024-25.
3. Ganar fuera de muestra a las dos referencias y, si hay cuotas, mirar el mercado.
4. Solo entonces, entrar en `SPORT_IDS` con sus pestañas, su registro de predicciones y su banco.
