// `npm run bullpen` — baja los boxscores de los últimos tres días de la MLB y guarda la carga
// del bullpen de cada equipo. El servidor lo hace solo cada 12 h (features.json: fuentes.bullpen).

import { ingestBullpen } from '../baseball/ingest/bullpen.ts';
import { conRegistro } from '../ingest/runs.ts';
import { getDb } from '../db.ts';

const C = { red: '\x1b[31m', green: '\x1b[32m', off: '\x1b[0m' };
getDb();
try {
  const r = await conRegistro('bullpen', async () => {
    const x = await ingestBullpen();
    return { rowsAdded: x.relevistas, detail: `${x.partidos} partidos · ${x.equipos} equipos · al día ${x.asOf}`, ...x };
  });
  const x = r as { partidos: number; equipos: number; relevistas: number };
  console.log(`${C.green}✓${C.off} ${x.partidos} boxscores · ${x.equipos} equipos · ${x.relevistas} relevistas con carga registrada.`);
} catch (e) {
  console.error(`${C.red}✗ ${(e as Error).message}${C.off}`);
  process.exit(1);
}
