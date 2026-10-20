# Auditoría del 17 de octubre de 2026: verificación y arreglos

**Entrada.** La auditoría (`audit.md`, `audit_evidence.json`, `audit_checks.py`) y la copia de
carpeta del 12 de octubre (`copia-datos-s-nhl-12oct/`) están en el Mac del dueño. Ninguno de los
dos ficheros llegó a esta sesión. Por eso cada punto dice:

- qué se reprodujo aquí, con el código y con la copia local de `data/` (de hasta el 8 de octubre);
- qué queda por confirmar en la copia del 12 de octubre;
- qué se cambió.

Para esa confirmación está `npm run auditoria:copia`, que hace todo esto sobre la copia sin tocarla.

Reglas que se han seguido:

- El original no se toca: se calcula su SHA-256 antes y después.
- Se trabaja sobre copias con sus `-wal`.
- No se inventa ningún resultado, hora, id ni estadística.
- No se reescribe ni se borra nada del libro mayor.
- Nada de producción ni de despliegue.

## 1. Copias consistentes

**Defecto confirmado (reproducido en un test).** Una carpeta copiada con la app en marcha lleva
cada base partida en dos: el fichero principal y su `-wal`. Quien restaure solo el principal
pierde, sin ningún error, los commits que aún no se habían volcado. La base abre y pasa
`integrity_check`. En la copia del 12 de octubre, según la auditoría, eran 133 filas del libro
mayor. Esa cifra está por confirmar aquí: la copia local no tiene `-wal` y da 0.

`hacerCopia` ya usaba `VACUUM INTO`, que es consistente. Lo que faltaba:

1. **Consolidar una copia de carpeta:** `npm run copia:consolidar`, en `db/consolidar.ts`.
   - Huellas del original antes y después.
   - Cuenta cada tabla «solo principal» y «con `-wal`».
   - `VACUUM INTO` desde la vista con WAL.
   - `integrity_check`, y un manifiesto que tiene que ser idéntico al de la vista con WAL.
2. **Restaurar de verdad cada copia nueva.**
   - `npm run backup` restaura la copia en una carpeta temporal y compara los manifiestos, tabla a
     tabla, con huella de contenido independiente del orden (`db/manifiesto.ts`).
   - El resultado queda en `backup:last_verify`, y el doctor lo enseña.
   - `npm run restore -- --verificar <fichero>` hace el simulacro sin tocar nada.

## 2. Pre-partido

**Defectos confirmados (tests en `prematch/tiempo.test.ts`):**

- Nada impedía escribir una predicción «pre-partido» después del inicio. El ciclo pre-partido
  predice la lista de próximos, y esa lista conserva hasta medianoche los partidos que ya han
  empezado.
- Las comprobaciones comparaban texto. Por ejemplo, `'…23:00:30.000Z' < '…23:00Z'` es verdadero
  aunque la primera hora sea 30 s posterior, y con un desfase horario el error es de horas.
- La evaluación (en vivo, track records, archivo) contaba las filas tardías como si fueran
  pre-partido.

**Arreglos:**

- La migración 23 añade triggers que comparan instantes con `julianday`:
  - en los siete registros, `RAISE(IGNORE)`: la fila tardía no entra y el escritor sigue;
  - en instantáneas, finales, `paper_bets` y `strategy_bets`, `ABORT`.
- `prepartidoSql()` filtra la evaluación y `freezeFinals`.
- Las filas tardías que ya existían se quedan como están (el libro mayor no se reescribe). El
  archivo las enseña marcadas («escrita después del inicio») y no las cuenta en el resumen.

**EDM–ANA sin final congelada.** Hipótesis compatible con el código: la fila del registro se
escribió después del inicio, así que no hubo predicción pre-partido que congelar.
`recordSnapshot` ya rechazaba instantáneas tras el inicio. La auditoría de la copia lo dice fila a
fila en «partidos empezados sin final pre-partido», con su porqué. **Por confirmar en la copia.**

## 3. Frescura y liquidación

**Defecto confirmado: la cancelación a los 14 días.** Los dos bancos (papel y estrategias)
cancelaban y devolvían el importe de toda apuesta sin resultado 14 días después del inicio. Eso es
deducir un resultado del paso del tiempo. Con la fuente atrasada (el tenis lleva meses parado)
cancelaba para siempre apuestas de partidos que sí se jugaron, porque una apuesta liquidada no se
vuelve a liquidar.

- **Arreglo:** la regla se retira y la apuesta sigue pendiente hasta tener resultado.
- Las `cancelled` antiguas se quedan como están. La auditoría de la copia las lista.

**Causas de que la historia no avance:**

- **Tenis, confirmado.** TML-Database dejó de actualizarse: su `2026.csv` llega al 2026-01-17 y es
  idéntico al de la copia. La reserva automática a tennis-data.co.uk solo salta si TML devuelve
  **cero** partidos, y devuelve 30.000.
  - Defecto latente aparte: el CSV de la temporada en curso se bajaba una vez y no se volvía a
    pedir. **Arreglo:** la temporada en curso y la anterior se piden en cada ingesta, y la copia
    solo se usa sin red.
  - Cambiar de fuente es decisión del dueño (ver acciones).
- **Béisbol, confirmado en el código.** `ingestMlbSeason` pide solo `gameType=R`, así que los
  playoffs de octubre nunca tendrán resultado con esa fuente. Que falte la temporada regular 2026
  entera apunta a que `update-data:bsb` no llegó a ingerirla en producción.
  - **Por confirmar** en `ingestion_runs` de la copia.
  - No se cambia: meter los playoffs en `bsb_games` cambia los datos con los que se ajusta el modelo.
- **NFL (5 de octubre en la copia).** El trabajo «resultados» la actualiza cada 6 h si
  `datos.resultadosProgramados` está encendido. **Por confirmar** en `scheduler_jobs` e
  `ingestion_runs` de la copia.

**Nuevo: `monitoring/vencidas.ts`.** Cuenta predicciones y apuestas sin resultado más de 48 h
después del inicio, **por competición** (en el fútbol, la Premier puede estar al día y la Segunda
llevar un año parada). A cada una le da una causa:

- `fuente_atrasada`: el partido es posterior al último resultado de su fuente;
- `sin_emparejar`: la fuente cubre esa fecha y el partido no aparece;
- `sin_hora`: la hora no se entiende;
- y para las apuestas, `sin_registro` y `por_liquidar`.

Lo que hace con ello:

- **Doctor:** sección OPERACIÓN.
- **Freno por competición** (`trust/decision.ts`, familia «archivo atrasado», de tubería). Si una
  competición tiene partidos empezados hace más de 48 h que su fuente no tiene, no se apuesta en
  ella.
  - Hace falta esa prueba. Un hueco largo no basta: la primera jornada de una temporada viene tras
    meses sin resultados y no está atrasada.

En la copia local, el doctor ve la NHL (64) y la NFL (16) con la fuente atrasada. Cuadra: la
historia local es del 6 de octubre.

## 4. Duplicados y entrada malformada

Confirmado en los CSV locales de TML. `ingest/tmlLectura.ts` valida cada fila. Cada anomalía queda
en `ingest_anomalias` (migración 24, historia) con fichero, línea, número de partido y lo que se
hizo:

| Qué | Dónde | Qué se hace |
| --- | --- | --- |
| Fila con 37 campos de 50 (final de las Next Gen, Tien–Blockx) | `2025.csv:2945` | Se guarda el resultado. Las estadísticas de saque de los dos quedan DESCONOCIDAS, porque `w_1stWon='2'` puede estar cortado. Antes entraba con 2. |
| 8 partidos repetidos con otro `match_num` | 2017 (×4), 2021 (×2), 2022, 2024 | Se guarda uno, y la línea descartada queda apuntada. |
| 2 partidos repetidos con otras estadísticas | 2017 AUS–USA, 2025-495 R32 | Se guarda uno. Lo que no coincide queda DESCONOCIDO, por lados, como hace `serveStats`. |
| Los mismos dos en la misma ronda con otro marcador | — | Se guardan los dos y se apuntan para revisar (puede ser un round robin). |
| Filas con columnas de más | — | Fuera. |

La ingesta del tenis reconstruye la tabla entera en cada pasada (`resetData`), así que repetirla da
lo mismo. Algunos torneos de TML traen `match_num` vacío, así que una clave única sobre él
perdería partidos reales.

**Efecto en el modelo:** el Elo deja de contar dos veces 10 partidos de unos 30.000. Lo recogerá la
próxima `update-data`, con su `data_version` nueva. No cambia ningún parámetro.

## 5. Observabilidad de la ingesta de cuotas

**Defecto confirmado.**

- Cada ejecución `odds:*` guardaba `ok` y el número de **próximos**.
- El histórico guarda solo las cuotas que cambian.
- Un fallo al guardar se escribía en stderr y nada más.

Con eso, 16 h de ejecuciones «ok» sin snapshots no se podían explicar.

**Arreglo** (`odds/metricas.ts`, migración 25):

- Cada ejecución guarda en `ingestion_runs.metrics` (JSON) peticiones y fallos, eventos devueltos,
  cuotas vistas, cuotas cambiadas, snapshots y observaciones guardados, y el `last_update` más
  nuevo de las casas.
- `rows_added` pasa a ser «snapshots guardados».
- `detail` lo dice en una línea: «sin cambios», «la API no devolvió ningún evento», «ninguna
  petición»…
- Un fallo al guardar convierte la ejecución en **error**.

**Por confirmar en la copia.** `npm run auditoria:copia` busca los tramos con ejecuciones ok y
ningún snapshot. Con las observaciones de esas horas distingue tres casos:

- hubo descargas sin cambios;
- era demostración;
- ninguna de las dos. Con las ejecuciones de antes de este cambio, no se puede saber más.

## 6. Cobertura

- **UFC: 64 peleas sin id, 52 ambiguas y 12 «sin ficha».** El nombre de la pelea no está en la
  lista de luchadores de la misma fuente («Kai Kamaka» / «Kai Kamaka III», «Bibulatov Magomed»,
  «Rafael Cerquiera», «Patricio Freire»).
  - Ahora se guarda el motivo (`ufc_fights.sin_ficha`, migración 26) y la auditoría lista los
    nombres con candidatos **para revisar, no aplicados**.
  - No se empareja por parecido. ufcstats.com no es accesible desde aquí para comprobarlo en la
    página de cada pelea.
- **NFL sin empate:** a propósito. El moneyline se anula con el empate, así que la probabilidad
  publicada se renormaliza a dos bandas (`nfl/predict.ts`). El modelo crudo sí tiene empate. No se
  cambia.
- **Tablas vacías:** la auditoría las lista. En la copia local son las de funciones sin datos
  todavía (apuestas reales, alineaciones, noticias, bullpen…). Ninguna entra en una probabilidad
  publicada sin decirlo: lo que no hay sale como DESCONOCIDO en la calidad de datos.

## Revisiones (20 de octubre)

**data-guardian.** Migraciones 23–26: seguras, en las disposiciones partida y de un fichero, y
repetibles. Hallazgos arreglados, cada uno con su test:

1. `restore` (y `--verificar`) abría la copia y SQLite volcaba en ella su `-wal`: el simulacro
   destruía la prueba de las 133 filas. Ahora restaurar y simular trabajan sobre una copia suya.
2. Las salidas de `copia:consolidar` y `auditoria:copia` caían en el repositorio, sin ignorar, con
   libros mayores enteros. Ahora van por defecto a la carpeta personal, se niegan a escribir en el
   repositorio salvo en `data/`, y `.gitignore` las cubre.
3. Volver a pedir la temporada en curso:
   - un cuerpo cortado, un 404 o una descarga que no se parece a la copia ya no sustituyen la copia;
   - la copia se escribe a temporal y se renombra;
   - las temporadas vivas se bajan y se comprueban **antes** de vaciar las tablas.
4. Una errata en las opciones de `restore` ya no hace una restauración de verdad. Y la de verdad
   pide `--confirmar` explícito: si falta `--` y npm se queda la opción, el script no restaura.
5. Una copia que no pasa la restauración de prueba se aparta (`.sin-verificar`), no rota las
   buenas, y el doctor lo da como error.
6. Los filtros del banco y de las estrategias comparan instantes, como los triggers.
7. Una fila sin algo que identifica el partido se descarta, en vez de recibir el 1 de enero. Un
   repetido con otra fecha se descarta entero. Una descarga por HTTP de una temporada viva (la en
   curso y la anterior) en que se descartaría más del 5 % de las filas, o que ni se deja leer, no
   se usa: se queda la copia de `data/raw`, y sin copia `update-data` para antes de vaciar nada
   (en el preflight o en la precarga). No pasan este filtro las temporadas cerradas (se leen de la
   copia y sus filas malas se descartan una a una, como antes) ni lo que llega por `git clone` o de
   una copia manual en ZIP.
8. Las anomalías se apuntan por circuito (`tml:atp`).
9. Otros cambios:
   - la contención de la salida se comprueba con rutas reales y sin distinguir mayúsculas;
   - las copias consolidadas se escriben a temporal y se renombran;
   - un principal ilegible se apunta como DESCONOCIDO y no para la consolidación;
   - `auditoria:copia` se niega sin `ledger.db`;
   - los tests no dejan restos fuera de su DATA_DIR.

Lo que el simulacro prueba, dicho claro: que el **fichero** de la copia se restaura idéntico, tabla
a tabla. Que la copia tenga todo lo del libro mayor vivo lo garantiza `VACUUM INTO`, que lee una
foto consistente con su WAL. El simulacro no lo vuelve a medir.

**data-guardian, segunda pasada.** Arreglados, con su test:

- **Validar antes de guardar.** Una descarga rota que se parece a la copia (misma cabecera y
  líneas) la pisaba antes de comprobarla con `leerTml`, y se perdía la única copia buena. Ahora se
  comprueba antes de guardar.
- **Transacciones.** Si algo falla a mitad de una temporada, su transacción se deshace. Antes se
  quedaba abierta y la reserva de tennis-data.co.uk no podía escribir: el tenis acababa vacío.
- **`restore`** pide `--confirmar`, y para si npm se quedó una opción.
- **La primera copia de todas** que no pasa el simulacro sale como error, no como «nunca se ha
  hecho».

Sin test, porque no se puede fabricar el caso de forma fiable:

- una consolidación que no pasa sus comprobaciones queda como `.no-verificada`, no con el nombre
  bueno;
- si el fichero principal solo no se deja leer, la auditoría dice DESCONOCIDO, no 0;
- el banco no apuesta un partido que empezó entre la consulta y el alta.

**data-guardian, tercera vuelta.** Arreglados, con su test:

- **Una descarga que ni se deja leer** (una comilla sin cerrar) hacía lanzar a la comprobación; el
  error se saltaba la copia, la ingesta volvía a pedir el fichero sin comprobarlo y lo guardaba
  encima de la copia buena. Ahora es un motivo de rechazo más, y la ingesta comprueba igual que la
  precarga las temporadas vivas que vuelve a pedir.
- **Un circuito que falla a medias** dejaba dentro sus primeras temporadas, y la reserva de
  tennis-data.co.uk metía el rango entero otra vez con otros ids de jugador: cada partido, dos
  veces. Ahora, si la ingesta de un circuito falla, se borran sus partidos, jugadores, rankings y
  anomalías antes de la reserva.
- **ROLLBACK** ya no tapa el error de verdad cuando SQLite ya deshizo la transacción (disco lleno):
  en la ingesta de TML y en la de tennis-data.co.uk.
- **El preflight guardaba sin comprobar** la temporada en curso cuando no había copia (instalación
  nueva, `--fresh`, temporada nueva): la precarga la tomaba luego por una copia buena y la parada
  del 5 % no saltaba nunca. Ahora el preflight la comprueba igual, y un fichero roto sin copia para
  `update-data` antes de vaciar nada.
- **Si el borrado del circuito también falla** (base bloqueada), el error que se ve es el primero,
  con el del borrado en `cause`, y `update-data` no prueba la reserva mientras queden partidos del
  circuito. Lo dice con los dos errores, y su error final ya no lo achaca a un bloqueo de red.
- **Un fichero roto sin copia que para el preflight** para también la actualización de la WTA, que
  va por tennis-data.co.uk: el mensaje dice cómo actualizar solo desde ahí
  (`npm run update-data -- --source tennis-data`).
- **Los tests tampoco salen a la red por git.** Al reproducir lo anterior, un test sin todas sus
  respuestas simuladas cayó a `git clone` y clonó el repositorio real: el `fetch` simulado no lo
  paraba. Ahora la preparación de los tests solo deja clonar carpetas locales.

Queda, de antes de esta rama: `update-data` vacía las tablas del tenis (`resetData`) antes de tener
en la mano las temporadas cerradas. Si la fuente no contesta en la precarga, una temporada rota sin
copia y tennis-data.co.uk caído a la vez dejan el tenis vacío, con error (antes entraban sus filas
buenas). Lo de verdad es construir en tablas aparte y cambiarlas en una transacción: es otro lote.

La migración 24 se cambió antes de publicarse, y su versión anterior solo llegó a correr en una
base local de desarrollo que ya no existe: no hace falta una migración que la corrija.

El test de TML fallaba a veces con «Unable to deserialize cloned data». Era el progreso de la
ingesta escrito en el stdout por el que el proceso de cada test informa al padre. Ahora los tests
lo callan: 0 de 20 pasadas, frente a 9 de 20 antes.

**quant-reviewer.** Arreglados, cada uno con su test:

- **F6:** «¿Acertó?» (en vivo) y la confianza del sistema tampoco cuentan las filas tardías.
  `system.ts` ya mira los siete registros, no cinco.
- **F3 y F4:** el freno pide pruebas de **dos días distintos de los últimos 30**. Un aplazado solo
  no frena la liga entera, y unos playoffs que la fuente no trae no frenan la temporada siguiente.
- **F9:** la NFL se mira por liga.
- **F10:** la caché del freno es de su «ahora».
- **F5:** las estrategias sin capa de confianza también respetan el freno.
- **F8:** el freno entra en la política versionada como `abstencion.archivoAtrasadoHoras`: 48, y 0
  lo apaga.
  - Una política guardada antes de que existiera la clave **no frena**. La regla empieza con la
    primera versión que la dice, y así cada apuesta lleva la versión de política que la aplicó.
  - `nuevaVersion` añade las claves de fábrica que falten, así que cualquier versión nueva ya la
    dice.
- El doctor usa las horas de la política y dice, por competición, si el freno ya actúa, si aún le
  faltan pruebas o si está apagado.
- **F11:** el doctor ya no aconseja «npm run dev» para esta causa.
- **F1 (visibilidad):** el doctor da **error** cuando lo vencido del banco de papel ocupa la mitad o
  más de su tope de exposición.

**Decisiones del dueño que salen de la revisión (no se han tocado):**

- **F1:** una apuesta sin resultado sigue contando en los topes de exposición.
  - Si la fuente no la va a traer nunca (los playoffs de la MLB con `gameType=R`), el banco se
    queda sin margen en esa liga, o en todas, hasta que se decida cómo liquidarla.
  - El freno evita que se acumulen más a partir del segundo día con pruebas. Las primeras 48 h de
    unos playoffs sí entran.
  - Opciones:
    - traer esos resultados para liquidar (tabla aparte);
    - una regla de política, versionada, que saque de los topes lo vencido hace más de N días;
    - una anulación manual con prueba de la fuente.
- **F2:** los límites de pérdida diaria y semanal cuentan por fecha de liquidación. Si se liquida
  de golpe un atraso, todo cae en el mismo día y bloquea el banco. Se puede cambiar a fecha del
  partido: es política.
- **F7 (ya existía):** el ROI del banco y el de la comparación de estrategias usan denominadores
  distintos para las `cancelled` antiguas.
- **F12 (ya existía, conservador):** el factor de confianza se aplica después de los topes.

## Verificación

Todo esto es local. Nada se ha probado contra la copia del 12 de octubre.

Con el código del commit, en un contenedor sin datos (`data/` vacío):

- `npm run typecheck`, `npm run lint`: limpios.
- `npm test`: 630/630 en el servidor y 89/89 en la web.
- `npm run build`: ok.
- Playwright: 187/187.
- `npm run verify:data`: 401 de 402. Falla «puntos: useSurface=false deja las desviaciones
  exactamente en cero», igual que en b3d0abc sin estos cambios: sin partidos de tenis no hay nada
  que ajustar.
- `npm run audit`: 4/4, con todos los deportes «sin datos, saltado».

Antes, con la copia local de `data/` (hasta el 8 de octubre). El contenedor se reinició después y
esa copia ya no está, así que esto no se ha podido repetir con el código final:

- `npm run verify:data`: 528/528 y `npm run audit`: 4332/4332.
- `npm run auditoria:copia` sobre esa copia. El original quedó intacto (mismos SHA-256).
  Reprodujo:
  - los 10 grupos de partidos repetidos;
  - las 13 anomalías de los CSV, entre ellas la línea 2945;
  - las 64/52/12 peleas de la UFC.

## Restaurar y volver atrás

1. **Comprobar la copia sin tocar nada:**
   - Una carpeta: `npm run copia:consolidar -- <carpeta>`. Escribe en `~/copia-consolidada-<fecha>`
     los ficheros `ledger.consolidada.db` e `history.consolidada.db`, y su manifiesto.
   - Un fichero: `npm run restore -- --verificar <fichero>`. Trabaja sobre una copia suya y no lo
     toca, aunque tenga `-wal`.
2. **Restaurar el libro mayor** (pide la aprobación del dueño): `npm run restore -- <fichero> --confirmar` con
   la copia **consolidada**, nunca un `ledger.db` suelto de una carpeta con `-wal`.
   - Antes de sustituir, el script aparta el libro mayor actual, con lo que tuviera en su `-wal`,
     como `ledger.db.antes-de-restaurar-<fecha>`.
   - Después: `npm run doctor`.
3. **Volver atrás del código:** `git revert` de este commit.
   - Las migraciones 23–26 solo añaden: triggers `IF NOT EXISTS`, una tabla y dos columnas con
     comprobación previa. Nada que tenga un código anterior se rompe con ellas.
   - Quitar los triggers de la 23 es `DROP TRIGGER <tabla>_prepartido` (los nombres están en
     `prematch/tiempo.ts`). Hacerlo sería volver a dejar entrar filas tardías.
   - **Si se vuelve al código anterior, hay que quitar al menos los cuatro ABORT**:
     `prediction_snapshots_prepartido`, `prematch_final_prepartido`,
     `paper_bets_alta_prepartido` y `strategy_bets_alta_prepartido`. El `freezeFinals` anterior
     compara texto, y una fila que el trigger rechaza haría fallar la congelación entera.
   - La política: si se creó una versión con `archivoAtrasadoHoras`, el código anterior ignora esa
     clave.
   - `ingest_anomalias` y `ufc_fights.sin_ficha` están en la historia, que se reconstruye.
4. **Volver atrás de los datos:** ninguna migración reescribe ni borra filas del libro mayor. La
   única escritura sobre datos existentes es `ufc_fights.sin_ficha`, en la historia, que es
   reconstruible.

## Límites

- Las cifras de la auditoría (133 filas, las 4 tardías, EDM–ANA, las 142 predicciones y 5
  apuestas vencidas, las 16 h de cuotas) **no se han verificado aquí**: hace falta la copia.
- Las ejecuciones de cuotas anteriores a este cambio no guardan métricas. El tramo de 16 h solo se
  puede acotar con las observaciones.
- El freno por competición necesita partidos registrados que no tienen resultado, de dos días
  distintos. Una competición sin nada registrado no se frena, aunque su fuente esté parada (para
  eso está el aviso de temporada del doctor). Las primeras ~48 h de partidos que la fuente nunca
  traerá sí se apuestan.
- Tras un `update-data` (en otro proceso), el freno puede tardar hasta 15 min en enterarse.
- Pedir dos días de pruebas alarga el margen en que se apuestan partidos que la fuente nunca traerá:
  - unas ~17 h más en los playoffs de la MLB del ejemplo de la revisión (F3: es la decisión F1);
  - unos 9 días en competiciones con un evento por semana, como la UFC.
- Unos playoffs que la fuente no trae, con un parón de menos de 30 días antes de la temporada
  siguiente, frenarían su primera jornada. Por ejemplo, la Liguilla de la Liga MX, si
  football-data no la trae (no comprobado).
- El error del doctor por exposición bloqueada mira el banco de papel; los bancos de las estrategias
  solo dan avisos.
- El tenis seguirá sin resultados nuevos mientras la fuente sea TML.

## Acciones de producción que necesitan aprobación

1. Ejecutar `npm run auditoria:copia -- ~/copia-datos-s-nhl-12oct --raw ~/copia-datos-s-nhl-12oct/raw`
   en el Mac y compartir `resumen.md`. Solo lee.
2. Justo antes de desplegar, hacer una copia con `npm run backup` y comprobar que el doctor enseña
   «Restaurada de prueba».
3. Desplegar este cambio (`git pull` + `fly deploy`). Al arrancar se aplican las migraciones 23–26.
4. Tras el despliegue, crear una versión de la política que diga el freno
   (`abstencion.archivoAtrasadoHoras: 48`, desde Ajustes). **Hasta entonces el freno está
   apagado** (el doctor lo dice): la regla solo actúa con una versión de política que la incluya.
5. **Antes de que el banco se quede sin margen:** decidir F1 y F2 (arriba).
6. **Tenis:** decidir si se reconstruye desde tennis-data.co.uk (`npm run update-data -- --source
   tennis-data`). Cambia los ids de los jugadores y los datos del modelo publicado: necesita
   experimento y versión.
7. **Béisbol:**
   - revisar por qué falta la temporada regular 2026 (`ingestion_runs` de `update-data:bsb`);
   - decidir si los playoffs se guardan para liquidar, en una tabla aparte o con `game_type` fuera
     del Elo.
8. **UFC:** confirmar en ufcstats.com los candidatos de los 4 nombres sin ficha antes de añadir
   ningún alias.
9. Las apuestas `cancelled` antiguas por la regla de 14 días se quedan como están: el libro mayor
   no se reescribe. Hay que decidir si se anotan aparte para los informes de ROI.
