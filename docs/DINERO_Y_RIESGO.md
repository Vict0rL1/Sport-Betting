# Dinero y riesgo

El banco de papel auditable, las señales, el CLV, los topes de cartera, la política versionada (`npm run policy`) y tu propio registro de apuestas.

## El banco de papel, auditable

El modelo apuesta solo con 1.000 $ de papel, y cada apuesta queda registrada de forma que
**no se puede reescribir**. No es una promesa del código: son triggers de SQLite
(`server/src/paper/schema.ts`) que hacen fallar cualquier escritura prohibida.

Una apuesta tiene tres momentos, y cada uno escribe lo suyo **una sola vez**:

| Momento | Qué se guarda |
| --- | --- |
| **Al apostar** (congelado) | probabilidad del modelo cruda y calibrada, del mercado con y sin margen, ventaja, cuota, casas, importe, % del banco, Kelly completo y fracción usada, banco antes, `model_version`, `model_config_version`, `calibration_version`, `data_version`, `strategy_version`, `git_commit`, hora de la predicción, hora de las cuotas, **cuota de apertura** y **cuota de la señal** (la del mercado cuando el modelo registró la predicción) |
| **Al cerrar el mercado** | **cuota de cierre** (de los snapshots: el último estado antes del inicio, con la hora en que se vio) y **CLV** = cuota apostada / cierre − 1 |
| **Al liquidar** | resultado del partido, estado, beneficio, banco después, ROI |

Lo que la base de datos **rechaza**: cambiar probabilidades, cuota, importe o versiones de una
apuesta registrada; borrarla; liquidarla dos veces; cambiar el cierre una vez fijado;
registrarla después del inicio; darla de alta con cierre o beneficio (datos del futuro); un
estado que no sea `pending`, `won`, `lost`, `push`, `void` o `cancelled`. Los registros de
predicciones de los cinco deportes tampoco se pueden borrar ni reescribir: si mañana cambia el
modelo, lo de ayer sigue diciendo lo que dijo.

La cuota de la apuesta **nunca** se sustituye por la de cierre: van en columnas distintas.
Por eso una apuesta perdida a 2,10 que cerró a 1,94 sigue constando como buena línea
(CLV +8,2 %). El CLV medio es la medida de habilidad que no depende de la suerte del
resultado, y la pantalla lo enseña.

Cambios de comportamiento:
- Se decide con la probabilidad **calibrada** (la que se enseña y miden las bandas), no con la
  cruda; las dos quedan guardadas.
- `push`: empate en el moneyline de la NFL (antes `void`). `cancelled`: sin resultado 14 días
  después del inicio; se devuelve el importe.
- El banco de papel es solo hacia delante y vive en su propia tabla: ningún backtest escribe
  en ella.

## Del edge a la validación: señales, cierre real y «¿es real?»

La cadena completa es **predicción → mercado → edge → paper trading → evaluación en vivo →
validación estadística**, y cada eslabón deja rastro inmutable:

- **Señales de edge** (`edge_signals`): cada partido con precio real que la política evalúa,
  apostado o no, con la selección, las probabilidades, la cuota, la ventaja, la decisión y su
  motivo, las versiones, y después el cierre y el CLV. Las apuestas solas son una muestra
  sesgada (solo lo que pasó los topes); las señales dicen si el edge detectado es real, con
  muchas más muestras. Append-only; una evaluación idéntica a la anterior no se repite.
- **Cierre de verdad** (`odds/closingCapture.ts`): cada 10 minutos, las ligas con una apuesta
  pendiente o una señal abierta que empieza en los próximos 30 minutos y no se ha visto en los
  últimos 15 se piden (1 crédito por liga, respetando el presupuesto). Con el refresco de
  12 h el «cierre» podía ser de la mañana; ahora es de minutos antes.
- **¿Es real?** (`evaluation/validation.ts`, en el panel «El modelo en vivo»): cuatro pruebas
  por bootstrap —¿el modelo le gana al mercado en log loss, partido a partido?, ¿el edge
  detectado le gana al cierre (CLV)?, ¿el banco gana?, ¿rinde lo que el modelo prometía?— con
  intervalo del 95 % y un veredicto: *a favor*, *en contra*, *no concluyente* (y cuántos datos
  harían falta) o *muestra insuficiente* (menos de 30). `verify:data` comprueba que ningún
  veredicto contradiga su intervalo.
- **El dinero, por tramos** (`evaluation/betting.ts`, mismo panel): el ROI realizado al lado
  del **prometido** (la ventaja p·cuota − 1 con que se hizo cada apuesta, ponderada por
  importe), aciertos contra los esperados (Σ p), la peor caída desde un máximo y la racha más
  larga perdiendo; y todo eso partido por deporte, por tramo de cuota y por tramo de ventaja.
  Las apuestas son los partidos donde el modelo más discrepa del mercado, que es donde un
  modelo demasiado seguro se nota primero: si el realizado va sistemáticamente por debajo del
  prometido, la prueba «¿rinde lo prometido?» sale *en contra*.
- **¿Una ventaja grande es más ventaja?** Con todas las señales (apostadas o no), el CLV por
  tramo de ventaja. Si las ventajas de más del 10 % le ganan al cierre menos que las del 3 %,
  lo grande no es edge: es un partido que el modelo conoce mal. Solo se afirma cuando los
  intervalos de los dos tramos no se tocan; si se tocan, se dice que no se distinguen. Es un
  diagnóstico, no una regla: la política de apuestas no se toca por él sin medirlo antes.

## Apuestas simultáneas: correlación, Kelly de cartera y topes (`npm run study:correlation`)

El sizing dimensionaba cada apuesta **como si fuera la única**. Un sábado no lo es: hay
ocho posiciones abiertas a la vez y, si fallan juntas, el banco no cae ocho veces un
poco — cae una vez mucho.

### Primero se midió, y salió lo contrario de lo esperado

La hipótesis era la intuitiva: las apuestas de una misma liga y jornada se arrastran
entre sí (mismo árbitro, mismo clima, mismo sesgo del modelo). Para comprobarlo se sacan
las predicciones **fuera de muestra** del Dixon-Coles y se mira el residuo tipificado

```
z = (y − p) / √(p·q)
```

Con el modelo calibrado, E[z] = 0 y Var[z] = 1, así que la correlación entre dos
apuestas es directamente E[z_i·z_j]: cero es independencia, positivo es fallar juntas.
Medido: media de z = 0.016, varianza = 1.007. Sobre **65.505 predicciones**, 2.063
jornadas, 13 ligas.

| pareja | ρ | IC 95 % | pares |
| --- | --- | --- | --- |
| **mismo partido** · over 2.5 ~ ambos marcan | **+0.558** | [+0.546, +0.572] | 21.835 |
| **mismo partido** · gana el local ~ over 2.5 | **+0.164** | [+0.151, +0.178] | 21.835 |
| **mismo partido** · gana el local ~ ambos marcan | **−0.141** | [−0.154, −0.128] | 21.835 |
| misma liga · misma jornada · mismo mercado | +0.0013 | [−0.0020, +0.0047] | 357.606 |
| … y además el mismo lado (**mismo sesgo**) | +0.0007 | [−0.0038, +0.0053] | 225.362 |
| **control**: ligas y días distintos | −0.0002 | — | 918.752 |

La correlación que se fue a buscar **no existe**: entre partidos distintos de la misma
liga y jornada no se distingue de cero, ni siquiera restringiendo a apuestas del mismo
lado. La que sí existe es entre **mercados del mismo partido**, y es dos órdenes de
magnitud mayor.

### El control es la mitad del experimento

Pares de ligas y días distintos. No hay mecanismo por el que el error del Betis en marzo
deba parecerse al del Everton en noviembre, así que ese número **tiene** que salir ~0 — y
sale −0.0002. Es lo que convierte el cero de arriba en una **medición** y no en falta de
potencia: el mismo estimador detecta un 0.558 cuando lo hay.

Sin el control, este script sería una máquina de fabricar números convincentes.

### Y un error propio, en la primera versión

El grupo «mercados distintos» salía significativo con ρ = 0.019 e **incluía pares del
mismo partido**. Estaba midiendo el 1X2 contra el over del mismo marcador —correlacionado
por construcción— y presentándolo como una propiedad de la jornada. Separados los dos
casos, uno se desploma a cero y el otro sube a 0.19.

### El error estándar no puede ser el ingenuo

Un partido entra en muchos pares, así que N pares no son N observaciones. El intervalo
sale de un **bootstrap por bloques** que remuestrea jornadas enteras. Con un bootstrap
sobre pares, los intervalos saldrían varias veces más estrechos y el ruido pasaría por
hallazgo.

### El signo no es un detalle

Las cifras están en dirección canónica (gana el local / hay over / marcan los dos).
Respaldar el lado contrario en una de las dos **invierte el signo**.

«Local + ambos marcan» sale **negativa**: es una cobertura parcial, no una concentración.
Un modelo de correlación que tomara valores absolutos —que es lo que sale de suponer en
vez de medir— recortaría justo ahí un tamaño que no hacía falta recortar.

### Kelly de cartera

Kelly maximiza el crecimiento del **banco**, y el banco es uno solo. Con varias
posiciones lo que crece es `1 + Σ f_i·r_i`, y el logaritmo de esa suma no se separa en
suma de logaritmos.

Con la aproximación cuadrática, `f* = Σ⁻¹μ` — el problema de Markowitz. Pero esa
aproximación **no coincide** con el Kelly exacto ni con una sola apuesta (a cuota 6.00
pide un 13 % menos), así que no sustituye al sizing que ya había. Devuelve un **factor**:

```
factor_i = f_cartera,i / f_independiente,i
```

con las dos bajo la **misma** aproximación, de modo que el error de aproximación se
cancela en el cociente y lo que queda es solo el efecto de la correlación. Ese factor
multiplica el tamaño de siempre.

**El factor nunca sube de 1.** Con correlación negativa el óptimo pediría apostar más; se
recorta igualmente. Una estimación de correlación negativa es la menos fiable de todas y
el premio por creérsela es pequeño, mientras que el castigo es apalancarse justo donde
uno creía estar cubierto. Un módulo de riesgo que puede *aumentar* una apuesta es una vía
nueva de perder dinero.

Con cuatro apuestas —dos de ellas mercados del mismo partido— el efecto es visible:

```
apuesta                  en solitario   de cartera   factor
A vs B — local                  15.17        12.74   ×0.84
A vs B — over 2.5               17.23        14.97   ×0.87
C vs D — local                  15.17        15.04   ×0.99
E vs F — local                  15.17        15.16   ×1.00
```

### Exposición agregada real contra la suma ingenua

Son **dos preguntas distintas** y hacen falta las dos:

* **Suma ingenua** `Σf_i` — «¿cuánto puedo perder?». No depende de la correlación: si
  fallan todas se pierde la suma. Gobierna los topes duros.
* **Riesgo efectivo** `√(fᵀ·C·f)` — «¿cuánto riesgo corro?». Es el tamaño de *una*
  apuesta con la misma varianza. Gobierna el tamaño, porque es lo que entra en el
  crecimiento logarítmico.

25 apuestas al 2 %: la ingenua es el 50 %, la efectiva el 10 % (√25 veces una, no 25).
Con correlación perfecta las dos coinciden. Usar solo la ingenua rechaza carteras
diversificadas sanas; usar solo la efectiva deja pasar una concentración que vacía el
banco en una tarde.

### Topes por día y por liga

Dos puertas nuevas, la 7 y la 8:

| tope | valor | protege de |
| --- | --- | --- |
| por evento | 2 % | una `p` disparatada en un partido |
| total simultáneo | 10 % | demasiado vivo a la vez |
| **por día** | **6 %** | que una tarde entera se liquide junta |
| **por liga** | **5 %** | que el banco dependa de que el modelo de *una* liga esté bien |

El tope por liga **no** protege de una dependencia medida — ya se ha dicho que es cero.
Protege del **riesgo de modelo**: si el Dixon-Coles de una liga está roto (datos mal
cargados, un ascenso mal sembrado), el fallo es de esa liga entera y se lleva todas sus
posiciones por delante. La correlación de resultados es cero; la de «que mi modelo esté
equivocado» no lo es, y esa no se puede estimar con los mismos datos que produjeron el
modelo.

Cuando un tope no da para todo, se recorta **proporcionalmente**, no por orden de
llegada: servir por orden dejaría la última candidata a cero por el azar del orden de la
consulta, y ese azar no es un criterio de riesgo.

### La correlación tiene su propia familia de Bonferroni

Bonferroni corrige por haber hecho muchas preguntas **parecidas** sobre los mismos datos.
«¿Mejora el log loss?» preguntado dieciocho veces es una familia; «¿cuánto correlacionan
dos apuestas?» no es la misma pregunta ni sobre la misma cantidad. Meterlas en la misma
bolsa encarecía el listón de las comparaciones de predicción por medir algo que no compite
con ellas, y hacía que **añadir una medición debilitara retroactivamente** conclusiones
anteriores que no habían cambiado.

No es una escapatoria: dentro de su familia se corrige igual, con divisor 2 y a la vista.
Y la columna de dirección tuvo que aprender que en `corr` un delta positivo no es
`EMPEORA` sino `MÁS dep.` — es el hallazgo, no un fracaso.

### Un fallo que solo cazó la comprobación

La tabla de correlaciones se indexaba con claves escritas a mano, y `over_under~btts` no
encontraba nada: la búsqueda ordena alfabéticamente y genera `btts~over_under`. El par
con la correlación **más alta de las tres** caía en el valor por defecto. No rompía nada
visible porque el defecto es prudente — que es exactamente lo que hace que un fallo así
sobreviva. Ahora las claves se construyen con la misma función que las busca.


---

## Modelo y decisión son dos cosas

El modelo dice una probabilidad. Otra cosa distinta decide un dinero. Viven en
carpetas separadas y `server/src/staking/` no importa ni un Elo: entran `p`, cuota,
deporte y banco.

La consecuencia práctica es la que importa: se puede **apretar el riesgo sin tocar el
modelo**. Cuando las dos cosas viven en la misma función, subir un límite y mejorar una
predicción se parecen demasiado.

```bash
npm run staking -- --bankroll 1000
```

### Las ocho puertas

Una apuesta pasa por todas, en este orden:

1. **¿Hay ventaja al precio ofrecido?** Con el margen dentro, no contra la cuota limpia.
2. **¿Está el modelo calibrado?** Multiplica el tamaño y puede anularlo.
3. **Kelly fraccional** — 1/4 o 1/5. `KellyFraction` es un tipo que **no admite 1**, así
   que probar Kelly completo exige editar el fichero.
4. **Tope duro por evento** — 2 % del banco.
5. **Límites de pérdida diario y semanal** — que **cortan**, no recortan. Un límite que
   reduce el tamaño se puede cruzar apostando más veces, y entonces no es un límite.
6. **Exposición total simultánea** — 10 % del banco en riesgo a la vez, contando lo
   pendiente. Las cinco primeras dimensionan cada apuesta como si fuera la única, y en
   un sábado no lo es: sin esta puerta, 25 candidatas al 2 % sumaban el 50 % del banco.
7. **Kelly de cartera** — un factor ≤ 1 por la correlación **medida** con el resto de
   las posiciones abiertas. Ver la sección de apuestas simultáneas más arriba.
8. **Topes por día y por liga** — 6 % y 5 %. Manda el más ajustado de los tres topes, no
   el producto: son condiciones que hay que cumplir a la vez, no descuentos que se
   acumulan.

Las puertas 1–6 se evalúan por apuesta; las 7 y 8 **solo se pueden evaluar mirándolas
todas juntas**, y por eso existe `decideBook` además de `decideStake`. Llamar n veces a
la función de una deja las tres cosas nuevas sin gobierno, y el fallo no se ve: cada
apuesta sale con su tamaño «prudente» y la cartera entera no lo es.

Y antes de las ocho, una regla de entrada: **una sola selección por partido**. Los tres
lados de un 1X2 son mutuamente excluyentes, así que se elige la de mayor **crecimiento
esperado** —no la de mayor ventaja, que no es lo mismo: `f* = ventaja / (cuota − 1)`, y
una selección a cuota larga puede tener más ventaja y un Kelly ridículo.

### El tamaño baja solo cuando el modelo es peor

`npm run study:calibration` mide el ECE de cada deporte y lo escribe en
`experiments/calibration.json`. El módulo **falla cerrado**: sin medición, el tamaño es
cero.

| deporte | ECE | ¿mejor que el mercado? | multiplicador |
|---|---|---|---|
| fútbol | 0,72 pp | no medible (cero cuotas históricas) | **×0,50** |
| NFL | 1,82 pp | **no**, +0.01609 de log loss | **×0,00** |

La NFL sale a cero y no porque alguien lo decidiera: está medido que su modelo es peor
que la línea de cierre, y apostar contra un precio mejor que tu propia estimación es
perder por definición. El fútbol se queda a la mitad porque sin cuotas históricas no se
puede descartar que le pase lo mismo.

### El drawdown, no solo el retorno

«+2 % esperado» no dice nada del camino. La tabla simula 5.000 caminos y enseña la caída
mediana y la del percentil 95 — y lo hace **cuatro veces**, desplazando las
probabilidades hacia la moneda:

```
  escenario                  retorno   caída mediana   caída p95   pierde
  el modelo tiene razón       +2.03 %          7.80 %     15.13 %      50 %
  el modelo se equivoca 1/4   +1.51 %          7.84 %     16.69 %      52 %
  el modelo se equivoca 1/2   +0.98 %          7.84 %     16.73 %      54 %
  el modelo no sabe nada      -0.04 %          7.91 %     16.79 %      59 %
```

La fila que importa no es la primera: esa supone que `p` es exacta, que es la hipótesis
que Kelly necesita y que nunca se cumple. Y fíjate en que **la caída apenas cambia entre
filas** — el retorno depende de acertar la probabilidad, la caída depende del tamaño que
pusiste.

## Qué incluye — 🎟️ Apuestas (tu registro)

Las cinco pestañas anteriores dicen lo que piensa el **modelo**. Esta dice lo que hiciste **tú**, y
están deliberadamente separadas: la precisión de un modelo no puede depender de a qué partidos te
apeteció apostar, y tu beneficio no puede maquillarse contando solo los partidos que al modelo le
gustaban.

- **Registrar en dos clics, o a mano.** Eliges un partido de los próximos —los 99 que tenga cargados,
  de los cinco deportes—, pulsas el lado al que apostaste, y escribes cuota y cantidad. La cuota se
  pre-rellena con la del mercado si la hay, pero **siempre es editable**: la de tu boleto es la única
  que cuenta. También puedes registrar cualquier cosa a mano.
- **El beneficio no se guarda, se calcula.** Sale de (estado, cantidad, cuota, retorno) cada vez que
  se lee, así que corregir un estado —lo que más se hace— nunca deja un número viejo detrás.
  Ganada, perdida, **anulada**, **media ganada / media perdida** (hándicap asiático) y **cashout**.
- **El ROI se calcula sobre lo que estuvo en riesgo**, no sobre todo lo apostado. Una anulada se
  devuelve: ni ganó ni perdió, así que no infla el denominador. Con una ganada y cinco anuladas el
  ROI sigue siendo +100 %, no +17 % — lo comprueba un test.
- **Las pendientes valen `null`, no 0.** Un cero diría «empataste», y promediar lo que aún no se sabe
  como ceros es exactamente cómo un tracker informa de un 0 % en una semana sin terminar.
- **Calendario del mes** con el resultado de cada día, en verde/naranja según el signo y con la
  intensidad proporcional al mayor día del mes. Pulsa un día para ver solo sus apuestas.
- **¿Te sirvió seguir al modelo?** Cuando eliges la apuesta desde un partido de la app, se guarda lo
  que pensaban el modelo y el mercado **en ese momento** — algo que no se puede recuperar después,
  porque las cuotas se mueven y los ratings se recalculan. Con eso la pestaña separa tus apuestas en
  «fui con el modelo» y «fui contra el modelo» y compara el ROI de cada grupo. Se oculta por debajo de
  diez apuestas comparables: con cuatro, eso es ruido con titular.
- **Sin símbolo de moneda.** Los mismos números sirvan euros, pesos o unidades; inventar una moneda
  que no elegiste sería incorrecto en la mayoría de instalaciones.

Todo vive en su propia tabla y su propio espacio de la API (`/api/bets`). Ningún modelo lee tus
apuestas y las apuestas no puntúan a ningún modelo.

## ¿Cuándo fiarse del modelo? (abstención, incertidumbre y auditoría)

Cada predicción lleva un panel **«¿Cuánto fiarse?»** y la app tiene una pestaña
**📊 Confianza**. La idea: no solo «qué cree el modelo», sino si ese número merece confianza y
por qué. El detalle, los criterios y el estado de cada fase están en
[`docs/CONFIANZA.md`](docs/CONFIANZA.md).

- **Decisión BET / NO BET con razones**: la ventaja tiene que sobrevivir a la incertidumbre y
  a las simulaciones de sensibilidad, con datos suficientes, sin señales de fuera de
  distribución, estable, con un mercado de calidad y un precio reciente. El banco de papel
  aplica la misma decisión y se abstiene si no hay evaluación (falla cerrado).
- **Calidad de datos /100** explicable punto por punto (lo que la app no sabe sale como
  DESCONOCIDO), **incertidumbre** (no es un IC del 95 %), **estabilidad**, **desacuerdo entre
  componentes**, **qué mueve la predicción** y el **contrafactual** («deja de apostarse si…»).
- **Predicción final pre-partido congelada** y las de T-24h, T-6h y T-1h, con los cambios y su
  causa cuando consta.
- **Walk-forward por periodos** contra baselines sencillos y el mercado, sin holdout:
  `npm run benchmark:report`. **Modelos en sombra** y **ensembles** con validación temporal:
  `npm run shadow:report`. **Salud de los modelos**: `npm run model:report`. **Historia de
  versiones** desde git: `npm run model:history`. **Reproducir** lo guardado de una
  apuesta, señal, evaluación o predicción: `npm run reproduce -- apuesta:12`.
- **Alertas internas**, **línea temporal** de cada partido y **riesgo de cartera** con grupos
  de correlación (mismo evento, equipo o jugador).
