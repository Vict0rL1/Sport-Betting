// `npm run db:explain` — el plan de las consultas más calientes, para ver que van por índice.

import { getDb } from '../db.ts';
import { CONSULTAS_CALIENTES, planDe } from '../db/hot.ts';

const db = getDb();
for (const c of CONSULTAS_CALIENTES) {
  console.log(`\n▸ ${c.nombre}`);
  for (const p of planDe(db, c.sql)) console.log(`  ${/SCAN/.test(p.detail) && !/USING/.test(p.detail) ? '✗' : '✓'} ${p.detail}`);
}
console.log('');
