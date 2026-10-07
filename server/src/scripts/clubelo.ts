// `npm run clubelo -- --desde 2019-08-01 [--hasta 2026-10-01] [--cada 7]` — baja el Elo de
// ClubElo una fecha de cada N y lo guarda como baseline externo del walk-forward de fútbol.
// Queda en ingestion_runs como `clubelo`. Ver football/ingest/clubelo.ts.

import { ingestClubElo } from '../football/ingest/clubelo.ts';
import { conRegistro } from '../ingest/runs.ts';
import { getDb } from '../db.ts';

const C = { bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', off: '\x1b[0m' };
const args = process.argv.slice(2);
const valor = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const desde = valor('--desde');
if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
  console.error(`${C.red}✗ Falta --desde YYYY-MM-DD. Ejemplo:  npm run clubelo -- --desde 2019-08-01${C.off}`);
  process.exit(1);
}
getDb();
try {
  const r = await conRegistro('clubelo', async () => {
    const x = await ingestClubElo({ desde, hasta: valor('--hasta'), cadaDias: Number(valor('--cada')) || 7, log: (m) => console.log(m) });
    return { rowsAdded: x.nuevas, detail: `${x.fechas} fechas · ${x.emparejadas} emparejadas · ${x.fallidas.length} fallidas`, ...x };
  });
  const x = r as { fallidas: string[] };
  if (x.fallidas.length) console.log(`${C.amber}⚠ Fechas sin respuesta:${C.off}\n  ${x.fallidas.slice(0, 10).join('\n  ')}${x.fallidas.length > 10 ? `\n  … y ${x.fallidas.length - 10} más` : ''}`);
  console.log(`${C.green}✓${C.off} Listo. El backtest de fútbol (npm run backtest:fb) enseñará «ClubElo» entre los baselines del walk-forward.`);
} catch (e) {
  console.error(`${C.red}✗ ${(e as Error).message}${C.off}`);
  process.exit(1);
}
