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

**Pruebas, en `server/src/scripts/exportPrivado.test.ts`.** Ficheros ajenos con los nombres de antes (una
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

## Límites

- Esto no arregla datos: ni la frescura de producción, ni las fuentes atrasadas, ni lo que queda por
  liquidar.
- Una instalación cuya historia sin filas ya se apartó con el código de antes sigue teniendo sus ajustes
  solo en `history.db.sin-filas-*`. Este cambio no los recupera solo. Si aún hacen falta (no están en el
  libro mayor), hay que pasarlos a mano.
