# Auditoría paralela del 3 de noviembre: ajustes privados y guardado de interruptores

Commit auditado: `05a8e122f7960eb1e1e26b18d348265e57e9ae21` (rama `claude/tennis-prediction-app-jlhgxh`).
Dos hallazgos verificados por la auditoría. Se comprobaron contra el código de esa rama antes de tocar
nada: ninguno estaba arreglado. Cada uno se reprodujo con una prueba que fallaba antes del arreglo.

Los ficheros de la auditoría (`parallel-audit-2026-11-03.md` y los dos `*-repro.mjs`) están en la
máquina del dueño y no se pudieron leer desde esta sesión: lo que sigue se verificó contra el código y
las pruebas, no contra ese informe.

## 1. Los ajustes privados del dueño: exportación, publicación y descarga

La migración 27 (`server/src/db.ts`, «ajustes-al-ledger») lleva `ajustes.usuario` (con el banco
personal) y `features.anulaciones` a `ledger.settings` y deja su copia en `main.meta` a propósito: si
se restaura un libro mayor de antes de la migración, la migración vuelve a correr y los recupera.

**Verificado:**
- `npm run db:export-history` (`server/src/scripts/dbExport.ts`) hace `VACUUM main INTO` y solo
  miraba tablas: la exportación llevaba esa meta y decía «sin tablas del libro mayor».
  Reproducido con la migración real y el exportador real.
- `npm run check-publishable` solo miraba tablas y cuántas filas: daba «Publicable» a una base con
  `ajustes.usuario` en la meta.
- `npm run fetch-data` conservaba lo del dueño con `INSERT OR IGNORE`: si la historia descargada
  traía esas claves, mandaban las descargadas (el banco 99999 de la descarga en vez del 250 local).
  Y en una instalación nueva, sin historia local, no se miraba nada: la migración 27 las habría
  llevado tal cual al libro mayor nuevo. No se ha visto ninguna release con esas claves: es una
  reproducción sintética.

**Arreglo (una sola frontera, con la clasificación del servidor):** `claveEsLedger` de
`server/src/db/tables.ts` (los nombres de `CLAVES_LEDGER` y los prefijos `backup:`, `retention:`,
`policy:`, `scheduler:`, `telegram:`) decide qué claves de meta son estado del dueño.
- **El exportador** trabaja en una copia intermedia:
  - borra ahí esas claves con `secure_delete`;
  - escribe el fichero final con `VACUUM INTO` desde la copia limpia, así que no quedan ni sus bytes;
  - comprueba integridad, tablas, claves y que sus nombres no estén en los bytes;
  - solo entonces lo renombra a su sitio. Si el proceso muere a medias, en el destino no queda nada a
    medio limpiar.
  - La base original no se toca: conserva su copia de recuperación.
- **`check-publishable`** abre el fichero en solo lectura y rechaza (`[privacidad]`), diciendo la clave
  y nunca el valor:
  - cualquier clave así en la meta;
  - los restos de esas claves en los bytes del fichero (una fila borrada sin `VACUUM` sigue dentro).
    Ninguna de esas cadenas está en el esquema de la historia.
- **`fetch-data`**, en toda historia descargada antes de instalarla (instalación nueva y `--force`):
  - quita esas claves y avisa sin enseñar los valores;
  - conserva las locales que recoge la migración 27 (`CLAVES_RECUPERABLES`, la misma constante que
    usa la migración) con `INSERT OR REPLACE`;
  - no instala una descarga que traiga tablas del libro mayor.
  - Corre con `tsx`, como `check-publishable`, para importar la misma clasificación. Para quien usa
    `npm run fetch-data` no cambia nada.

**Revisión data-guardian (en paralelo, sobre `05a8e12`):** confirmó los tres puntos y encontró un camino
peor, ya cerrado aquí con su prueba:
- **Lo que encontró:** una descarga con tablas del libro mayor (`watchlist`, `paper_bets`…) las ponía
  en la historia. Ahí tapaban las del libro mayor adjunto (la app resuelve primero en `main`): lo del
  dueño se leía y escribía en un fichero que un `--force` borra.
- **Cuándo pasa:** solo con una release que no salga del workflow oficial (`DATA_REPO`, `DATA_TAG`,
  `DATA_BASE_URL`). El SHA-256 prueba que llegó entera, no de dónde viene.
- **Ahora:** `fetch-data` no la instala.
- **Efecto en la prueba de `--force` (B1):** su release de mentira ya no trae `bets`, como una oficial.
  La fila de `bets` de esa instalación anómala no pasa a la historia nueva, y sigue en la copia de la
  anterior.

También, por la misma revisión:
- el exportador se construye aparte y renombra al final;
- `carryOver` pasa solo las dos claves que recoge la migración 27, y no rutas de copias ni el offset
  de Telegram;
- `check-publishable` mira los bytes.

**Segunda vuelta de las dos revisiones, sobre el arreglo.** Cada punto, con su prueba que falla antes:
- **El exportador no miraba su destino** (data-guardian, alta). `db:export-history -- data/ledger.db`
  reemplazaba el libro mayor por una historia. Ya pasaba antes, y la primera versión de este arreglo lo
  empeoraba: también borraba su WAL. Ahora se niega a exportar encima de la historia viva, del libro
  mayor, de un `tennis.db` sin partir o de sus laterales, de un fichero que no es una base, y de una
  base con tablas del libro mayor. Una exportación anterior sí se reemplaza.
- **Las vistas también tapan** (data-guardian, media). Una descarga con una vista llamada como una tabla
  del libro mayor (`paper_bets`) tampoco se instala.
- **Filas del dueño en tablas del libro mayor de la historia local** (data-guardian, media). `--force`
  las dejaba solo en la copia con fecha, sin decir nada, y la rama de «solo esquema» las apartaba.
  Ahora `fetch-data` no reemplaza ni aparta esa historia: dice qué tablas y cuántas filas, nunca su
  contenido. Pasarlas al libro mayor es cosa del dueño, porque `fetch-data` nunca escribe en él. Las
  tablas del libro mayor salen de `MINE`: copiarlas ya no podía pasar.
- **Un fallo a medias de la exportación dejaba temporales con la meta privada** (las dos revisiones).
  Ahora un `finally` los borra (`.parcial`, `.limpia` y sus laterales), y `.dockerignore` excluye
  `data/*.export.db.*`.
- **La migración 27 vuelve a su lista fija** (data-guardian). `CLAVES_RECUPERABLES` tiene que decir lo
  mismo, y una prueba lo comprueba: importa exactamente esas claves y nada más del libro mayor. Una
  clave nueva pide una migración nueva.
- **La prueba del bloqueo de Ajustes usa `PUT /api/ajustes`** (security): `GET` no mira el interruptor.

Lo que se deja, de la misma revisión:
- `check-publishable` mira por SQL la base con su `-wal`, y por bytes solo el fichero (que es lo que se
  publica). Una base con un `-wal` lleno podría diferir; la exportación nunca lo tiene.
- La búsqueda por bytes falla cerrada: un texto corriente con `policy:` o `backup:` pararía la
  publicación. Si pasa, se estrecha la búsqueda, no se quita.

**Pruebas:**
- `server/src/scripts/exportPrivado.test.ts`:
  - migración 27, después la exportación real: ni las claves ni sus bytes en el fichero exportado;
  - la base original idéntica byte a byte (SHA-256) y con su meta de recuperación;
  - `check-publishable` rechaza la original y acepta la exportada;
  - `check-publishable` rechaza cada nombre y cada prefijo sin enseñar el valor, y acepta la misma
    base sin ellos;
  - `check-publishable` rechaza un fichero con restos de una clave borrada sin `VACUUM`;
  - después de exportar no queda ningún temporal.
- `server/src/scripts/fetchData.test.ts`:
  - una release contaminada en una instalación nueva: solo queda la procedencia;
  - `--force` sobre una instalación de antes de la migración 27: mandan los ajustes locales, nada
    ajeno se cuela, no pasa más estado local que las dos claves, y la copia de la anterior conserva lo
    que tenía;
  - una descarga con tablas del libro mayor: no se instala; con `--force`, la historia local queda
    idéntica (SHA-256) y sin copias ni temporales.

## 2. Guardar un interruptor que falla dejaba la app aplicándolo

`fijarAnulacion` (`server/src/features.ts`) publicaba el mapa nuevo en memoria antes de llamar a
`guardar`. Si SQLite rechazaba la escritura, la llamada lanzaba, pero la app ya aplicaba el cambio:
guardado `estrategias.laboratorio = false`, en marcha `true`. Era de antes de los últimos cambios.

**Arreglo:** se calcula el mapa nuevo, se guarda, y solo si `guardar` termina se publica en memoria y
se limpian las marcas de lectura. Se mantiene: los de arranque siguen sin poder fijarse, `{"on":
null}` quita, lo ilegible da 409 sin escribir, y un guardado que sale bien cambia las dos cosas.

**Pruebas:**
- `server/src/features.test.ts`: con `guardar` que lanza, al encender, al apagar y al quitar no cambia
  ni lo guardado, ni lo que aplica la app, ni las demás anulaciones; con éxito cambian las dos.
- `server/src/auth/puerta.test.ts`: un rechazo de verdad de SQLite (un trigger temporal sobre los
  ajustes del libro mayor, en la conexión de la app). `PATCH` responde 500 sin el detalle interno, y
  lo guardado, `featureEncendida` y `GET /api/features` siguen igual, al encender y al apagar.

**Revisión security-reviewer (en paralelo, sobre `05a8e12`):** confirmó el hallazgo con un rechazo
de verdad de SQLite y encontró dos consecuencias más del orden de antes, ahora con prueba (fallan con
el orden viejo y pasan con el nuevo):
- un `PATCH` posterior de otro interruptor que sí se guardaba guardaba de rebote el cambio rechazado,
  que se volvía permanente;
- con `interfaz.ajustes` rechazado al apagarlo, la app lo daba por apagado y el siguiente `PATCH` o
  `PUT /api/ajustes` respondía 404 hasta reiniciar.

Dio por bueno el arreglo. El 500 genérico con `requestId` es la respuesta correcta y no enseña el
error interno.

**Pendiente (de la misma revisión, de antes y fuera de estos dos hallazgos):**
- `ajustes/index.ts`: si `ajustes.usuario` no se puede leer, `leerAjustes` da los valores por
  defecto y `guardarAjustes` los escribe encima con el cambio: el banco personal se pierde. Debería
  negarse (409), como ya hace `features.anulaciones`.
- `scheduler/registry.ts`: `PATCH /api/scheduler/:nombre` guarda `enabled` antes de validar
  `cadenciaMin`, y fuera de una transacción: un 400 deja el cambio a medias.
- `routes/ajustes.ts` y `routes/operacion.ts`: los `catch` genéricos convierten un fallo de SQLite en
  un 400 con el mensaje crudo y sin `error_log`. Y el 409 de los interruptores se reconoce por el
  texto del mensaje, no por un tipo de error.
- `features.ts`, latente (ningún caso en producción): sin lector, `fijarAnulacion` partiría de `{}` y
  pisaría lo guardado.
- `staking/policyStore.ts`: la caché de la política es por proceso. Ya estaba en la tarea aparte de
  la revisión quant (`auditoria-22-octubre.md`).

**Pendiente (de la revisión data-guardian, de antes y fuera de estos hallazgos):**
- `db/split.ts` solo quita tablas: la meta de una historia partida conserva todas las claves del libro
  mayor. No se publican (las quita el exportador), pero no tienen quién las lea.
- Restaurar un libro mayor de antes de la migración 27 vuelve a aplicarla sobre la `main.meta` de ese
  momento: una foto de los ajustes del primer arranque tras la 27, no los de hoy. Convendría que la
  migración dijera cuántas claves importa.
- Si la historia local solo tiene esquema, `fetch-data` la aparta sin pasar lo del dueño (sus claves
  de antes de la 27 quedan en `history.db.sin-filas-*`).
- `copiarSettings` (`db/split.ts`) se traga los errores y devuelve 0.
- `.dockerignore` no excluye `data/.restaurar-*/origen.db`, la copia del libro mayor que deja una
  restauración interrumpida.

## Límites

- Esto no arregla datos: no limpia ninguna release ya publicada ni ninguna base local. No se ha visto
  ninguna release con estas claves; si existiera, la próxima descarga ya las descarta.
- Una base local que ya hubiera recibido claves ajenas por una descarga anterior (tampoco se ha
  visto) sigue con ellas en su meta hasta la próxima descarga, y la migración 27 solo las lee si se
  restaura un libro mayor de antes de esa migración.
- No cambia nada de modelos, liquidación ni cuotas.
- En las pruebas del exportador, tras otras exportaciones en el mismo proceso, un proceso hijo no
  siempre veía lo que la conexión de la prueba acababa de escribir. Con un checkpoint antes de lanzarlo
  lo ve siempre. No se reproduce aislado y no se encontró la causa. No afecta a la privacidad: el
  exportador quita lo que ve y solo escribe eso.
