// `node scripts/regresion-backtests.mjs <referencia.json> <actual.json>` — compara el log
// loss de cada modelo publicado con la referencia y sale con 1 si alguno empeora más que su
// tolerancia (experiments/tolerancias.json). Mejorar nunca falla; un deporte sin referencia se
// anota y no falla.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [refPath, actPath] = process.argv.slice(2);
if (!refPath || !actPath) {
  console.error('Uso: node scripts/regresion-backtests.mjs <referencia.json> <actual.json>');
  process.exit(2);
}
const leer = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const ref = leer(refPath);
const act = leer(actPath);
const tol = leer(path.join(ROOT, 'experiments', 'tolerancias.json'));

let fallos = 0;
for (const [sport, a] of Object.entries(act)) {
  const r = ref[sport];
  const t = tol[sport] ?? tol.porDefecto ?? 0.005;
  if (!r || r.logLoss == null || a.logLoss == null) {
    console.log(`· ${sport}: sin referencia comparable (ref ${r?.logLoss ?? '—'}, actual ${a.logLoss ?? '—'})`);
    continue;
  }
  const delta = a.logLoss - r.logLoss;
  const peor = delta > t;
  console.log(`${peor ? '✗' : '✓'} ${sport.padEnd(11)} log loss ${r.logLoss.toFixed(4)} → ${a.logLoss.toFixed(4)} (${delta >= 0 ? '+' : ''}${delta.toFixed(4)}, tolerancia +${t}) n=${a.n}`);
  if (peor) fallos++;
}
if (fallos) {
  console.error(`\n${fallos} modelo(s) empeoran más que su tolerancia. Mira qué cambió (datos nuevos, holdout, parámetros) antes de publicar.`);
  process.exit(1);
}
console.log('\nSin regresiones.');
