// npm run model:report — MODEL HEALTH REPORT: el estado de cada modelo, con sus motivos.
//
// Reglas del estado (a la vista, no ajustadas):
//   Warning   · deriva en vivo (las últimas 100 resueltas, más de 2 errores típicos peor
//               que el backtest: trust/drift.ts), o
//             · calibración en vivo con ECE > 5 pp sobre ≥ 100 partidos, o
//             · el mercado le gana al modelo en vivo con intervalo (validation.ts), o
//             · en los 3 últimos periodos del walk-forward, la ventaja del modelo sobre el
//               Elo básico (mismos partidos) cae más de 0,01 de log loss respecto al conjunto.
//   Sin datos en vivo   menos de 100 predicciones resueltas: el estado sale solo del
//                       histórico y se dice.
//   Healthy   nada de lo anterior.

import { evaluacionEnVivo } from '../evaluation/live.ts';
import { validacionEnVivo } from '../evaluation/validation.ts';
import { leerMetricasBacktest } from '../evaluation/report.ts';
import { leerWalkForward } from '../evaluation/walkforward.ts';
import { derivaReciente } from '../trust/drift.ts';
import { SPORT_IDS } from '../sports.ts';

export interface SaludModelo {
  sport: string;
  estado: 'Healthy' | 'Warning' | 'Sin datos en vivo';
  motivos: string[];
  lineas: string[];
}

const f = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(3));

export function saludModelos(): SaludModelo[] {
  const bt = leerMetricasBacktest();
  const vivo = new Map(evaluacionEnVivo().map((x) => [x.deporte, x]));
  const val = validacionEnVivo();
  return SPORT_IDS.map((sport) => {
    const b = bt[sport];
    const v = vivo.get(sport);
    const d = derivaReciente(sport);
    const w = leerWalkForward(sport);
    const motivos: string[] = [];
    if (d.deriva) motivos.push(`Deriva reciente: ${d.texto}`);
    if (v && v.n >= 100 && v.ece != null && v.ece > 0.05) motivos.push(`Calibración en vivo deteriorada: ECE ${(v.ece * 100).toFixed(1)} pp sobre ${v.n} partidos`);
    const mm = val.modeloVsMercado[sport];
    if (mm?.veredicto === 'en contra') motivos.push(`El mercado le gana al modelo en vivo: ${mm.lectura}`);
    // Deterioro RELATIVO: la ventaja del modelo sobre el Elo básico en los mismos partidos.
    // El log loss bruto sube en periodos más difíciles para cualquiera; la ventaja sobre el
    // baseline solo baja si es el modelo el que empeora.
    if (w && w.periodos.length >= 6) {
      const ventaja = (ps: typeof w.periodos) => {
        const xs = ps.filter((p) => p.baselines['Elo básico']?.logLoss != null && p.modelo.logLoss != null);
        const n = xs.reduce((a, p) => a + p.n, 0);
        return { n, v: n ? xs.reduce((a, p) => a + ((p.baselines['Elo básico'].logLoss as number) - (p.modelo.logLoss as number)) * p.n, 0) / n : null };
      };
      const ult = ventaja(w.periodos.slice(-3));
      const todo = ventaja(w.periodos);
      if (ult.v != null && todo.v != null && ult.n >= 300 && todo.v - ult.v > 0.01) {
        motivos.push(`Deterioro reciente en el histórico: la ventaja sobre el Elo básico baja de ${todo.v.toFixed(3)} a ${ult.v.toFixed(3)} de log loss en los 3 últimos periodos`);
      }
    }
    const estado: SaludModelo['estado'] = motivos.length ? 'Warning' : (v?.n ?? 0) < 100 ? 'Sin datos en vivo' : 'Healthy';
    const lineas = [
      `Predictions: ${b?.n ?? '—'} (backtest) · ${v?.n ?? 0} en vivo con resultado`,
      `Brier: ${f(b?.brier)} (backtest) · Live Brier: ${f(v?.brier)}`,
      `Log loss: ${f(b?.logLoss)} (backtest) · Live log loss: ${f(v?.logLoss)}`,
      `Drift: ${d.deriva ? 'SÍ' : d.logLossReciente == null ? 'sin muestra' : 'none'}`,
    ];
    if (w?.resumen['Mercado (cierre)']) {
      const m = w.resumen['Mercado (cierre)'];
      lineas.push(`Contra el cierre en el histórico: modelo ${m.ganaModelo} · mercado ${m.ganaRival} de ${m.periodos} periodos`);
    }
    return { sport, estado, motivos, lineas };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('MODEL HEALTH REPORT');
  console.log(`generado ${new Date().toISOString()}\n`);
  for (const s of saludModelos()) {
    console.log(s.sport.toUpperCase());
    console.log(`Status: ${s.estado}`);
    for (const l of s.lineas) console.log(l);
    if (s.motivos.length) {
      console.log('Reason:');
      for (const m of s.motivos) console.log(`  ${m}`);
    } else if (s.estado === 'Sin datos en vivo') {
      console.log('Reason:\n  Menos de 100 predicciones en vivo resueltas: el estado solo se puede juzgar con el histórico.');
    }
    console.log('');
  }
}
