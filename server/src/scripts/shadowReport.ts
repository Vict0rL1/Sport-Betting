// npm run shadow:report — campeón contra modelos en sombra, con partidos ya jugados.
// Compara y nada más: ninguna sombra se promociona sola.

import { informeSombras } from '../shadow/evaluation.ts';
import { leerEnsembles } from '../shadow/ensemble.ts';

const f4 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(4));
const pc = (x: number | null) => (x == null ? '—' : `${(x * 100).toFixed(1)} %`);

const xs = informeSombras();
console.log('MODELOS EN SOMBRA (en vivo, mismos partidos, mismo instante que el campeón)\n');
if (!xs.length) console.log('Todavía no hay sombras con partidos resueltos: se registran al servir cada partido real.\n');
for (const r of xs) {
  console.log(`${r.sport.toUpperCase()} · ${r.nombre}`);
  console.log(`  N = ${r.n}`);
  console.log(`  Campeón  Brier ${f4(r.campeon.brier)} · log loss ${f4(r.campeon.logLoss)} · CLV ${pc(r.clv.campeon.media)} (${r.clv.campeon.n})`);
  console.log(`  Sombra   Brier ${f4(r.sombra.brier)} · log loss ${f4(r.sombra.logLoss)} · CLV ${pc(r.clv.sombra.media)} (${r.clv.sombra.n})`);
  console.log(`  Δ log loss: ${r.diferencia.veredicto} — ${r.diferencia.lectura}`);
  if (r.aviso.texto) console.log(`  ${r.aviso.texto}`);
  console.log('');
}
const ens = leerEnsembles();
console.log('ENSEMBLES REGISTRADOS (validación walk-forward en backtest; corren como sombra)');
for (const [sport, e] of Object.entries(ens)) {
  if (!e) continue;
  console.log(`  ${sport}: componentes ${e.componentes.join(', ')} · mejor fuera de muestra: ${e.mejor}`);
  for (const [m, v] of Object.entries(e.metodos)) {
    console.log(`    ${m.padEnd(17)} log loss ${f4(v.validacion.logLoss)} (campeón ${f4(v.validacion.logLossCampeon)}, n ${v.validacion.n}) · pesos ${v.parametros.map((p) => p.toFixed(3)).join(' / ')}`);
  }
}
console.log('\nNinguna sombra sustituye al campeón sin un experimento registrado (npm run experiments).');
