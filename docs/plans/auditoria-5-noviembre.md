# Auditoría del 5 de noviembre: temporales del exportador y ajustes de una historia sin filas

**Commit auditado:** `91c4c041dab16a5609d5a639a7683304cc16ad40`, el último de la rama antes de unirse a
`main` en `5c8b828`. El arreglo parte de `main` (`5c8b828`).

Son dos hallazgos verificados por la auditoría. Antes de tocar nada se comprobaron contra el código: ninguno
estaba arreglado. Cada uno se reprodujo con una prueba que fallaba.

Los ficheros de la auditoría (`github-audit-2026-11-05.md` y los dos `*-repro-2026-11-05.mjs`) están en la
máquina del dueño y no se pudieron leer desde esta sesión. Lo que sigue se verificó contra el código y las
pruebas, no contra ese informe.

## 1. El exportador borraba ficheros que no eran suyos

**El fallo.** `server/src/scripts/dbExport.ts` usaba temporales con nombre fijo, sacado del destino
(`<destino>.parcial` y `<destino>.limpia`). Al empezar y al terminar los borraba, con sus laterales, sin
mirar de quién eran.

**Reproducido:**
- Una base ajena en `history.export.db.parcial`, con una fila en `paper_bets`, desaparecía al exportar a
  `history.export.db`, saliera bien o mal la exportación.
- Cuatro exportaciones a la vez fallaban con `disk I/O error`: compartían los mismos temporales.

**Arreglo.** Cada exportación trabaja en un directorio PROPIO, creado con `mkdtemp` junto al destino
(`<destino>.tmp-XXXXXX`):
- Al estar en el mismo sistema de ficheros, el `rename` final reemplaza el destino de una vez.
- Al terminar, salga bien o mal, se borra solo ese directorio.
- `<destino>.parcial` y `<destino>.limpia` ya no se tocan.
- Los directorios temporales de otras exportaciones (en marcha o interrumpidas) se avisan, no se borran.
- Lo que haya en el destino se vuelve a mirar justo antes de reemplazarlo: pudo cambiar mientras se
  exportaba.

Se mantiene lo de antes:
- no exporta encima de la historia viva, del libro mayor, de un `tennis.db` sin partir ni de sus laterales;
- quita la meta privada sin dejar sus bytes;
- la base original conserva sus valores de recuperación;
- comprueba la integridad;
- limpia lo suyo si falla;
- reemplaza una exportación anterior válida.

**Pruebas, en `server/src/scripts/exportPrivado.test.ts`** (más las de la revisión, abajo). Ficheros ajenos con los nombres de antes (una
base con una apuesta y su `-wal`, un texto y su `-journal`) sobreviven idénticos (SHA-256):
- a una exportación que sale bien;
- a una que falla a medias;
- a cuatro exportaciones a la vez, tres al mismo destino y una a otro del mismo directorio. Cada destino
  queda íntegro, sin meta privada ni sus bytes, y sin temporales.

## 2. Una historia sin filas perdía los ajustes del dueño al descargar

**El fallo.** En `scripts/fetch-data.mjs`, una historia sin partidos (`hayHistoria` falso) se apartaba como
`history.db.sin-filas-*` antes de calcular `exists`. Como `carryOver` solo corría con `exists`, sus ajustes
no pasaban a la nueva: `features.anulaciones` (`estrategias.laboratorio=false`) y `ajustes.usuario`, de antes
de la migración 27. Se quedaban solo en la copia apartada.

Además, si la descarga fallaba, `history.db` ya no estaba en su sitio. Los ajustes que ya están en el libro
mayor no se ven afectados. Era un hueco antiguo, no una pérdida: la copia apartada los conservaba.

**Reproducido** de punta a punta, con el descargador real y una release servida en local:
- la base instalada tenía la meta vacía de lo del dueño;
- tras una descarga fallida, `history.db` no estaba.

**Arreglo.** La historia sin filas ya no se aparta antes de descargar. Después de validar la descarga se
trata como `--force`:
1. se vuelve a mirar que nadie la tenga abierta;
2. se hace una copia consistente con fecha, con el nombre de siempre (`history.db.sin-filas-<fecha>`);
3. `carryOver` pasa desde esa copia las tablas de `MINE` y las claves que recoge la migración 27, con
   `INSERT OR REPLACE`, así que mandan las locales;
4. se instala la nueva.

Las claves privadas que traiga la descarga se siguen descartando, y su procedencia se queda. Si la descarga
falla, la historia sigue en su sitio, idéntica, sin copias ni temporales. `ledger.db` no se toca nunca.

**Pruebas, en `server/src/scripts/fetchData.test.ts`:**
- historia sin filas con ajustes, sin y con `--force`, ante una descarga con ajustes privados en conflicto:
  mandan los locales, los ajenos se descartan, la procedencia es la de la descarga, la copia apartada
  conserva lo que tenía, y `ledger.db` no cambia ni un byte;
- historia sin filas y sin ajustes;
- historia con filas y ajustes (`--force`);
- descargas que fallan (casi vacía, o con tablas del libro mayor), sin y con `--force`: `history.db` en su
  sitio e idéntica, sin copias ni temporales, y `ledger.db` igual.

## Revisiones en paralelo (data-guardian, una por hallazgo)

Las dos revisiones, en solo lectura, verificaron el hallazgo que les tocaba sobre `91c4c04`. La de la
descarga confirmó además que el arreglo lo cierra. Lo que encontraron en el mismo código se arregló aquí,
cada punto con su prueba que falla antes.

**Exportador:**
- **Concurrencia.** Con pausas deterministas, dos exportaciones a la vez acababan las dos con error y sin
  la exportación anterior. Ya no comparten temporales, y el destino se reemplaza con un `rename`, sin
  borrarlo antes.
- **Destinos que no son una exportación anterior.** Antes se aceptaban; ahora se rechazan:
  - un destino vacío (0 bytes), o ausente, con un `-wal` o `-journal` con contenido al lado. Ejemplo: un
    `ledger.db` a 0 bytes con sus apuestas en el `-wal` perdía el WAL y quedaba reemplazado;
  - una base abierta por otro proceso;
  - una base con meta privada;
  - una copia con fecha de la instalación (`.backup-`, `.sin-filas-`, `.ilegible-`, `.pre-split-`,
    `.antes-de-restaurar-`).
- **Rutas relativas.** Un destino relativo se resolvía desde `server/`, no desde donde se llama a npm
  (`INIT_CWD`, como `restore.ts`). `npm run db:export-history -- data/history.export.db`, el paso del
  workflow de datos, apuntaba a `server/data`.
  - Observación: ese workflow («Datos») lleva fallando desde antes, pero en `verify:data` («timber» lo
    llevan 2 jugadores), un paso anterior a la exportación. Eso es de datos, no de este cambio, y sigue
    pendiente.
- **Restos de exportaciones interrumpidas.** Avisar sin borrar los dejaba para siempre, con meta privada.
  Ahora cada directorio temporal lleva una marca (proceso, máquina, inicio). Se borran solo los de esta
  máquina cuyo proceso ya no existe; los demás (otra en marcha, otra máquina, sin marca) se avisan y no se
  tocan. `mkdtemp` crea el directorio en modo 0700.
- `.dockerignore` excluye `data/*.tmp-*`.

**Descarga:**
- **Historia ilegible.** Una historia que no se puede leer ya no cuenta como «sin filas». Con el código
  anterior se reemplazaba sin `--force`. Con la primera versión del arreglo, fallaba con un error crudo y
  dejaba un fichero vacío. Ahora:
  - sin `--force` no se toca;
  - con `--force` se aparta tal cual (`history.db.ilegible-<fecha>`, byte a byte, con sus laterales) y no
    pasa nada a la nueva.
- **Copias con fecha (`copiaConsistente` de `scripts/datos-estado.mjs`).** Ya no pisan nunca una que
  exista: antes, dos `--force` en el mismo segundo perdían la primera copia. Se escriben en un temporal y
  pasan a su nombre con un enlace, que no reemplaza nada, así que un fallo ya no deja un fichero vacío que
  pase `integrity_check`. El sello lleva milisegundos y proceso.
- **Antes de reemplazar:** si `history.db` apareció durante la descarga (el servidor arrancado en una
  instalación nueva) o alguien la abrió después de la copia, no se toca. Y sobre la copia se vuelve a
  mirar que no haya recibido datos (sin `--force`) ni filas del libro mayor.
- **Temporales propios.** Los temporales de `fetch-data` (`history.db.download`, `.new`) también tenían
  nombre fijo, y cualquier pasada, aunque no hiciera nada, borraba los de otra. Ahora van en un directorio
  propio (`history.db.tmp-XXXXXX`) y se borra solo ese.

**Pendiente** (de las mismas revisiones; de antes y fuera de estos hallazgos):
- `fetch-data --force` pasa `player_ids` de la historia local con `INSERT OR REPLACE`. Si los ids locales
  y los de la release no coinciden, dos jugadores pueden acabar con el mismo id. Necesita su propio
  hallazgo.
- `odds_freshness` se mide en local y no está en `MINE`: un `--force` la pierde.
- El exportador, con un `DATA_DIR` vacío, crea bases vacías y exporta una sin filas, y dice ✓. Eso
  contradice el comentario de `.dockerignore`, según el cual la imagen «fallará en la exportación».
- `backup.ts`:
  - la rotación borra cualquier `ledger-*.db` del directorio de copias, también uno dejado a mano;
  - `ledger.db.restaurando` tiene nombre fijo;
  - no vuelve a mirar si la base se abrió justo antes de reemplazar al restaurar;
  - los `.sin-verificar` viejos se borran.
- `consolidar.ts` pisa nombres fijos dentro de su salida; la protegen las comprobaciones de quien la
  llama.
- `copiaConsistente` de `server/src/db/sqliteSeguro.ts` (la de `backup.ts`) sigue borrando un destino que
  exista; las de `fetch-data` ya no.

## Límites

- Esto no arregla datos: ni la frescura de producción, ni las fuentes atrasadas, ni lo que queda por
  liquidar.
- Una instalación cuya historia sin filas ya se apartó con el código de antes sigue teniendo sus ajustes
  solo en `history.db.sin-filas-*`. Este cambio no los recupera solo. Si aún hacen falta (no están en el
  libro mayor), hay que pasarlos a mano.
