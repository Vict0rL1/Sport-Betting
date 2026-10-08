// `npm run db:migrate [-- --reintentar]` — abre la base (parte la antigua si hace falta), aplica
// las migraciones pendientes y enseña el estado de cada fichero. Sale con 1 si alguna falló.
//
// `npm run db:export-history <destino>` vive en dbExport.ts; `npm run db:explain` en dbExplain.ts.

import { abrirBase, MIGRACIONES } from '../db.ts';
import { estadoPorVersion, MigracionFallida } from '../db/migrations.ts';
import { ficherosDe, LAYOUT } from '../db/layout.ts';

const reintentar = process.argv.includes('--reintentar');
const C = { bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', off: '\x1b[0m' };

try {
  const db = abrirBase({ reintentar, log: (m) => console.log(m) });
  const f = ficherosDe();
  console.log(`\n${C.bold}Disposición:${C.off} ${LAYOUT} · history: ${f.history}${f.ledger ? ` · ledger: ${f.ledger}` : ''}`);
  for (const [schema, nombre] of LAYOUT === 'split' ? ([['main', 'history'], ['ledger', 'ledger']] as const) : ([['main', 'tennis.db']] as const)) {
    const estado = estadoPorVersion(db, schema);
    console.log(`\n${C.bold}${nombre}${C.off}`);
    for (const m of MIGRACIONES) {
      if (LAYOUT === 'split' && m.destino !== 'ambos' && m.destino !== (nombre === 'history' ? 'history' : 'ledger')) continue;
      const e = estado.get(m.version);
      const marca = e?.estado === 'ok' ? `${C.green}✓${C.off}` : e?.estado === 'failed' ? `${C.red}✗${C.off}` : `${C.dim}·${C.off}`;
      console.log(`${marca} v${m.version} ${m.nombre}${e ? ` ${C.dim}(${e.applied_at})${C.off}` : ''}${e?.error ? ` — ${e.error}` : ''}`);
    }
  }
  console.log(`\n${C.green}Base al día.${C.off}`);
} catch (e) {
  console.error(`\n${C.red}${e instanceof MigracionFallida ? e.message : (e as Error).message}${C.off}`);
  process.exit(1);
}
