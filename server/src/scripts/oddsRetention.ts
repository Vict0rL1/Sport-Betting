// `npm run odds:retention -- --dias N [--confirmar]` — adelgaza los snapshots de cuotas de
// más de N días conservando apertura, T-24h, T-6h, T-1h y cierre por casa y selección, y
// exportando TODO lo que quita a data/archive/*.jsonl.gz antes de borrarlo. Nunca corre sola.
// Ver odds/retention.ts para la regla y la tensión que resuelve.

import { aplicar, planificar } from '../odds/retention.ts';
import { conRegistro } from '../ingest/runs.ts';

const C = { bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', off: '\x1b[0m' };
const args = process.argv.slice(2);
const diasArg = args[args.indexOf('--dias') + 1];
const dias = args.includes('--dias') ? Number(diasArg) : NaN;
const confirmar = args.includes('--confirmar');

if (!Number.isFinite(dias)) {
  console.error(`${C.red}✗ Falta --dias N (N ≥ 7). Ejemplo:  npm run odds:retention -- --dias 90${C.off}`);
  process.exit(1);
}

try {
  const plan = planificar(dias);
  console.log(`${C.bold}Snapshots anteriores a ${plan.limite.slice(0, 10)}${C.off} (${dias} días vivos)`);
  console.log(`  ${plan.antiguas} filas antiguas · ${C.green}${plan.conservar.length} se conservan${C.off} (apertura, T-24h, T-6h, T-1h, cierre, última) · ${C.amber}${plan.borrar.length} se archivarían y borrarían${C.off}`);
  if (plan.borrar.length === 0) {
    console.log(`${C.dim}Nada que hacer.${C.off}`);
    process.exit(0);
  }
  if (!confirmar) {
    console.log(`\n${C.dim}Solo el plan. Para aplicarlo (exporta antes de borrar):  npm run odds:retention -- --dias ${dias} --confirmar${C.off}`);
    process.exit(0);
  }
  const r = await conRegistro('odds:retention', () => {
    const x = aplicar(plan, { confirmar: true });
    return { rowsUpdated: x.borradas, detail: x.archivo ?? undefined, archivo: x.archivo };
  });
  console.log(`${C.green}✓${C.off} ${(r as { rowsUpdated: number }).rowsUpdated} filas archivadas en ${(r as { archivo: string }).archivo} y borradas. El trigger de no-borrado está otra vez.`);
} catch (e) {
  console.error(`${C.red}✗ ${(e as Error).message}${C.off}`);
  process.exit(1);
}
