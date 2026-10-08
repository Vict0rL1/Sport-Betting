// El informe de los modelos en sombra: campeón contra cada sombra, en los MISMOS partidos
// y con la predicción hecha en el MISMO instante. No promociona nada.
//
//   Δ log loss   sombra − campeón, partido a partido, con su intervalo (validation.ts).
//                Negativo = la sombra acierta mejor.
//   CLV          hipotético: en los partidos donde la sombra veía ventaja ≥ la mínima de la
//                política a la cuota de ese momento, cuota / cierre − 1 (cierre de los
//                snapshots). Lo mismo para el campeón, para comparar.

import { getDb } from '../db.ts';
import { evaluate, type Informe } from '../evaluation/metrics.ts';
import { probarMedia, type Prueba } from '../evaluation/validation.ts';
import { avisoMuestra, type AvisoMuestra } from '../evaluation/sample.ts';
import { RESULTADOS } from '../prematch/evaluation.ts';
import { closingLine } from '../odds/snapshots.ts';
import { DEFAULT_CONFIG } from '../staking/policy.ts';
import { SPORT_IDS, type SportId } from '../sports.ts';

export interface InformeSombra {
  sport: SportId;
  shadowId: string;
  nombre: string;
  n: number;
  sombra: Informe;
  campeon: Informe;
  diferencia: Prueba;
  clv: { sombra: { n: number; media: number | null }; campeon: { n: number; media: number | null } };
  aviso: AvisoMuestra;
}

interface Fila {
  match_key: string;
  shadow_id: string;
  shadow_name: string;
  commence_time: string;
  probs: string;
  champion_probs: string;
  odds: string | null;
  provider_event_id: string | null;
  provider_selections: string | null;
}

const ll3 = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(4)}`;

function clvDe(filas: (Fila & { p: number[] })[]): { n: number; media: number | null } {
  const xs: number[] = [];
  for (const f of filas) {
    if (!f.odds || !f.provider_event_id || !f.provider_selections) continue;
    const odds = JSON.parse(f.odds) as number[];
    const sels = JSON.parse(f.provider_selections) as string[];
    let mejor = -1;
    let ev = DEFAULT_CONFIG.minEdge;
    f.p.forEach((p, k) => {
      if (p * odds[k] - 1 >= ev) { ev = p * odds[k] - 1; mejor = k; }
    });
    if (mejor < 0) continue;
    const cierre = closingLine(f.provider_event_id, 'h2h', sels[mejor], f.commence_time);
    if (cierre) xs.push(odds[mejor] / cierre.consensus - 1);
  }
  return { n: xs.length, media: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null };
}

export function informeSombras(): InformeSombra[] {
  const db = getDb();
  const out: InformeSombra[] = [];
  for (const sport of SPORT_IDS) {
    let res: { k: string; y: number }[] = [];
    try {
      res = db.prepare(RESULTADOS[sport]).all() as { k: string; y: number }[];
    } catch {
      continue;
    }
    const y = new Map(res.map((r) => [r.k, r.y]));
    const filas = db.prepare('SELECT * FROM shadow_predictions WHERE sport = ? ORDER BY predicted_at').all(sport) as unknown as Fila[];
    const porSombra = new Map<string, Fila[]>();
    for (const f of filas) {
      if (!y.has(f.match_key)) continue;
      const xs = porSombra.get(f.shadow_id) ?? [];
      xs.push(f);
      porSombra.set(f.shadow_id, xs);
    }
    for (const [id, xs] of porSombra) {
      const s = xs.map((f) => ({ p: JSON.parse(f.probs) as number[], y: y.get(f.match_key) as number }));
      const c = xs.map((f) => ({ p: JSON.parse(f.champion_probs) as number[], y: y.get(f.match_key) as number }));
      const diffs = s.map((x, i) => -Math.log(Math.max(x.p[x.y], 1e-15)) + Math.log(Math.max(c[i].p[c[i].y], 1e-15)));
      out.push({
        sport,
        shadowId: id,
        nombre: xs[0].shadow_name,
        n: xs.length,
        sombra: evaluate('live', sport, s),
        campeon: evaluate('live', sport, c),
        diferencia: probarMedia(diffs, `¿${xs[0].shadow_name} acierta mejor que el campeón?`, false, ll3),
        clv: {
          sombra: clvDe(xs.map((f, i) => ({ ...f, p: s[i].p }))),
          campeon: clvDe(xs.map((f, i) => ({ ...f, p: c[i].p }))),
        },
        aviso: avisoMuestra(xs.length, 'predicciones'),
      });
    }
  }
  return out;
}
