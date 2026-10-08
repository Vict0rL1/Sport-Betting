# Experimentos y métricas

Versiones, la capa común de métricas, el registro de experimentos, el holdout final y los estudios (`npm run study -- --list`).

## Qué versión produjo cada número

Cuando la app dice «Sinner 71,4 %», la predicción queda registrada con **qué versión exacta**
la produjo, y la respuesta de la API la incluye (`prediction.versiones`):

| Campo | Qué es |
| --- | --- |
| `model_version` | `tenis-3fa2c1d9e0b4`: huella del **código** del modelo de ese deporte |
| `model_config_version` | huella de `config/<deporte>.json` |
| `calibration_version` | huella de `experiments/calibration.json` y `postprocess.json` |
| `data_version` | hasta qué fecha y cuántos partidos había en la base |
| `git_commit` | el commit que corría (con `+cambios` si había cambios sin commitear) |
| `predicted_at` | cuándo |

Son **huellas de contenido**, no números que alguien sube a mano: si cambia un byte del
modelo, cambia la versión; si no, no. Un contador manual se olvida, y este proyecto ya tuvo
una constante copiada en cinco sitios de la que se quedaron dos atrás. `GET /api/versions`
da las vigentes.

Las versiones se fijan **una vez**, al registrar la predicción, y no se pueden cambiar
(trigger). A las predicciones anteriores a que esto existiera no se les estampa la versión de
hoy: se quedan sin ella, que es la verdad. El umbral de «posible valor» (5 pp), que estaba
copiado a mano en cuatro módulos, vive ahora en uno.

## Métricas: una sola capa, y el acierto no manda

`server/src/evaluation/metrics.ts` define **una vez** las métricas para los cinco deportes y
para cualquier origen:

| Métrica | Qué mide | Referencia |
| --- | --- | --- |
| **Log loss** (principal) | −media de ln p(lo que pasó): castiga decir 95 % a lo que no pasa | ln 2 = 0,693 decir siempre 50/50; ln 3 = 1,099 en fútbol |
| **Brier** | media de Σ (p − y)² / 2: para dos resultados es exactamente el Brier clásico | 0,25 decir siempre 50/50; 1/3 = 0,333 en fútbol (tres resultados) |
| **Calibración (ECE)** | cuánto se desvía «cuando digo X %, pasa X %» | 0 perfecto |
| Acierto (secundario) | cuántas veces ganó el favorito | no distingue un 51 % de un 90 % |

Ningún número va solo: se compara con el **mercado sobre los mismos partidos** y con no saber
nada. `GET /api/evaluation` da la evaluación **en vivo**, que solo lee predicciones registradas
antes de cada partido real (cada informe lleva `origen: 'live'`); ningún backtest entra ahí. La
pestaña Apuestas lo enseña en «El modelo en vivo». Cada informe trae además `porVersion`: las
mismas métricas partidas por la `model_version` que hizo cada predicción (las anteriores al
versionado, aparte y sin versión inventada), para que cuando el modelo cambie la cifra de la
versión vieja no tape a la nueva.

Los cinco backtests usan la **misma** capa: además de sus métricas propias (RPS, margen,
over/under…), cada uno termina con el bloque «Capa común de métricas» y lo guarda en
`experiments/backtest_metrics.json` (`origen: 'backtest'`, con la versión del modelo y de los
datos que lo produjeron; solo la corrida completa de referencia, no una liga suelta). Así un
0,613 del tenis y un 0,592 de la NBA se calculan igual y se pueden poner al lado de lo que pasa
en vivo, **sin mezclarse**: `verify:data` falla si ese fichero tiene una fila que no sea de
backtest, métricas rotas o la referencia equivocada. Cifras actuales:

| Deporte | Partidos | Log loss (no saber nada) | Brier (no saber nada) | ECE | Acierto |
| --- | ---: | --- | --- | ---: | ---: |
| Tenis (ATP) | 22.062 | 0,6133 (0,6931) | 0,2132 (0,2500) | 0,64 pp | 65,3 % |
| Fútbol | 20.824 | 1,0143 (1,0986) | 0,3037 (0,3333) | 0,78 pp | 49,4 % |
| Baloncesto (NBA) | 85.562 | 0,5919 (0,6931) | 0,2033 (0,2500) | 0,12 pp | 68,3 % |
| Béisbol (MLB) | 14.428 | 0,6756 (0,6931) | 0,2414 (0,2500) | 0,58 pp | 57,3 % |
| NFL | 3.781 | 0,6284 (0,6931) | 0,2194 (0,2500) | 0,46 pp | 64,3 % |

En la NFL, contra el cierre real sobre los mismos 3.780 partidos: modelo 0,6285, mercado 0,6114 (sin el holdout final 2024+, que el backtest de la NFL antes puntuaba por error; ver docs/CONFIANZA.md).
El mercado es mejor, y así se dice. (La capa común deja fuera los empates, cuyo moneyline se
devuelve; las cifras propias del backtest de la NFL los cuentan como medio acierto, de ahí que
difieran en la cuarta cifra.)

## ¿Se gana el sitio cada pieza del modelo de tenis? (`npm run study:ablation`)

El modelo de tenis es el buque insignia de esta app y **no tenía ni un solo experimento
registrado sobre predicción**: los 20 que había en el registro eran de fútbol y de la NFL.
Sus seis piezas —superficie, margen de victoria, forma, cara a cara, inactividad,
calibración por formato— se midieron cada una en su momento, pero ninguna pasó por el
registro, ni por un intervalo de confianza, ni por la corrección por comparaciones
múltiples.

Eso importa por una razón concreta: **con seis piezas aceptadas una a una a p<0,05, el azar
regala una falsa cada tres estudios.** Así que se apagan una a una y se mide cuánto empeora
el log loss al quitarlas.

| pieza apagada | Δ log loss | IC 95 % | p | veredicto |
| --- | --- | --- | --- | --- |
| Elo por superficie | **+0,00371** | [+0,00233, +0,00521] | 0,0020 | **se gana el sitio** |
| margen de victoria | **+0,00352** | [+0,00282, +0,00425] | 0,0020 | **se gana el sitio** |
| calibración por formato (bo3/bo5) | **+0,00166** | [+0,00115, +0,00214] | 0,0020 | **se gana el sitio** |
| penalización por inactividad | **+0,00052** | [+0,00022, +0,00082] | 0,0020 | **se gana el sitio** |
| cara a cara | **+0,00051** | [+0,00021, +0,00082] | 0,0020 | **se gana el sitio** |
| forma reciente | +0,00012 | [−0,00026, +0,00050] | 0,5235 | no se distingue de cero |

Δ positivo = quitarla **empeora** = la pieza sirve. Las cinco primeras pasan Bonferroni
y Benjamini–Hochberg sobre las seis comparaciones.

### La que no se resuelve, y qué NO se ha hecho con ella

**Nada.** La forma reciente da +0,00012 con un intervalo que cruza el cero por los dos
lados. Borrar una pieza por un resultado nulo es el mismo error que añadirla por uno: en
los dos casos se está decidiendo con evidencia que no alcanza. Y el intervalo además es
**estrecho** —±0,0005—, así que esto no es «falta muestra», es «el efecto sobre el número
es pequeño». Sigue apareciendo en la tarjeta («llega con 10 victorias seguidas») porque
**describe** algo cierto y útil de leer, pero conviene saber que su efecto sobre la
probabilidad no está demostrado.

### El resultado dudoso que sí tenía arreglo: el peso de la superficie

En la primera pasada el Elo por superficie salió **inconcluyente** (+0,00192, p=0,0559) y
con el intervalo más ancho de los seis. La lectura fácil era «la superficie no está clara».
La lectura correcta era otra: si una pieza que debería ser de las más informativas del
tenis apenas se distingue de cero, lo sospechoso no es la pieza sino **cuánto se la estaba
haciendo pesar**.

El modelo mezcla el Elo de superficie con el general (`Elo = w·superficie + (1−w)·general`)
y `w` valía 0,7 desde el primer día, elegido a ojo y nunca medido. Así que se midió, con el
periodo partido en dos para que la elección y la comprobación no se hicieran sobre los
mismos partidos:

```
  peso de superficie
    valor      elección     prueba
    0.3         0.60942    0.62191 ←mejor en prueba
    0.5         0.60924    0.62198 ←mejor en elección
    0.7         0.61097    0.62389 (publicado)
```

El valor que gana **sin ver el periodo de prueba** es 0,5, y en el periodo de prueba también
le gana al publicado. Eso es lo que se pide para publicar; que 0,3 salga 0,00007 por delante
de 0,5 en la prueba no cambia nada, porque a 0,3 solo se llega mirando la prueba.

Medido aparte, solo sobre los 7.050 partidos posteriores a 2023 (321 ediciones de torneo):

| | log loss |
| --- | --- |
| publicado (w = 0,7) | 0,62389 |
| candidato (w = 0,5) | **0,62198** |
| diferencia | **−0,00190** [−0,00301, −0,00068] · p = 0,0020 |

El intervalo entero está por debajo de cero. **Publicado.** Y sobre el backtest completo de
22.062 partidos el efecto se sostiene: log loss **0,6151 → 0,6133**, Brier **0,2140 →
0,2132**, acierto **65,2 % → 65,3 %**.

Con el peso corregido, la ablación vuelve a correrse contra el modelo que ahora se sirve, y
el resultado dudoso deja de serlo: quitar el Elo por superficie pasa de +0,00192 (p=0,0559)
a **+0,00371 (p=0,0020)**. La pieza siempre sirvió; lo que fallaba era la dosis.

### ¿Puede el modelo llegar al 80 %? No, y se puede calcular

La pregunta tiene una respuesta que no depende de lo listo que sea el modelo.

Un modelo **bien calibrado** que dice 60 % acierta el 60 % de esas veces. Su acierto
esperado sobre todos los partidos es, por tanto, la media de `max(p, 1−p)` — la
probabilidad del lado que elige. Y como la calibración de este modelo está medida
(ECE 0,64 pp sobre 22.062 partidos), sus probabilidades son aproximadamente las de
verdad. Así que esa media es **el techo de cualquier modelo calibrado sobre estos
partidos**:

```
TECHO TEÓRICO: 65.9 % — la media de la probabilidad del favorito.
  Partidos donde el favorito pasa del 80 %: 2813 de 22062 (12.8 %).
```

El modelo está en **65,3 %**. A seis décimas de su máximo teórico. Superarlo de forma
sostenida no exigiría un modelo mejor, exigiría **partidos menos igualados**: un 7-6 en el
quinto set no se vuelve predecible por mirarlo más fuerte.

`npm run backtest` lo imprime, para que no haya que creérselo.

### Lo que sí llega al 80 %: el filtro de confianza

El modelo acierta el 65 % de **todo**, y el 87 % de aquello en lo que dice 80 % o más. No
es otro modelo: es el mismo sobre menos partidos, y lo que se paga es **cobertura**.

| umbral | partidos | % del total | acierto real medido |
| --- | --- | --- | --- |
| todos | 22.062 | 100 % | 65,3 % |
| 60 %+ | 13.934 | 63,2 % | 72,0 % |
| 70 %+ | 7.243 | 32,8 % | 79,2 % |
| **80 %+** | **2.813** | **12,8 %** | **86,7 %** |
| 90 %+ | 647 | 2,9 % | 94,4 % |

La tabla de partidos tiene ahora ese filtro, y **el umbral siempre va con el acierto
medido y el número de partidos sobre el que se midió**. Un filtro que solo enseña la lista
insinúa que filtrar por 80 garantiza acertar el 80 — y eso solo es cierto si el modelo
está calibrado justo ahí, cosa que aquí está medida y por eso se puede afirmar.

Los números salen del mismo backtest que ya calculaba las cubetas, por el mismo motivo
que el ECE: duplicar el cálculo crearía dos verdades del mismo deporte.

**Los cinco deportes tienen ya su acierto medido por umbral** (acierto del favorito,
walk-forward, sin tocar el holdout):

| umbral | Tenis | Baloncesto | Fútbol | NFL | Béisbol |
| --- | --- | --- | --- | --- | --- |
| 60 %+ | 72,0 % · 13.934 | 73,6 % · 61.112 | 71,0 % · 3.582 | 71,6 % · 4.428 | 64,4 % · 4.595 |
| 70 %+ | 79,2 % · 7.243 | 79,4 % · 36.965 | 77,2 % · 1.288 | 79,3 % · 2.146 | 70,9 % · 492 |
| 80 %+ | 86,7 % · 2.813 | 85,5 % · 16.705 | 85,8 % · 309 | 85,2 % · 610 | — |

El «—» del béisbol no es un hueco: su modelo casi nunca pasa del 80 % (menos de 200
partidos en todo el archivo), y la tabla lo dice así en vez de enseñar el acierto del 70 %
bajo el filtro del 80, que es lo que hacía la primera versión.

En fútbol el empate cuenta como **fallo** del favorito, y el favorito es el mayor de local
y visitante —nunca el empate—, igual que en la tabla. Y cada banda se mide sobre la
probabilidad que **se enseña**, no sobre la cruda: en la NFL la final es casi el precio
(peso del modelo 0,10), y medir el crudo habría filtrado por un número y prometido el
acierto de otro.

#### Lo que destapó: el fútbol se calibraba sobre el modelo equivocado

`verify:data` comprueba ahora cada banda contra lo que el modelo **prometió** en ella (su
probabilidad media), con una tolerancia de tres errores estándar. En su primera pasada
falló el fútbol: el favorito del 50 %+ prometía un 61,0 % y acertaba un 58,5 %, sobre
10.446 partidos — cinco errores estándar, no mala suerte.

No era el modelo. Era `study:calibration`, que medía el **Elo de respaldo** en vez del
Dixon-Coles jerárquico que usa la app en 6 de cada 7 partidos:

| | victoria local: dice / pasa | favoritos 50 %+: prometen / aciertan |
| --- | --- | --- |
| Elo (lo que se medía) | 46,2 / 43,1 | 61,0 / 58,5 |
| Dixon-Coles (lo que se enseña) | 43,4 / 43,1 | 60,2 / 60,9 |

El Elo sobreestima la ventaja de campo en tres puntos; el Dixon-Coles la ajusta por liga y
con decaimiento temporal y la clava. El ECE que lee el sizing también venía del Elo
(0,720 pp); medido sobre el camino real es **0,683 pp** (0,856 tras bajar la ventaja de campo
del Elo a 35 — ver la sección del fútbol: con cubetas de 5 puntos sobre los 3.461 partidos del
Elo el ECE es ruidoso, y por cubetas de 10 puntos y por log loss el cambio mejora). El banco de papel no cambia —en
fútbol ya estaba topado a la mitad por no tener cuotas históricas—, pero ahora el número
describe al modelo que apuesta.

Comprobado que la comprobación sirve: con el signo de la línea de la NFL invertido a
propósito, compararla con el umbral cazaba 1 de las 4 bandas rotas; compararla con lo
prometido caza las 4.

#### Y un fallo de escritura que borraba tres deportes

`experiments/calibration.json` lo escriben cuatro procesos, y `study:calibration`
construía el suyo desde cero: correrlo **borraba** tenis, baloncesto y béisbol (medido:
cinco deportes antes, dos después). Sin calibración el sizing falla cerrado, así que el
banco de papel dejaba de apostar en tres deportes sin avisar de la causa. Ahora
`writeCalibration` mezcla por deporte, y `verify:data` exige los cinco.

### Se buscó una mejora más y no la hay: diez parámetros barridos, cero candidatos

Después de corregir el peso de superficie quedaba la pregunta obvia: ¿y los demás? El
modelo tiene diez números que se pueden mover, y cinco de ellos —el encogimiento del cara
a cara, la ventana de la forma, su decaimiento, su tope y los dos factores de
calibración— **nunca se habían medido**. Estaban puestos a mano desde el primer día,
exactamente la situación en la que estaba el peso de superficie antes de resultar que
estaba mal.

`npm run study:ablation -- --sweep` los barre todos, eligiendo en 2015–2022 y midiendo en
2023 en adelante. **Ninguno da un candidato.** El mejor, el peso de superficie a 0,4,
mejora 0,00027 en el periodo de prueba: por debajo del umbral de 0,0005 y muy por debajo
de lo que este tamaño de muestra puede distinguir del ruido. El resto se quedan entre
0,00001 y 0,00015, y tres de ellos salen peor.

### Y la combinación de todas tampoco (`--conjunto`)

Diez mejoras de 0,0002 podrían sumar una de 0,002, que sí se mide. Es una hipótesis
distinta y merece su propia prueba, así que se hizo: descenso por coordenadas sobre los
diez parámetros, **105 configuraciones evaluadas, todas usando solo partidos anteriores a
2023**. El segundo periodo no participó en ninguna decisión.

La búsqueda encontró lo que suele encontrarse cuando se buscan 105 cosas:

```
  elección: 0.60924 → 0.60829  (mejora 0.00095)
  Cambia: surfaceWeight 0.5→0.4 · movWeight 4→8 · h2hMax 35→50 · restPenalty 60→80
          formWindow 10→3 · formDecay 0.85→0.6 · formCap 40→20 · bo5Scale 0.86→0.94
```

Ocho parámetros cambiados y casi una milésima de mejora. En el periodo que no vio:

| | log loss |
| --- | --- |
| publicado | 0,62198 |
| conjunto | 0,62177 |
| diferencia | **−0,00021** [−0,00126, +0,00075] · p = 0,70 |

**El intervalo cruza el cero por los dos lados.** De los 0,00095 que ganaba al elegir
sobreviven 0,00021, que no se distingue de cero. Eso no es mala suerte: es la definición
de sobreajuste, medida. Con 105 configuraciones probadas, la mejor gana por una mezcla de
efecto y de ruido que le vino de cara, y el ruido no viaja al periodo siguiente.

Si el segundo periodo hubiera participado en la búsqueda, esto se habría publicado como
una mejora del 0,1 % con ocho parámetros retocados. No se publica nada.

**La conclusión útil es la que no se buscaba:** el modelo publicado ya está en su óptimo
dentro de esta rejilla. La única mejora real que había —el peso de superficie— ya está
aplicada, y por eso ninguna otra aparece.

### Dos señales NUEVAS, que es donde quedaba margen. Tampoco

Reajustar los diez parámetros no podía dar nada más: el barrido y la búsqueda conjunta
dicen que están en su óptimo. Lo único que quedaba para mejorar de verdad era
**información que el modelo no ve**, y hay dos que se derivan de lo ya guardado sin
descargar una sola fila más:

- **Cambio de superficie.** El tenis cambia de suelo tres veces al año y el ajuste tarda.
  Quien sale de la gira de tierra y juega su primer partido en hierba no es el mismo que
  quien lleva un mes en hierba — y el Elo por superficie *no* lo capta: ese sabe lo bueno
  que es en hierba en general, no que acaba de llegar.
- **Fatiga acumulada.** El modelo penaliza el exceso de *descanso* (vueltas de lesión) y
  no tiene nada para lo contrario. En un Masters se juegan cinco partidos en siete días, y
  el quinto no se juega con las piernas del primero.

Las dos entran a cero —el modelo de hoy— para que el barrido mida literalmente cuánto
aporta encenderlas.

**La fatiga sale al revés y sin ambigüedad:**

```
  fatiga por partido en 7 días
    valor      elección     prueba
    0           0.60924    0.62198  ←mejor en los dos (publicado)
    5           0.60944    0.62207
    12          0.61005    0.62249
    25          0.61225    0.62417
```

Cero es el óptimo y empeora **monótonamente**. La explicación más plausible es que la
carga está confundida con la causa: quien juega cinco partidos en una semana es quien los
va ganando, y eso el modelo ya lo sabe por el Elo y la forma. Penalizarlo es penalizar
estar jugando bien.

**El cambio de superficie sí apunta en la dirección correcta**, con un mínimo limpio en 30
puntos Elo y mejorando en los dos periodos. Pero medido como toca, sobre los 7.050
partidos que la búsqueda no vio:

| | log loss |
| --- | --- |
| publicado (sin la señal) | 0,62198 |
| con castigo de 30 | 0,62191 |
| diferencia | −0,00007 [−0,00046, +0,00028] · p = 0,71 |

El intervalo cruza el cero por los dos lados. **No se publica.** El efecto puede ser real
—la forma de la curva lo sugiere— pero es de un orden que estos 7.050 partidos no pueden
distinguir del ruido, y cambiar el modelo por eso es moverlo por moverlo.

Las dos quedan medidas y en el registro. Si algún día hay más histórico, el candidato ya
está escrito y se vuelve a probar con un comando.

### Por qué estos negativos son creíbles

Un resultado negativo solo vale si lo que se apagó era de verdad lo que está en producción.
Por eso el estudio **se niega a publicar** si su réplica del modelo se desvía de
`npm run backtest` en más de 0,0002:

```
Modelo publicado: log loss 0.61331 sobre 22062 partidos
Coincide con `npm run backtest` (0.6133) · desvío 0.000010
```

Comprobado que la guarda muerde: es exactamente lo que hizo al cambiar el peso de superficie
de 0,7 a 0,5 en producción sin traerlo aquí — abortó con «se han separado» en vez de publicar
una ablación de un modelo que ya no existía.

Dos detalles del método que cambian el resultado:

- **Bootstrap por bloques de torneo, no por partido.** Los partidos de una misma edición
  comparten superficie, bolas, altura y semana. Remuestrear partidos sueltos trataría 22.062
  observaciones como 22.062 casos independientes e inflaría la significación. Se remuestrean
  las 1.004 ediciones enteras.
- **Con 200 remuestreos el p mínimo posible es 0,00995**, por encima del listón de Bonferroni
  (0,00833). Cuatro resultados salían clavados en ese suelo y no habrían podido pasar la
  corrección aunque el efecto fuese enorme. Con 1.000 el suelo baja a 0,002 y se resuelven.
  El estudio ahora **se niega a registrar** por debajo de 500 remuestreos.

## El modelo jerárquico de puntos (`npm run study:points`)

Saque y resto por jugador ajustados por la calidad del rival, propagados por la cadena de
Markov, con desviaciones por superficie encogidas. Y de ahí **todos** los mercados:
partido, set, hándicap de juegos y total de juegos.

### El resultado primero: NO reemplaza al modelo de partido

El encargo era reemplazar el modelo de partido por este. Lo construí, lo medí cara a cara
fuera de muestra con walk-forward, y **pierde**:

Sobre 5.667 partidos de ATP desde 2024, walk-forward con reajuste trimestral:

| modelo | log loss del ganador |
| --- | --- |
| Elo por jugador con ajuste de superficie (el publicado) | **0.558** |
| modelo de puntos, mejor de 8 configuraciones (λ 0.20 · 1 año) | 0.663 |
| modelo de puntos, peor de las 8 (λ 0.05 · sin decay) | 0.680 |

No es un empate discutible: 0.68 está a un paso del 0.693 de la moneda. Forzar la
sustitución habría sido cambiar un modelo medido por uno más elegante.

**Por qué, con lo que se puede afirmar desde aquí:** las tasas de punto agregadas **tiran
la información de quién ganó**. Se puede ganar el 63 % de los puntos al saque y perder el
partido por haber perdido los importantes, y este modelo no distingue las dos cosas. El
Elo aprende de victorias, que es justo lo que se está prediciendo.

Y el modelo de Elo de esta app no es un Elo pelado: lleva forma reciente, fatiga, cara a
cara y superficie, cada cosa medida por separado en su momento.

### Comprobé que la ventaja del Elo no fuera un artefacto

El Elo se evalúa con sus ratings **actuales**, que en principio podrían filtrar el
futuro. Si eso lo estuviera inflando, los partidos más antiguos puntuarían mejor —el
rating de hoy sabe cómo acabaron. Sale lo contrario:

| periodo | log loss del Elo |
| --- | --- |
| 2023 H1 | 0.591 |
| 2024 H1 | 0.556 |
| 2025 H1 | 0.548 |
| 2025 Q4+ | 0.535 |

Mejora hacia el presente, que es lo que produce la *obsolescencia* del rating, no la
filtración. Y aun en su peor periodo (0.591) le gana al mejor del modelo de puntos
(0.663).

### Lo que el modelo de puntos SÍ aporta, y es el motivo de que se publique

Mercados que el modelo de partido **no puede producir en absoluto**. El Elo da un número:
la probabilidad de ganar. No da una distribución de juegos, así que no hay hándicap ni
total que derivar de él.

El de puntos enumera el partido entero y de ahí sale todo:

```
GET /api/points?tour=atp&p1=…&p2=…&surface=Clay&bestOf=5&tourney=Roland+Garros

  puntos: p1=0.6209 p2=0.5985      ← los DOS únicos números de entrada
  partido 64.1 % · set 57.6 % · 40.9 juegos esperados
  sets:      3-1 24.3% · 3-2 20.7% · 3-0 19.1%
  totales:   +37.5 64% · +39.5 56% · +41.5 48% · +43.5 41%
  hándicaps: −6.5 24% · −4.5 40% · −3.5 47% · −2.5 53% · −1.5 58%
```

**No pueden contradecirse.** Con modelos separados por mercado es perfectamente posible
publicar un 70 % de ganar el partido y un total de juegos que implique un 60 %, y nadie
se entera hasta que alguien lo suma a mano.

Y el total de juegos **se puntuó contra el marcador real**, que es la única forma de
defender que esto aporta algo. Sobre 5.472 partidos con marcador completo:

| | log loss del total de juegos |
| --- | --- |
| modelo de puntos | **0.674** |
| distribución marginal (no saber nada) | 0.724 |

Aporta 0.050 sobre no saber nada. El Elo no aparece en esa tabla porque no puede: no
produce una distribución de juegos.

### El ajuste por rival, y por qué no basta restar medias

«Este jugador gana el 68 % de sus puntos al saque» está contaminado: se midió contra los
restadores que le tocaron. La versión anterior (`live/serve.ts`) restaba medias de
carrera, que es la corrección de primer orden y arrastra el mismo sesgo — restar dos
números contaminados no descontamina ninguno.

Aquí se estiman **todos los saques y todos los restos a la vez**:

```
logit P(i gana un punto sacando contra j) = μ_superficie + s_i − r_j
```

Descenso de gradiente sobre la verosimilitud binomial, ~8.800 parámetros, 58.652
observaciones. Y el resultado se valida solo:

| mejor saque | | mejor resto | |
| --- | --- | --- | --- |
| Ivo Karlovic | +0.374 | Novak Djokovic | +0.267 |
| John Isner | +0.357 | Rafael Nadal | +0.252 |
| Milos Raonic | +0.330 | Carlos Alcaraz | +0.245 |
| Roger Federer | +0.327 | Jannik Sinner | +0.212 |

Son las listas canónicas, y el modelo no las recibió de nadie.

### Las superficies salen del ajuste, no de una tabla

Los interceptos por superficie: **hierba 66.0 % > dura 64.6 % > tierra 62.0 %** de puntos
al saque. Es el orden conocido y el ajuste lo deriva de los datos — hay una comprobación
en `verify:data` que falla si sale al revés, porque entonces el modelo estaría aprendiendo
otra cosa.

**¿Aportan las desviaciones por superficie?** Sí, pero solo con el encogimiento fuerte —
y esa condición es el hallazgo:

| configuración | log loss |
| --- | --- |
| λ 0.20 · 1 año (con δ, encogidas fuerte) | **0.66267** |
| **sin δ de superficie** | 0.66580 |
| λ 0.05 · 1 año (δ con poco encogimiento) | 0.66724 |

Con encogimiento fuerte las superficies ganan 0.0031. Con encogimiento flojo son **peores
que no tenerlas**: los δ de las muestras pequeñas dejan de ser especialización y pasan a
ser ruido con nombre. El shrinkage no es un adorno del modelo, es lo que hace que la parte
de superficie aporte algo en vez de restar.

Y las desviaciones individuales, con λ = 0.05:

| jugador | superficie | δ saque | δ resto |
| --- | --- | --- | --- |
| Nadal | tierra | +0.037 | **+0.096** |
| Federer | tierra | +0.022 | −0.032 |
| Federer | hierba | +0.050 | +0.039 |
| Isner | tierra | +0.056 | **−0.068** |

El δ más grande de la tabla es el resto de Nadal en tierra, que es exactamente donde
está su dominio. Isner al resto en tierra es su peor casilla. Correcto en los dos casos.

**Un error mío al leer esto:** primero resumí las superficies como `δ saque − δ resto` y
Nadal salía *negativo* en tierra, que parecía invertido. La métrica compuesta era la
equivocada — separados, el modelo dice lo correcto. Investigar antes de "arreglar" evitó
romper un modelo que funcionaba.

### Las variantes de tiebreak del set final

No es un detalle: cambia el total de juegos esperado y, con dos sacadores parejos, también
quién gana. Están en un solo sitio con su fecha, así que el pasado se puntúa con las
reglas que regían entonces:

* hasta 2018 — Wimbledon, Roland Garros y Australia: set largo
* 2019-2021 — cada Grand Slam con su regla (Australia TB a 10, US Open TB a 7, Wimbledon
  y Roland Garros efectivamente largos)
* desde 2022 — los cuatro con **tiebreak a 10**

### El decay se midió, no se supuso

Sin decay, el modelo describe una carrera entera y no al jugador que juega mañana:

Barrido sobre 1.460 partidos de 2025 con un solo ajuste previo (más rápido que el
walk-forward, y suficiente para ordenar las opciones entre sí):

| semivida | log loss |
| --- | --- |
| sin decay | 0.660 |
| 4 años | 0.654 |
| 2 años | 0.651 |
| **1 año** | **0.650** |
| 6 meses | 0.652 |

Se publica un año, y el walk-forward lo confirma (0.663 con decay contra 0.676 sin, a
λ 0.20).
Ayuda, pero no cierra la distancia con el Elo — que es la parte importante del resultado.

> Los números de esta tabla y los de la comparación de arriba **no son comparables entre
> sí**: estos salen de un ajuste único sobre 2025 y aquellos de un walk-forward sobre
> 2024-2026. Sirven para ordenar configuraciones, no para compararse con el Elo.

### Una fila del barrido que no medía nada

Para responder «¿aportan las desviaciones por superficie?» apagué las superficies poniendo
λ = 10⁶. **No las apaga: hace divergir el ajuste.** Con λ = 100 ya salen 2.003 de 3.126
desviaciones no finitas y la verosimilitud es NaN — el paso de la penalización es λ·δ·lr,
o sea cincuenta veces δ en sentido contrario, así que oscila y explota.

Lo que delató la fila fue que daba **1.05661 idéntico para los cuatro decays**. El decay
tiene que cambiar algo; que no cambiara nada era la señal de que el número no venía de
ningún modelo.

Dos arreglos, y el segundo importa más que el primero:

* `useSurface: false` apaga las desviaciones de verdad.
* **`fitPoints` ya no devuelve un ajuste divergido en silencio.** Comprueba λ·lr antes de
  gastar ocho segundos, y comprueba que la verosimilitud y los parámetros sean finitos
  antes de devolver. Un modelo con NaN dentro sigue produciendo «probabilidades»
  perfectamente pintables: `sigmoid(NaN)` es NaN, y un NaN comparado con un umbral es
  siempre falso, así que acaba en un 0 % o un 50 % sin explicación.

### Un fallo de rendimiento que hacía el modelo inservible

`matchDistribution` al mejor de 5 tardaba **2,2 segundos**: 3,7 horas para evaluar una
temporada. La causa era mía — el árbol guardaba un nodo por *camino*, y un set tiene ~14
finales posibles, así que un mejor de 5 son 14⁵ ≈ 537.000 caminos.

Dos caminos que llegan a los mismos sets, los mismos juegos y el mismo sacador son **el
mismo estado**: lo que pase después no depende de cómo se llegó. Fusionándolos y cacheando
la enumeración del set, 2.229 ms → **7 ms**. El modelo era correcto y completamente
inservible.

### Comprobado por conservación y contraste cruzado

Una distribución mal repartida sigue pareciendo una distribución. Lo que se comprueba son
las masas (todas suman 1 a 1e-9) y, sobre todo, que la **enumeración** de
`points/markets.ts` y la **recursión** de `live/markov.ts` calculen la probabilidad de
partido por caminos completamente distintos y coincidan a 1e-9. Dos implementaciones que
se equivoquen igual son mucho menos probables que una que se equivoque sola.

---

## El motor en vivo (`npm run study:live`)

Dado el marcador exacto —sets, juegos, puntos y quién saca— la probabilidad de victoria
en tiempo real, con una cadena de Markov punto a punto.

### No había ninguna cadena de Markov. Había que construirla

El encargo decía «la misma cadena de Markov». No existía: el modelo de tenis va de Elo a
una probabilidad de partido y de ahí **baja** a una por set invirtiendo una fórmula
cerrada. Nunca modeló puntos, ni juegos, ni el saque.

Para una predicción previa eso basta. Para una en vivo no sirve: con 4-5 y 30-40 en
contra, lo que decide el partido es el punto que se juega ahora. Así que la cadena se
construyó de abajo arriba —punto → juego → set → partido— y **todo se calcula desde
cualquier estado**, que es la diferencia entre un modelo previo y uno en vivo.

### Validada contra una simulación independiente

Una cadena mal montada no lanza excepciones: devuelve números plausibles. Los 9 casos
cuadran con 300.000 partidos simulados por una implementación separada que juega los
puntos de verdad; mayor diferencia **0.0014**. Y con los valores de libro: `p = 0.60` da
`0.7357` de ganar el juego, deuce da `0.6923`, `p = 0.50` da exactamente `0.5`.

El 6-6 del tiebreak se resuelve **exacto**, no truncando: desde un empate, la
probabilidad de llevarse los dos puntos siguientes no depende de quién saque primero de
los dos, porque `p1·(1−p2)` es conmutativo. Por eso 20-20 devuelve idéntico a 6-6.

**Un resultado que parecía un fallo y no lo era:** con el marcador empatado (0-0, 3-3,
5-5) la función devuelve lo mismo saque quien saque, hasta el último decimal. La
simulación reproduce los valores idénticos por su cuenta: desde un empate, cualquier
continuación reparte los mismos juegos al saque entre los dos. "Arreglarlo" habría roto
un modelo correcto.

### Actualización bayesiana del saque: κ = 63 puntos, medido

Un jugador va 1 de 12 con su saque. ¿Mal día o doce puntos? Las dos respuestas fáciles
están mal: «ignorarlo» supone que el saque es una constante de la carrera, y «creérselo»
convierte doce puntos en una probabilidad de partido.

La respuesta es un peso, y el peso se mide. Descomposición de varianza sobre **58.732
actuaciones al saque**:

```
varianza observada dentro de un jugador   0.006805
componente binomial esperado             −0.003192
─────────────────────────────────────────────────
variación REAL partido a partido          0.003613  →  κ = 63 puntos
```

| puntos servidos hoy | peso frente a su carrera |
| --- | --- |
| 10 | 14 % |
| 40 | 39 % |
| 100 | 61 % |

**Y el hallazgo que justifica la funcionalidad entera:** σ de un jugador entre partidos
es **6.0 pp**; la que separa a los jugadores entre sí es **2.7 pp**. Un jugador varía más
consigo mismo, de un día a otro, que lo que los jugadores se diferencian entre ellos.
Comprobado por dos rutas — la descomposición agregada y las desviaciones individuales de
Zverev (6.1), Djokovic (5.0), Bautista (6.2), Medvedev (5.5), Rublev (5.4) y Fritz (6.1).

Con eso, un jugador sacando 20 pp por debajo de su media sobre 48 puntos pasa de
**36.1 % a 15.5 %** de ganar el partido. Eso es «actualizar en vez de ignorarlo», a un
ritmo que sale de los datos.

### Situaciones: la etiqueta no es la información

«Break point» en rojo no dice nada que no se vea en el marcador. Lo que importa es cuánto
mueve el partido ese punto, y la cadena lo da exacto:

| situación | vale |
| --- | --- |
| break point a 2-2 en el primer set | **6.5 pp** |
| break point a 5-5 en el set decisivo | **41.8 pp** |
| break point a 2-5, con el set perdido | **1.6 pp** |

Los tres se llaman «break point». Solo el número los distingue.

Se detectan break point (con cuántas bolas seguidas), punto de set, punto de partido,
sacar para el set y sacar para el partido — comprobando qué pasaría si alguien ganara el
punto, no reconociendo marcadores de memoria, así que no puede desincronizarse de las
reglas que usa la cadena.

### El momentum tras un quiebre: NO se ajusta, y se dice por qué

Se detecta y se enseña, pero **no se aplica ningún ajuste de probabilidad**. Medir si un
jugador recién quebrado saca peor en el juego siguiente exige datos **punto a punto**, y
esta base tiene agregados por partido: 29.486 partidos con el total de puntos al saque,
sin el orden en que ocurrieron. No hay forma de mirar el juego siguiente a un break
porque no se sabe cuándo hubo breaks.

Las opciones eran inventarse un multiplicador «porque todo el mundo sabe que el momentum
existe» o decir que no se ha medido. La casilla queda marcada como pendiente, con lo que
haría falta para llenarla.

### Contra la cuota en vivo: discrepancia, no ventaja

Se compara y se marcan las diferencias de 5 pp o más, con una advertencia que forma parte
del resultado: **en vivo el mercado ve cosas que este modelo no puede ver** —un jugador
cojeando, un fisio en pista, el viento— y va a discrepar más justo cuando tiene razón. Se
llama «discrepancia» y no «valor» por eso.

### Lo que rechaza

Un marcador imposible produce una probabilidad perfectamente creíble, así que se valida
siempre y se devuelve 400 con el motivo: 8-2 en juegos, dos sets a dos al mejor de tres,
un tiebreak fuera de 6-6. Y un id de jugador sin datos de saque se rechaza con 404 en vez
de caer en silencio a la media del circuito — que es exactamente lo que pasó al probar el
endpoint con ids inventados: dos jugadores distintos con `p = 0.6369` clavado.

### Un hueco en mis propias comprobaciones

Rompí el cálculo de la ventaja (`p + (1−p)·D` → `D`) y **no falló ninguna comprobación**.
El motivo: desde 0-0 la recursión nunca visita una ventaja, porque al llegar a 40-40 corta
con la forma cerrada del deuce. Y la identidad «5-4 = 4-3» tampoco lo cazaba, porque los
dos estados pasan por la misma rama rota. Hacía falta comprobar el **valor**, no solo la
coherencia.

---

## La capa entre el modelo y la pantalla (`npm run study:postprocess`)

Lo que sale del modelo no es lo que se publica. En medio hay tres pasos, cada uno
ajustado sobre predicciones históricas fuera de muestra, y **la tarjeta enseña las dos
probabilidades** — la cruda y la final — con lo que se le hizo entre una y otra.

```
cruda  →  [1] calibrar  →  [2] mezclar con el mercado  →  [3] encoger  →  publicada
```

**[1] Calibración.** Se ajustan Platt y una regresión isotónica, y gana el que le gane a
*no calibrar* fuera de muestra. Los tramos son tres, no dos: se AJUSTA con lo más
antiguo, se ELIGE con la última temporada de entrenamiento y solo entonces se mide en
validación. Elegir entre tres mirando validación y publicar el número de validación del
ganador es exactamente el sesgo que el registro de experimentos existe para evitar.

**[2] Mezcla.** En escala logarítmica, no aritmética: con 2 % y 20 % a partes iguales la
aritmética da 11 % y la logarítmica 6,7 %, que respeta que la distancia entre 2 % y 20 %
es la misma que entre 20 % y 75 %. El peso sale de una rejilla sobre el backtest, nunca a
ojo.

**[3] Encogimiento.** `w_efectivo = w / (1 + κ·d)`, con `d` = KL(modelo ‖ mercado). Cuando
el modelo se aleja mucho del precio, la explicación más frecuente no es que haya visto
algo, sino que le falta algo que el mercado sí tiene. Y son justo las tarjetas que más
«valor» enseñan.

### Lo que salió

| | fútbol | NFL |
|---|---|---|
| calibrador elegido | **Platt** (a = 1,10) | **ninguno** |
| log loss cruda → calibrada | 1,00785 → 1,00697 | 0,65216 (sin cambio) |
| peso del modelo en la mezcla | — | **0,10** |
| encogimiento κ | — | 4 |
| log loss final | 1,00697 | **0,62807** |

**El peso del modelo de la NFL es 0,10.** Dicho sin adornos: el backtest dice que la
mejor forma de usar ese modelo es casi ignorarlo y copiar el precio. Y ni así mejora al
mercado — la mezcla queda en 0,6294 frente a 0,6270 de la línea sola, una diferencia que
cabe dentro del azar (IC [−0,0006, +0,0029]). La mezcla se aplica igualmente porque
publicar el modelo crudo sería peor.

**En el fútbol la mezcla está APAGADA**, y no por olvido: ajustar un peso exige cuotas de
partidos ya jugados, y este archivo tiene cero. Poner el 0,10 de la NFL ahí sería
inventarlo. Se enciende sola: cada predicción queda en `fb_prediction_log` con el precio
del día, y en cuanto haya unos cientos resueltos, `npm run study:postprocess` la ajusta
con tus datos.

La mejora de Platt en el fútbol es de 0,0009 de log loss, con p = 0,0495 — pasa el listón
nominal y **no** el de Bonferroni con 17 comparaciones sobre el mismo conjunto. El script
lo escribe en su salida en vez de dejarlo en un decimal.

---

## El registro de experimentos y el holdout final

Un intervalo del 95 % significa «si esto fuera ruido, me equivocaría 1 de cada 20
veces». Vale para **una** comparación. Cuando llevas veinte sobre los mismos partidos
esperas una falsa por pura aritmética — y es justo la que se publica, porque es la que
salió bonita.

Este proyecto llevaba nueve valores del decay, cuatro pesos de Glicko, seis
ablaciones, tres baselines y dos métodos de de-vig sobre el mismo archivo de fútbol,
cada uno con su intervalo del 95 % citado como si fuera el único.

```bash
npm run experiments
```

Cada comparación se apunta en `experiments/registry.jsonl` —hipótesis, features,
hiperparámetros, resultado, veredicto— **gane o pierda**: un registro donde solo se
apuntan los aciertos cuenta mal el denominador, y el denominador es lo único que da
sentido a un p de 0,03. Es un fichero versionado y no una tabla de la base de datos
porque `data/` se borra al reingerir, y un contador que se puede perder no cuenta nada.

El CLI aplica las dos correcciones, que contestan preguntas distintas: **Bonferroni**
controla la probabilidad de cometer al menos un error en toda la familia —el listón
para decir «esto es real»— y **Benjamini–Hochberg** controla la proporción de falsos
entre los declarados buenos, que es el listón razonable para una lista de candidatos.

Lo primero que dijo al encenderlo fue incómodo: de once experimentos sobre el fútbol,
**dos cosas que están en producción no pasan Bonferroni**.

### Tres conjuntos, no dos

Hasta ahora había entrenamiento y «reservado». Y el reservado se miró en el barrido
del decay, en los pesos de Glicko, en las ablaciones y en los baselines. Después de la
primera mirada dejó de ser un holdout: si eliges entre veinte opciones por lo que hace
un conjunto, ese conjunto ya está dentro de la decisión aunque no hayas entrenado sobre
él.

| | fútbol | NFL |
|---|---|---|
| entrenamiento | hasta 2024 | hasta 2022 |
| validación (elige) | 2025 | 2023 |
| **holdout final (cerrado)** | **2026 →** | **2024 →** |

El candado es código, no un acuerdo: `assertNotFinalHoldout()` **lanza**, el holdout no
entra ni en los agregados, y abrirlo exige `unlockFinalHoldout("motivo")` — que escribe
la apertura en el registro. La constancia importa más que el candado: un candado se
salta editando el fichero, pero el registro convierte esa edición en algo que hay que
explicar.

### Por qué `npm run lint` solo mira una categoría

Porque antes no miraba **ninguna**: el script del raíz delegaba en los workspaces con
`--if-present` y ninguno de los dos tenía script de lint, así que `npm run lint` salía
en verde sin abrir un solo fichero. Eso es peor que no tener linter, porque el proyecto
lo anunciaba como si comprobase algo.

Ahora es oxlint de verdad, con `correctness` como error — la categoría de los fallos
que son bugs y no gustos. Las categorías de estilo (`suspicious`, `perf`) están fuera
a propósito: activándolas salen **172 avisos** de cosas como `Array#sort()` en vez de
`toSorted()` sobre arrays recién creados, o `await` dentro de bucles que están
secuenciados a posta para no reventar una API con límite de peticiones. Un lint que
imprime 172 líneas cada vez es un lint que nadie lee, y eso lo devuelve al punto de
partida: verde que no significa nada.

Una regla apagada, `unicorn/no-new-array`, y con motivo: existe porque `new Array(5)`
es ambiguo entre «cinco huecos» y «un elemento que vale 5», y los dos usos del proyecto
son `new Array<number>(n).fill(0)` en la distribución de margen y total de la NFL,
donde el parámetro de tipo y el `.fill` no dejan ninguna ambigüedad.

### Comprobar que la información es correcta

`npm run audit` no mide el acierto del modelo (para eso están los backtests): comprueba
**propiedades que se tienen que cumplir por construcción**, en los cinco deportes a la vez. Un fallo
ahí es un bug, nunca una cuestión de ajuste.

Verifica, por deporte, que las probabilidades suman 1; que la rejilla de marcadores más su cola suma
1; que los bloques de la rejilla coinciden **exactamente** con el 1X2 que muestra la cabecera de la
tarjeta; que la distribución de márgenes suma 1 y que su casilla del 0 vale P(empate) en fútbol y
cero en béisbol (un marcador final nunca queda empatado); que el marcador que anuncia la tarjeta es
de verdad el máximo de la rejilla; que el balance mostrado coincide con lo que hay en la base de
datos; que el pitagórico está bien calculado; que «cubrir el hándicap» nunca es más probable que
ganar cuando el hándicap va en contra; que el veredicto es el resultado de mayor probabilidad; que
el signo de la diferencia esperada concuerda con el favorito; y que no hay ids de partido repetidos
ni fechas inválidas.

En fútbol americano comprueba además dos cosas que solo tienen sentido ahí: que **un hándicap de 0 es
exactamente la probabilidad de ganar** (lo que ata los dos mercados y habría cazado el error de signo
que tuvo la línea), y que **los factores del «por qué» suman el margen del titular** — un panel de
explicación cuyos términos no reconstruyen el número de arriba es decoración, no una explicación.

```
$ npm run audit
▸ Fútbol      32 predicciones · 24 partidos próximos
▸ Béisbol     12 predicciones · 8 partidos próximos
▸ Baloncesto  12 predicciones · 8 partidos próximos
▸ NFL         12 predicciones · 32 partidos próximos
▸ Tenis       30 predicciones
✅ 1.249 comprobaciones, todas correctas.
```

La primera vez que se ejecutó encontró cuatro fallos reales: en béisbol, la diagonal de la rejilla
de carreras dejaba 5·10⁻⁶ de probabilidad en marcadores empatados, justo en el borde superior del
rango, contradiciendo lo que la propia tarjeta afirma con palabras. Se arregló el reparto de esa
masa en `runDistribution` en vez de relajar la comprobación.

Y al extenderla al fútbol americano encontró otros dos, esta vez de verdad graves: el **lado
visitante del hándicap** estaba mal calculado (se pedía la línea contraria al equipo local en vez de
aplicar la línea al margen del visitante, así que «cubre» y «falla» no eran espejo: 0.284 contra
0.469 en el mismo partido), y el panel del «por qué» **sumaba 7,3 puntos de razones bajo un
pronóstico de 5,2**, porque usaba los Elo sin la regresión de pretemporada y colaba entre ellos el
ataque y la defensa, que mueven el total y no el margen. Ninguno de los dos habría movido un solo
punto de acierto en un backtest.

### Medir cambios del modelo

El backtest acepta banderas para **desactivar o reajustar** cada pieza y ver qué aporta, sobre los
mismos partidos:

```bash
npm run backtest -- --tour atp --from 2015   # ventana de evaluación
npm run backtest -- --mov 0                  # sin margen de victoria
npm run backtest -- --rest 0                 # sin penalización por inactividad
npm run backtest -- --bo3 0.7 --bo5 0.9      # otra calibración por formato
npm run backtest -- --calibration 1          # curva Elo cruda, un solo factor
npm run backtest -- --load 20                 # experimento: bonus por carga reciente
npm run backtest -- --tour wta --market       # modelo contra las cuotas históricas
```

Así ninguna decisión del modelo depende de una intuición: se compara y se queda la que mide mejor.

Con datos que traen cuotas (tennis-data.co.uk), el backtest imprime además la comparación
**modelo vs mercado real** sobre los mismos partidos, incluyendo si las señales de *«posible value»*
ganaron más de lo que el mercado les daba. Es la prueba honesta de si esas señales valen algo.

## Fase 4: modelos y analítica, solo a través del registro

Regla de la fase: **ninguna probabilidad publicada cambió**. Todo lo nuevo o se registró como
experimento (y se quedó de sombra) o es analítica que se lee y se enseña. El holdout final
(fútbol 2026+, NFL 2024+) sigue cerrado y cada experimento lo dice en su motivo.

**Recalibración como experimento formal** (`experiments/recalibracion.ts`). El walk-forward ya
calculaba «recalibrado (solo pasado)» en cada periodo; ahora devuelve también las pérdidas por
partido del modelo y del recalibrado (no se guardan en el JSON) y `registrarRecalibracion` las
pasa por el bootstrap emparejado (2.000 remuestras) y escribe el experimento con `accepted:
false`: si mejora en validación, «rechazado» porque la promoción exige el holdout; si no,
«no concluyente». Lo llaman los cinco backtests en su corrida de referencia; con menos de 1.000
pares no se registra nada.

**Ensembles sombra en NBA, MLB y NFL** (`shadow/ensemble.ts`). Los tres backtests añaden al flujo
los MISMOS componentes que la ficha en vivo —NBA «Modelo completo (crudo)» y «Modelo sin
descanso» (nuevos también en vivo, en `trust/adapters.ts`), MLB «Elo de equipos (sin abridores)»
y «Modelo con abridores», NFL «Modelo (margen, crudo)» y «Modelo sin QB»— y entrenan, guardan y
registran su ensemble como el tenis y el fútbol. Corren de sombra; nunca apuestan.

**Diagramas de fiabilidad** (`evaluation/reliability.ts`): cubetas de 10 puntos sobre cada
probabilidad dicha (la misma definición que el ECE), con recuento, media predicha y frecuencia
observada. Del backtest, en `experiments/reliability.json` (lo escribe `informeComun`); en vivo,
de las predicciones puntuadas. `GET /api/evaluation/reliability?sport=`. Nunca se mezclan.

**Acierto por segmento**: el walk-forward gana cuatro segmentos genéricos para los cinco
deportes (favorito, banda de probabilidad, mes, día de la semana) con el umbral de 300 de
siempre; en vivo, `evaluation/segmentos.ts` da acierto, Brier y log loss por liga, favorito,
resultado, banda, mes y día, y CLV y ROI de las apuestas de papel por liga, favorito, lado,
banda, mes y día. Cada celda se publica solo con ≥ 100 predicciones (≥ 30 apuestas para el
CLV); por debajo se ve el recuento y nada más. `GET /api/evaluation/segmentos?sport=`.

**Monitorización** (`monitoring/series.ts`): log loss y Brier en ventana móvil de 28 días por
deporte, PSI de la distribución de probabilidades dichas (vivo contra el backtest) y la alerta
`deriva` cuando el PSI pasa de 0,25 o el log loss se aleja del backtest más de dos errores
típicos, nunca con menos de 100 predicciones en la ventana. Serie diaria en `monitoring_series`
(historia, se reconstruye entera); trabajo diario `monitorizacion`. `GET /api/monitoring?sport=`.

**Simulación de temporada** (`simulation/season.ts`): 10.000 temporadas con semilla fija
(`rng.ts`, mulberry32) jugadas partido a partido con la probabilidad que el núcleo del modelo da
hoy (Dixon-Coles en fútbol; Elo con ventaja de campo en NBA, MLB y NFL, sin descanso, abridor ni
QB porque no se conocen con semanas de antelación), sumadas a la clasificación real. Por
equipo: puntos y victorias esperados, probabilidad de acabar primero, de entrar arriba (top,
playoffs, ascenso) y de bajar, y la distribución de la posición final. El calendario pendiente
sale de las fuentes a `remaining_fixtures` (openfootball lista lo no jugado; nflverse, la
temporada entera y la conferencia/división de `teams.csv`; MLB Stats API, los `Preview`); si a
una liga de fútbol le falta, se reconstruye la doble vuelta y se dice «calendario
reconstruido». Reglas por liga en `config/simulation.json`. Cacheada por día en
`simulation_runs`; trabajo diario `simulacion-temporada`. Etiquetada en cada respuesta:
simulación, no predicción publicada. `GET /api/simulation/season/:sport/:league`.

**Cuadro de tenis** (`simulation/torneo.ts`): `simularCuadro` existe y está probado con un cuadro
sintético (bye incluido), pero ninguna fuente trae el cuadro del torneo, así que
`GET /api/simulation/torneo` devuelve `cuadroDisponible: false` con el motivo y el siguiente
partido conocido de cada jugador con su probabilidad publicada. Sin cuadro no hay probabilidad
de ganar el torneo, y no se inventa.

**Combinadas con correlación** (`picks/parlay.ts`): la probabilidad conjunta de «Mi selección»
descuenta la correlación medida en `staking/correlation.ts` con la corrección por pares
P(A∧B) = p_A·p_B·(1 + ρ·√(q_A q_B / p_A p_B)); dos selecciones del mismo partido son
incompatibles (conjunta 0, y se dice). `POST /api/picks/parlay`; Destacados enseña la
conjunta, la independiente y los vínculos. Aproximación, y así se etiqueta.

**Inteligencia de mercado** (`odds/intel.ts`): steam moves (consenso que se mueve ≥ 2 pp de
probabilidad implícita en ≤ 60 min con ≥ 3 casas), surebets (Σ 1/mejor < 1 entre casas) y la
referencia afilada (Pinnacle sin margen frente al consenso), sobre los snapshots guardados.
`GET /api/odds/intel`; panel «Mercado (aproximación)» en Destacados. Informa; no apuesta.

**Qué pasaría si**: la evaluación servida gana `queSi` (pendiente de la curva y cada factor con
su rango plausible); la ficha ofrece deslizadores que recalculan la probabilidad en el navegador
con el mismo desplazamiento logístico de la capa de confianza. Etiquetado «simulación, no
predicción publicada»; no se escribe en ningún sitio. De paso, la decisión BET/NO BET lee
`minEdge` de la política versionada en vez de la constante.

## Aciertos reales de la app

El `npm run backtest` mide el modelo sobre 20 años de historial. Útil para ajustarlo, pero no
responde la pregunta que de verdad importa: **¿ha acertado los partidos que yo miré?**

Para eso la app lleva su propio registro:

1. Cada vez que muestra una predicción de un partido **real** próximo, la **guarda** (probabilidad,
   favorito, cuotas del momento, fiabilidad declarada).
2. Ese registro **no se reescribe nunca**: la primera cifra servida es la que se puntúa, así que no
   puede «mejorar» sola cuando se mueven las cuotas.
3. Cuando el resultado real entra al historial (al correr `npm run update-data`), la predicción se
   empareja con él y se puntúa.

El dashboard lo muestra arriba, plegable: acierto, Brier, log loss, calibración (dicho vs ocurrido),
**el mismo cálculo para el mercado en esos mismos partidos**, y el desglose por fiabilidad
declarada. Con menos de 30 partidos resueltos avisa de que la muestra es pequeña.

> El registro **sobrevive** a `npm run update-data`: reingerir el historial no borra tu track record.
> Los partidos de demostración (`odds demo`) **no** se registran: nunca se juegan, así que puntuar
> contra ellos no significaría nada.

Sirve además como detector de averías: si los datos se rompen o quedan viejos, el acierto cae y lo
ves, en vez de fallar en silencio.
