// `npm run copia:consolidar -- <carpeta> [--salida <carpeta>]` — de una copia de carpeta (ledger.db
// e history.db con sus `-wal`) a copias autónomas comprobadas. Ver db/consolidar.ts.
//
// No abre la base de la app (ni DATA_DIR ni BACKUP_DIR): solo la carpeta que se le pasa, y esa no
// la toca. Escribe en --salida (por defecto ~/copia-consolidada-<fecha>, fuera del repositorio) y deja allí también la
// carpeta de trabajo con lo que contó, y un informe.json con todo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comprobarSalidaFueraDelRepo, consolidarCopia } from '../db/consolidar.ts';

const C = { bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', off: '\x1b[0m' };
const args = process.argv.slice(2);
// `npm run --workspace` ejecuta desde server/: las rutas relativas son de donde se lanzó npm.
const desde = process.env.INIT_CWD ?? process.cwd();
const arg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--salida');
const origen = arg ? path.resolve(desde, arg) : null;
const iSalida = args.indexOf('--salida');
const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// Por defecto en la carpeta personal: lleva libros mayores enteros y no puede acabar en un commit.
const salida = iSalida >= 0 ? path.resolve(desde, args[iSalida + 1]) : path.join(os.homedir(), `copia-consolidada-${sello}`);

if (!origen) {
  console.log(`Uso: ${C.bold}npm run copia:consolidar -- <carpeta-de-la-copia> [--salida <carpeta>]${C.off}`);
  process.exit(1);
}

try {
  if (fs.existsSync(salida) && fs.readdirSync(salida).length) throw new Error(`${salida} ya existe y no está vacía: elige otra --salida`);
  comprobarSalidaFueraDelRepo(salida);
  const r = consolidarCopia(origen, salida, path.join(salida, 'trabajo'));
  fs.writeFileSync(path.join(salida, 'informe.json'), JSON.stringify(r, null, 1));
  let mal = !r.origenIntacto;
  console.log(`${C.bold}Copia: ${origen}${C.off}`);
  console.log(r.origenIntacto ? `${C.green}✓${C.off} El original no se ha tocado (mismos SHA-256 antes y después)` : `${C.red}✗ ¡El original cambió durante la consolidación!${C.off}`);
  for (const b of r.bases) {
    console.log(`\n${C.bold}${b.base}${C.off} ${C.dim}${b.wal ? `-wal: ${b.wal.bytes} bytes, ${b.wal.marcos} marcos` : 'sin -wal'}${C.off}`);
    if (b.soloBaseError) console.log(`  ${C.amber}⚠${C.off} El fichero principal solo no se deja leer (${b.soloBaseError}): restaurarlo sin su -wal no serviría`);
    else if (b.diferencias.length === 0) console.log(`  ${C.green}✓${C.off} Solo el fichero principal y con su -wal dan las mismas filas`);
    else {
      const total = b.diferencias.reduce((a, d) => a + ((d.conWal ?? 0) - (d.soloBase ?? 0)), 0);
      console.log(`  ${C.amber}⚠${C.off} Restaurar solo el fichero principal perdería ${total} fila(s):`);
      for (const d of b.diferencias) console.log(`    ${d.tabla}: ${d.soloBase ?? '—'} sin -wal, ${d.conWal ?? '—'} con -wal`);
    }
    const ok = b.integridad === 'ok' && b.verificacion.length === 0;
    if (!ok) mal = true;
    console.log(
      ok
        ? `  ${C.green}✓${C.off} ${b.salida} ${C.dim}(integrity_check ok; su manifiesto es el de la vista con -wal: ${Object.keys(b.manifiesto.tablas).length} tablas)${C.off}`
        : `  ${C.red}✗ ${b.salida}: integrity_check ${b.integridad}; tablas distintas: ${b.verificacion.map((v) => v.tabla).join(', ') || '—'}${C.off}`,
    );
  }
  console.log(`\n${C.dim}Informe completo: ${path.join(salida, 'informe.json')}${C.off}`);
  process.exit(mal ? 1 : 0);
} catch (e) {
  console.error(`${C.red}✗ ${(e as Error).message}${C.off}`);
  process.exit(1);
}
