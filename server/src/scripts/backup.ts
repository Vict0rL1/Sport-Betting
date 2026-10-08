// `npm run backup` — una copia del libro mayor (ledger.db) ahora mismo: apuestas, predicciones
// registradas, precios observados. Local en BACKUP_DIR (data/backups) y, si hay BACKUP_S3_*,
// también en el almacén. La historia no se copia: se vuelve a bajar o a reconstruir.

import { copiasLocales, directorioCopias, hacerCopia } from '../db/backup.ts';
import { configS3 } from '../db/s3.ts';
import { conRegistro } from '../ingest/runs.ts';

const C = { bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', off: '\x1b[0m' };

try {
  const c = await conRegistro('backup', async () => {
    const copia = await hacerCopia();
    return { rowsAdded: 1, detail: `${copia.fichero} · ${(copia.bytes / 1048576).toFixed(1)} MB${copia.s3 ? (copia.s3.subido ? ' · S3 ok' : ` · S3 falló: ${copia.s3.error}`) : ''}`, copia };
  });
  const { copia } = c as { copia: Awaited<ReturnType<typeof hacerCopia>> };
  console.log(`${C.green}✓${C.off} ${copia.fichero} ${C.dim}(${(copia.bytes / 1048576).toFixed(1)} MB, integridad ${copia.integridad})${C.off}`);
  if (copia.s3) console.log(copia.s3.subido ? `${C.green}✓${C.off} Subida a ${copia.s3.destino}` : `${C.amber}⚠${C.off} La subida a S3 falló: ${copia.s3.error} (la copia local está bien)`);
  else if (!configS3()) console.log(`${C.dim}· Sin BACKUP_S3_* en el entorno: solo copia local. Para tener una fuera de esta máquina, rellena esas variables (.env.example).${C.off}`);
  if (copia.borradas.length) console.log(`${C.dim}· Rotación: ${copia.borradas.length} copia(s) antigua(s) borrada(s)${C.off}`);
  console.log(`${C.dim}· ${copiasLocales().length} copia(s) en ${directorioCopias()}${C.off}`);
} catch (e) {
  console.error(`${C.red}✗ ${(e as Error).message}${C.off}`);
  process.exit(1);
}
