# El nocturno «Datos» no ha pasado nunca

`.github/workflows/data.yml` reconstruye la historia desde las fuentes (`update-all -- --skip-odds`), la
comprueba (`verify:data`), la exporta y la publica en la release `data-latest`. **Ninguna de sus 35
ejecuciones ha pasado** de `verify:data`, así que nunca se ha publicado una release:
- `npm run fetch-data` no tiene nada que bajar;
- el paso «verify:data sobre la base publicada» de CI se salta («Sin release publicada»).

La última ejecución (13 de noviembre, sobre `main` `5c8b828`) falla 7 de 530 comprobaciones:

| # | Comprobación | Causa | Estado |
|---|---|---|---|
| 1 | noticias: un apellido ambiguo no se resuelve a ciegas («timber») | `matchPlayer` (`server/src/news/repo.ts`) | **Arreglado** |
| 2 | fútbol: todos los equipos de una temporada se cruzan (+982 parejas) | football-data.co.uk crea sus propios ids | **Arreglado** (datos reales) |
| 3 | fútbol: ningún club aparece con dos ids distintos (Mallorca, América, Necaxa) | la misma | **Arreglado**, Liga MX incluida (visto en GitHub) |
| 4 | ligamx: la excepción documentada sigue haciendo falta (2022–2024) | football-data rellena esas temporadas | **Excepción quitada** |
| 5 | ligue2: la excepción documentada sigue haciendo falta (2022–2024) | la misma | **Excepción quitada** |
| 6 | Baloncesto: sin partidos duplicados (199 claves) | la comprobación no llevaba la liga en la clave (NCAA masculina y femenina) | **Arreglado** |
| 7 | Baloncesto: marcadores dentro de lo posible (13 partidos) | forfaits 2–0 de la NCAA femenina guardados como partidos | **Arreglado** |

## Cómo se reprodujo

Se reconstruyó todo como el nocturno, en un `DATA_DIR` temporal (nunca `data/`), y se pasó
`verify:data`. Esta sesión en la nube no alcanza todas las fuentes:
- **Se alcanza:** GitHub (openfootball, tenis, NFL…).
- **Bloqueados por la política de red:** www.football-data.co.uk, site.api.espn.com y
  fantasy.premierleague.com.
- El `fetch` de Node no pasa por el proxy salvo con `NODE_USE_ENV_PROXY=1`.

Sin esas fuentes, la reconstrucción falla solo la 1 (528 comprobaciones); con el arreglo, pasa 528 de 528.

Para football-data se usaron sus CSV reales desde un espejo público en GitHub
(`TuncErdoganlar/futbol-veri-aynasi`, `data/fd/<temporada>/<división>.csv`). Se leyeron por la vía de
ficheros manuales de la ingesta (`raw/football/football-data/<liga>-<código>.csv`), solo para comprobar;
no entran en el repositorio ni como fuente.
- Las 96 CSV de las 12 divisiones principales (2019-20 a 2026-27) dan exactamente los mismos partidos por
  liga que el log del nocturno en CI (2760, 2779… 2518).
- El espejo no tiene los ficheros «extra» (MEX, USA, BRA, ARG): lo de Liga MX no se ha podido ver aquí.

Para lo que falta (Liga MX y ESPN) se creó el entorno personal **«s (fuentes de datos)»**, con
www.football-data.co.uk y site.api.espn.com permitidos. Esta sesión no puede pasarse a él: sirve para la
próxima que se abra en ese entorno.

## 1. «Timber» (arreglado)

FPL 2026-27 tiene a «J.Timber» (Arsenal) y a «Timber» (Crystal Palace). Dos defectos de `matchPlayer`:
- la coincidencia exacta con un nombre de una palabra ganaba aunque otro jugador llevara ese apellido;
- el punto se borraba sin dejar espacio («J.Timber» → «jtimber»), así que los 36 jugadores de la Premier
  con punto en el nombre nunca emparejaban por el apellido.

Pruebas en `server/src/news/repo.test.ts`.

## 2 a 5. football-data.co.uk crea un universo paralelo de equipos

`ingestFootballData` (`server/src/football/ingest/footballData.ts`) da a cada club el id
`slugify(nombre de football-data)` y no lo resuelve contra los que ya creó openfootball:
- «Man United» → `man-united`, frente a `manchester-united`;
- «Brighton» → `brighton`, frente a `brighton-hove-albion`.

El upsert `ON CONFLICT(league, match_date, home_id, away_id)`, pensado para añadir cuotas y córners al
partido de openfootball, solo funde los clubes cuyo slug coincide por casualidad. El resto entra dos veces,
con ids distintos, y por eso:
- hay equipos de la misma temporada que «nunca se cruzan»;
- hay clubes con dos ids («Mallorca» / «RCD Mallorca»);
- Liga MX y Ligue 2 tienen 2022–2024 (solo de football-data) con ids que no son los de openfootball.

**No se arregla con una tabla de alias de memoria.** Sería inventar el emparejamiento. El criterio del
proyecto está en `openfootball.ts`: al crear equipos, solo la coincidencia exacta normalizada; con
prefijos, Paris FC se fundía con el PSG.

**Medido con las CSV reales:** de 421 nombres de football-data, 206 casaban por casualidad (mismo slug) y
la coincidencia exacta normalizada solo añadía 4.

**Arreglo:** lo dicen los partidos. El mismo partido está en las dos fuentes (misma liga, mismo día,
mismo marcador), y cada partido de football-data con exactamente un gemelo en openfootball vota que «Man
United» es `manchester-united` (`emparejarNombres`, en `footballData.ts`).
- Por temporada, porque openfootball cambia de id entre temporadas (ver A, abajo).
- Con 3 votos o más y el 90 %. Si dos nombres eligen el mismo id en la misma temporada, ninguno se lo
  queda.
- Una temporada que openfootball no tiene toma el id de la más cercana. Si no, el nombre (mismo slug o
  mismo nombre normalizado). Si tampoco, se da de alta como antes y se dice en el log.
- El nombre formal de un equipo que ya existe no se pisa con el corto de football-data.
- Lo aprendido se guarda en `fb_team_aliases` (migración 28) y `buildTeamIndex` lo usa sin tapar nada
  (revisión data-guardian, F1). Sin eso, las casas de apuestas y ClubElo dejaban de encontrar a «Napoli» o
  «Lyon» en una base nueva. Con nombres al estilo de las casas resuelven 97 de 99, al id de openfootball.
- La excepción de Liga MX y Ligue 2 2022–2024 vale solo si football-data no ha llegado a esa liga.

**Resultado con datos reales (las 12 divisiones):**

| | Partidos | Con cuotas | Equipos | `verify:data` |
|---|---|---|---|---|
| Solo openfootball | 29.558 | 0 | 437 | — |
| + football-data, antes | 55.022 | 32.312 | 652 | 3 fallos de fútbol, como en CI |
| + football-data, ahora | 32.593 | 32.312 | 449 (+421 alias) | 527 de 527 |

Los 3.035 partidos de más son temporadas que openfootball no tiene o tiene a medias (Ligue 2 2022–2024,
segundas divisiones de 2025-26, la temporada en curso).

### Revisión data-guardian (14 de noviembre)

- **F1, bloqueante: arreglado** (los alias, arriba).
- **F2, pendiente: pasadas incrementales sobre una base con duplicados.** Los gemelos se buscan también entre
  las filas que escribió football-data. Un nombre puede votar por su propio duplicado de antes, y el log
  lo cuenta como «emparejado con openfootball».
  - En una copia de la base vieja, la pasada nueva lo deja todo igual: ni lo arregla ni lo empeora.
  - Con datos reales de la Premier 2026-27, si football-data va por delante de openfootball, crea
    `coventry`, y cuando openfootball publica `coventry-city` el duplicado crece en cada pasada.
  - Pasa en las máquinas que actualizan en incremental (el planificador); el nocturno siempre parte de cero.
  - No hace falta una base vieja: basta con que football-data vaya por delante de openfootball. La
    reconstrucción de hoy da de alta Verona (Serie B), Cottbus (2. Bundesliga), Celta B (LaLiga 2), Angers,
    Bordeaux, Dijon y otros (Ligue 2), cuyos slugs de openfootball son otros. Quien baje esa release y
    actualice en incremental los verá partidos en dos cuando openfootball publique esas temporadas.
  - Arreglos propuestos:
    - una columna con la procedencia de cada partido (migración), para votar solo con filas de openfootball;
    - volver a poner la clave a las filas de football-data cuando cambie la decisión;
    - mirar la otra división del país antes de dar de alta;
    - una comprobación nueva en `verify:data`: «nadie juega dos veces el mismo día en una liga».
- **F3: rehacer una base con duplicados tiene consecuencias en el libro mayor.**
  - Las predicciones de fútbol pendientes guardadas con un id duplicado («napoli») ya no se liquidan.
  - Un partido que se vuelva a predecir con el id nuevo deja una segunda fila.
  - `--rebuild` borra la liga antes de descargar.

  Consejo: hacerlo con el servidor parado, sin predicciones de fútbol pendientes y con las fuentes
  alcanzables. Arreglo propuesto: resolver las predicciones viejas a través de los alias.
- **F4: resuelto** con la excepción condicional. Sin football-data, `verify:data` vuelve a pasar en local.
- **F5: visto en GitHub el 16 de noviembre, sin clubes con dos ids.** Liga MX sin ver aquí. Si `MEX.csv` fecha distinto los partidos de noche (fecha británica
  frente a local), habrá menos votos y América o Necaxa pueden seguir con dos ids. No sería en silencio: lo
  caza la comprobación de clubes con dos ids. Hay que mirarlo en el entorno «s (fuentes de datos)».
- **F6 y F7: aplicados.** Partidos de un club contra sí mismo, contados. La guarda de «dos nombres, un id»
  también tras las vías de respaldo.
  - Hueco menor de F7: al volver a dar de alta se usa `slugify(nombre)`. Si ese slug ya es el id de otro
    club, la colisión sigue. Con los datos reales hay 0, y el código de antes también los juntaba.
- **Segunda vuelta de la revisión: nada bloquea.**
  - Las pruebas de `footballData.test.ts`, `src/db/` y `src/football/` pasan.
  - Una reconstrucción repetida no cambia nada, ni siquiera los alias.
  - Con 742 nombres (todos los equipos y alias, más 85 al estilo de las casas):
    - con los alias no se pierde ninguno;
    - cambia de club uno, y es una corrección: «Paris SG» caía en Paris FC y ahora en el PSG;
    - 102 resuelven donde antes no, todos al club correcto.
  - La tabla va en la historia: se exporta y pasa `check-publishable`.

### Hallazgos que salieron al medir (pendientes, cada uno con su prueba)

- **A. (arreglado el 18 de noviembre: 24 clubes en 7 ligas; ver el CHANGELOG) openfootball parte clubes
  entre temporadas.** Revisión data-guardian del arreglo: nada bloqueaba.
  - Aplicados: no unir un filial con su primer equipo, y no registrar dos veces un partido porque cambie un
    id.
  - Pendiente, de poco riesgo:
    - la detección lee antes de abrir la transacción (hoy no hay otro escritor de `fb_matches`);
    - entre la unión y el recálculo del Elo, al final de `update-data:fb`, un lector ve el rating viejo del
      id nuevo, nunca uno a medias;
    - `footballcsv.ts` crea ids con `slugify` sin pasar por los alias, pero solo actúa si no hubo ninguna
      otra fuente.
  - Lo que lee el libro mayor por id de equipo («nombre del equipo de una predicción vieja») no encuentra el
    id viejo. Solo afecta a lo que se ve, nunca al resultado. Cambia la grafía y, con ella, el id:
  - «Bayer Leverkusen» (2019-20) → «Bayer 04 Leverkusen»;
  - «Real Sociedad» → «Real Sociedad de Fútbol», «Real Betis» → «Real Betis Balompié»;
  - «Stade Rennais» → «Stade Rennais FC 1901» (2023-24), «SL Benfica» → «Sport Lisboa e Benfica»;
  - «NEC Nijmegen» → «NEC».

  Para el modelo son dos equipos y el Elo se reinicia. Ninguna comprobación lo ve: dentro de una
  temporada solo hay un id, y los nombres normalizados no coinciden. football-data, que escribe igual
  todas las temporadas, es el puente para unirlos.
- **B. (arreglado el 16 de noviembre) openfootball fecha un año antes los partidos de julio de 2020.** Son los de la vuelta tras el
  COVID de la temporada 2019-20: 66 de la Premier y 77 de la Championship, fechados en julio de 2019,
  antes de que empezara la temporada.
  - Causa: `openfootballTxt.ts:172` usa julio como corte fijo entre temporadas.
  - Además, el partido de football-data, bien fechado, no casa con el suyo: 143 parejas repetidas.
  - Los partidos de julio de 2019 de Liga MX, Ligue 2, 2. Bundesliga y Argentina son legítimos: esas
    ligas empezaron en julio.
- **C. (arreglado el 16 de noviembre) Fechas que no coinciden entre fuentes.** Unos 51 partidos tienen 1–3 días de diferencia, o uno
  aplazado: entran dos veces. `verify:data` no lo ve, porque la pareja y la temporada son las mismas
  pero la fecha no.

## Lo que se vio en GitHub (16 de noviembre)

Ejecución de «Datos» en la rama (`workflow_dispatch`, sin publicar), con las fuentes reales y los fallos con
ejemplos. Fallaban solo 2 de 528, los de baloncesto: los fallos 2 a 5 desaparecieron, Liga MX incluida
(F5).

- **6:** todos los ejemplos eran la NCAA masculina y la femenina el mismo día, con marcadores distintos
  (Villanova–Notre Dame: ncaab 72-74, ncaaw 75-99). Era un falso positivo de la comprobación.
- **7:** los 13 eran 2–0 en la NCAA femenina (USC 2–0 Northwestern, UCLA 2–0 Northwestern…): forfaits.
- **B y C:** arreglados en la ingesta. Reconstruido el fútbol desde cero, las parejas repetidas bajan de
  271 a 77, las eliminatorias de ascenso de openfootball.

### Revisión data-guardian de estos arreglos (16 de noviembre)

- **B1, bloqueante: arreglado.** En una base que ya existe, el partido movido de año dejaba su fila en la
  fecha vieja: una pasada incremental lo guardaba dos veces. Ahora se mueve o se borra en la misma
  transacción.
- **Jornadas tempranas:** solo se mueve una jornada por encima de la mediana del fichero. La propuesta de
  la revisión, «no más tarde que el último partido del fichero», habría impedido justo la corrección buena:
  el último partido bien fechado de 2019-20 es del 30 de junio de 2020.
- **NCAA en la comprobación de «dos ligas»:** la masculina y la femenina no cuentan entre sí, porque
  comparten ids.
- **Sin cambiar:**
  - `parseOpenFootballPendientes` (partidos por jugar) no lleva la corrección de año, que solo afecta al
    pasado;
  - en una base de antes, los ~51 partidos en dos fechas siguen así hasta `--rebuild`.

## 6 y 7. Baloncesto (antes de verlo)

Vienen de ESPN (`server/src/basketball/ingest/espn.ts`), que esta sesión no alcanza, y no se han visto
con datos.

- **6.** La comprobación cuenta como duplicado un mismo `(fecha, local, visitante)` en todo baloncesto,
  sin la liga. `bb_games` ya tiene `UNIQUE (league, game_date, home_id, away_id)`, y ESPN da el mismo id a
  los equipos masculino y femenino de una universidad (`slugify` de «Duke Blue Devils»).
  - **Hipótesis:** los 199 son días con partido masculino y femenino entre las mismas dos universidades,
    en ncaab y ncaaw. Sería un falso positivo de la comprobación.
  - **Hace falta ver** que cada clave repetida lo está en ligas distintas y con marcadores distintos.
    Mismo marcador en las dos ligas sería un partido metido dos veces. No se cambia la comprobación sin
    verlo.
- **7.** Solo entran partidos terminados y sin empate, así que no son 0–0 cancelados. Faltan las 13 filas
  para saber si son forfaits, amistosos contra equipos de otra división o datos rotos.
