# UFC (en sombra)

**En evaluación y sin publicar.** Interruptor `deportes.ufc`, apagado por defecto. Está en
`DEPORTES_SOMBRA` (`server/src/sports.ts`), no en `SPORT_IDS`: no sale en las pestañas, ni en
Destacados, ni en el banco de papel, ni en las estrategias, hasta que gane a sus referencias fuera
de muestra. El plan está en [plans/nhl-ufc.md](plans/nhl-ufc.md).

## Datos

`npm run update-data:ufc` baja los cuatro CSV que publica `Greco1899/scrape_ufc_stats` en GitHub
(rascados de ufcstats.com y actualizados cada semana): eventos con su fecha, resultados de las
peleas, luchadores y sus medidas. Van a tres tablas de historia (migración 15): `ufc_events`,
`ufc_fighters` y `ufc_fights`. Todo en una transacción: si falta un fichero o no trae ninguna pelea
legible, no se escribe nada. Cada ejecución queda en `ingestion_runs` (`ufc-greco1899`).

Lo que no se inventa:

- **Nombres ambiguos.** Las peleas solo traen nombres, y algunos los comparten varios luchadores
  (en octubre de 2026, 9 nombres y 52 peleas). Esas peleas se guardan sin atribuir (`ambigua`), no
  se puntúan ni mueven el Elo de nadie.
- **Peleas sin evento con fecha** (27): se descartan y se cuentan.
- **Medidas que no constan** («--»): NULL.

Con el archivo de octubre de 2026: 8.923 peleas guardadas en 791 eventos (la última, la UFC 332 del
3 de octubre de 2026) y 4.628 luchadores.

**El orden de la fuente no es información.** Hasta ~2009 la fuente pone siempre primero al ganador;
después, la esquina roja. Ni el modelo ni las referencias lo usan: la evaluación ordena a los dos
luchadores por su id de ufcstats, y un test comprueba que dar la vuelta a todas las peleas no cambia
ni una predicción. Dentro de un evento, la fuente lista la estelar primero; las peleas se recorren
de la primera a la estelar (`orden`), que importa en los torneos de los primeros eventos.

## Modelo

Un Elo de luchador (`server/src/ufc/model.ts`), simétrico: sin ventaja para nadie. K 48; las cinco
primeras peleas de cada uno en la UFC mueven su Elo ×1,5, porque del debutante no se sabe nada. El
empate cuenta medio punto; el «sin resultado» no mueve nada. Hay un parámetro para que ganar por KO
o sumisión cuente más que a los puntos; de partida, a cero.

## Evaluación

`npm run backtest:ufc` recorre las peleas en orden, predice cada una con el Elo de antes y la
puntúa (log loss, Brier, acierto y ECE). Solo se puntúan victorias de peleas atribuidas, tras 500
peleas de calentamiento. **El holdout final de la UFC empieza en 2026** (`experiments/holdout.ts`):
el Elo sigue el calendario por él, pero no se puntúa ni se enseña. La validación es 2025.

Cuatro referencias, todas simétricas y con lo visto hasta la pelea anterior:

- moneda al aire (50 %);
- el que lleva más peleas en la UFC, con la tasa histórica a la que eso ha ganado;
- el de mejor récord en la UFC (con suavizado de Laplace), con su tasa histórica;
- un Elo básico (K 32, sin debutantes ni finalizaciones).

`npm run backtest:ufc -- --ajustar [--registrar]` prueba una rejilla de K (24 a 80), cuánto más
aprende un debutante (×1 a ×3) y cuánto cuenta finalizar (+0 a +0,5), elegida en el entrenamiento
(→ 2024) y validada en 2025 contra los valores de partida; y después hace **la prueba para
publicar**: el modelo contra cada referencia, pelea a pelea con bootstrap emparejado, en todo lo
puntuable y aparte solo en 2025. Pasa si gana a todas, en los dos tramos, con el intervalo por
debajo de cero.

### Resultados (octubre de 2026)

La rejilla elige K 48, debutantes ×1,5 y finalizar +0,25, pero en la validación no mejora de forma
demostrable a los valores de partida (0,67624 → 0,67455, Δ −0,0017 [−0,0045, +0,0013], p 0,25): se
quedan los de partida.

Todo lo puntuable, sin holdout (7.799 peleas, 2005 → 2025): modelo **0,6802** (Brier 0,2436, acierto
56,1 %, ECE 0,62 pp).

| Referencia | Log loss | Δ modelo − referencia [IC 95 %] |
|---|---|---|
| Moneda al aire | 0,6931 | −0,0130 [−0,0166, −0,0092] |
| Más peleas en la UFC | 0,6944 | −0,0142 [−0,0181, −0,0101] |
| Mejor récord en la UFC | 0,6830 | −0,0028 [−0,0056, **+0,0000**] · p 0,055 |
| Elo básico | 0,6842 | −0,0040 [−0,0057, −0,0023] |

Solo 2025 (501 peleas): modelo 0,6762; contra «mejor récord» **+0,0038** [−0,0088, +0,0171], contra
el Elo básico −0,0066 [−0,0133, +0,0001].

**No pasa.** Gana con claridad a la moneda y a «más peleas», y al Elo básico en el conjunto, pero no
queda demostrado que gane a algo tan simple como «el de mejor récord»: en el conjunto el intervalo
toca el cero y en 2025 el récord fue mejor. La UFC sigue en sombra. Los dos experimentos están en el
registro. No hay cuotas históricas de la UFC alcanzables, así que tampoco hay comparación con el
mercado.

Con el interruptor encendido, la evaluación y la prueba salen en **Confianza › Diagnóstico** («UFC
en sombra») y en `GET /api/ufc/sombra`; el doctor cuenta las peleas y avisa si el interruptor está
encendido con la tabla vacía.

## Para publicarla

1. Un modelo que gane también a «mejor récord» fuera de muestra: por ejemplo, combinar el Elo con
   la experiencia y las medidas (alcance, edad) que ya están en `ufc_fighters`, como experimentos
   registrados con la misma validación.
2. Cuotas: The Odds API las tiene (`mma_mixed_martial_arts`); sin histórico, el mercado solo se
   podría medir hacia delante.
3. Solo entonces, entrar en `SPORT_IDS` con sus pestañas, su registro de predicciones y su banco.
