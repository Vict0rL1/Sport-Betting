# Funciones de producto (Fase 6)

Lo que se construye encima de los modelos, el banco de papel y los precios guardados. Ninguna de
estas funciones cambia una probabilidad publicada ni un parámetro del modelo, y ninguna toca una
fila de las tablas inmutables: leen de ellas y escriben en tablas propias. Cada una tiene su
interruptor en `config/features.json` y se apaga sin tocar código. El plan está en
[plans/phase-6.md](plans/phase-6.md).

## Laboratorio de estrategias

`estrategias.laboratorio` · Apuestas › Laboratorio · `GET/POST /api/estrategias`

Una estrategia es un banco de papel con nombre y su propia configuración: deportes, mercados (hoy
solo ganador), ventaja mínima, fracción de Kelly, tope por partido, exposición total y cortes por
pérdida diaria y semanal, más dos interruptores: si pasa por la capa de confianza (abstención y
recorte, como el banco principal) y si respeta el freno de calibración medido
(`experiments/calibration.json`, que deja a cero el tamaño de un deporte cuyo modelo pierde contra
el cierre). Parte siempre de la política vigente y se valida con los mismos rangos que una versión
de la política. Todas apuestan en paralelo, en el mismo ciclo que el banco principal y sobre las
mismas candidatas: las predicciones registradas con cuotas reales, nunca las de demostración. Cada
banco empieza en 1.000, lleva su exposición y sus pérdidas, y no ve las de los demás.

Una estrategia **no se edita**. Cambiar la ventaja mínima a mitad de camino mezclaría dos hipótesis
en un mismo registro; para probar otra cosa se crea otra estrategia y se archiva la vieja (una vez:
deja de apostar y lo pendiente se sigue liquidando). Las tablas `strategies` y `strategy_bets` viven
en el libro mayor con los triggers de `paper_bets`: lo de apostar queda congelado, el cierre se fija
una vez, la liquidación una vez y nada se borra.

La comparación pone el banco principal como fila de referencia y, por estrategia: banco, ROI, CLV
medio contra el cierre de consenso, caída máxima, acierto y apuestas. El orden es el de creación,
no el de rendimiento, y una fila con menos de 30 apuestas liquidadas dice que no se compara con
otras: ordenar por ROI con once apuestas sería coronar al azar.

**Una diferencia con el banco principal que conviene saber.** El corte por pérdida diaria y semanal
del banco principal lee el registro personal (`bets`), que es lo que `decideStake` hacía desde
antes de esta fase. Las estrategias leen sus propias pérdidas (`perdidas` en la petición de
`decideStake`). El banco principal no se ha cambiado aquí porque cambiaría sus decisiones; queda
anotado para revisarlo como cambio de política.

## «¿Qué habría pasado?»

`estrategias.historico` · Apuestas › Laboratorio · `GET/POST /api/estrategias/historico`

La política vigente, una estrategia guardada o una configuración sin guardar, reproducida sobre los
partidos históricos con cuota. Los escribe la corrida de referencia de los backtests de tenis
(tennis-data.co.uk, media de casas al cierre), fútbol (football-data.co.uk; Pinnacle temprano y de
cierre cuando están las dos) y NFL (nflverse, moneyline de cierre) en
`experiments/estrategias/<deporte>.json`: fecha, temporada, probabilidad del modelo fuera de
muestra y cuotas. Se recorre día a día con la misma `decideEvent` del banco de papel: las apuestas
de un día se dimensionan con el banco del inicio del día y la exposición acumulada de ese día, y
los cortes por pérdida usan lo realizado en la simulación.

Lo que no se puede reproducir se dice. Con solo la cuota de cierre se apuesta al cierre y el CLV
sería cero por construcción: sale DESCONOCIDO. La capa de confianza no existía en el pasado, así
que el histórico aplica solo la política de apuestas. Son los partidos con los que se desarrolló el
modelo, así que el resultado es optimista por construcción y no sustituye al banco en vivo. El
holdout final (fútbol 2026+, NFL 2024+) no entra: el fichero se escribe sin él y la lectura lo vuelve
a filtrar. Con la política vigente la NFL no apuesta nada —el freno de calibración la deja a cero— y
la pantalla lo explica; sin el freno, 2.114 apuestas entre 2010 y 2023 dejan el banco en 51,76 con
un ROI de −4,8 %, que es justo lo que el freno evita.
