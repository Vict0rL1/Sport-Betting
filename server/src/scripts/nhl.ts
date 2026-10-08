// CLI de la NHL en sombra (Fase 8.1).
//   npm run update-data:nhl -- --desde 2015-10-01 --hasta 2025-06-30   baja los partidos terminados
//   npm run backtest:nhl                                               evalúa el Elo + Poisson sin el holdout
import { ingestarRango } from '../nhl/ingest.ts';
import { evaluarNhl } from '../nhl/evaluacion.ts';

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args[0] === 'ingestar') {
  const desde = opt('desde') ?? '2015-10-01';
  const hasta = opt('hasta') ?? new Date().toISOString().slice(0, 10);
  try {
    const r = await ingestarRango(desde, hasta, fetch, (m) => console.log(m));
    console.log(`NHL: ${r.partidos} partidos terminados guardados en ${r.semanas} semanas (${desde} → ${hasta}).`);
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }
} else {
  const r = evaluarNhl();
  console.log(`\nNHL en sombra · ${r.partidos} partidos, ${r.puntuados} puntuados, ${r.holdoutExcluido} del holdout excluidos.`);
  if (r.modelo) {
    const m = r.modelo;
    const ece = m.ece == null ? '—' : `${(m.ece * 100).toFixed(2)} pp`;
    console.log(`  modelo   log loss ${m.logLoss?.toFixed(4) ?? '—'} · Brier ${m.brier?.toFixed(4) ?? '—'} · ECE ${ece}`);
    for (const x of r.referencias) console.log(`  ${x.nombre.padEnd(36)} log loss ${x.logLoss?.toFixed(4) ?? '—'}`);
    for (const t of r.porTemporada) console.log(`  ${t.temporada}: ${t.n} partidos · log loss ${t.logLoss?.toFixed(4) ?? '—'}`);
  }
  if (r.aviso.texto) console.log(`  ${r.aviso.texto}`);
  console.log(`  ${r.nota}`);
}
