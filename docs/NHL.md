# NHL (en sombra)

Sexto deporte, **en evaluación y sin publicar**. Interruptor `deportes.nhl`, apagado por defecto.
Mientras su backtest no esté en el registro de experimentos con la misma evidencia que los otros
cinco, la NHL no sale en las pestañas, ni en Destacados, ni en el banco de papel, ni en las
estrategias: está en `DEPORTES_SOMBRA` (`server/src/sports.ts`), no en `SPORT_IDS`. El plan está en
[plans/phase-8.md](plans/phase-8.md).

## Datos

`npm run update-data:nhl -- --desde 2015-10-01 --hasta 2025-06-30` baja, semana a semana, los
partidos **terminados** de la API web pública de la NHL (`api-web.nhle.com/v1/schedule/{fecha}`) a
la tabla de historia `nhl_games`: fecha, temporada (por su año de inicio), tipo (regular o
playoffs), equipos por abreviatura, goles y cómo acabó (tiempo reglamentario, prórroga o tanda).
Lo que no ha terminado o no trae marcador se ignora; volver a bajar una semana no duplica. Si la
fuente no contesta, el comando lo dice y sale con error: no se escribe nada inventado.

**En el entorno donde se construyó, la red no alcanza `api-web.nhle.com`**: el código está probado
con respuestas simuladas, pero la tabla está vacía y no hay ninguna cifra real que enseñar.

## Modelo

Un Elo de equipo (K 6, ventaja de campo de 35 puntos y multiplicador por diferencia de goles, como
el resto de deportes de equipo) y, encima, una Poisson por equipo. El reparto de los goles de la
liga entre los dos equipos se busca para que la probabilidad de ganar —prórroga y tanda incluidas,
a la mitad de la fuerza del Elo— sea exactamente la del Elo. De ahí salen el moneyline, el empate a
60 minutos y el total de goles, sin contradecirse. Los parámetros son **de partida y sin ajustar**:
ajustarlos sin datos sería inventarlos.

## Evaluación

`npm run backtest:nhl` recorre los partidos en orden, predice cada uno con el Elo de antes de
jugarlo y lo puntúa (log loss, Brier, acierto y ECE) contra dos referencias: «siempre el local» con
su tasa histórica hasta ese día y un Elo básico sin margen ni Poisson. Los primeros 300 partidos
son calentamiento y no se puntúan. **El holdout final de la NHL empieza en la temporada 2025-26**
(`experiments/holdout.ts`): el Elo sigue el calendario por ella, pero no se puntúa ni se enseña.
Por debajo de 100 predicciones la cifra lleva su aviso de muestra.

Con el interruptor encendido, la misma evaluación sale en **Confianza › Diagnóstico** («NHL en
sombra») y en `GET /api/nhl/sombra`; el doctor cuenta los partidos guardados y avisa si el
interruptor está encendido con la tabla vacía.

## Para publicarla

1. Bajar la historia donde la red lo permita (`update-data:nhl`).
2. Ajustar K, campo y goles de liga como experimentos registrados, con validación en la 2024-25.
3. Ganar fuera de muestra a las dos referencias y, si hay cuotas, mirar el mercado.
4. Solo entonces, entrar en `SPORT_IDS` con sus pestañas, su registro de predicciones y su banco.
