// Sugerencia de stake para el registro personal (Fase 5.16): la MISMA política Kelly del
// banco de papel (fracción y tope por partido), sobre el banco personal de Ajustes. Solo
// sugiere: nunca coloca nada.

import { fractionalKelly } from '../staking/kelly.ts';
import { politica } from '../staking/policyStore.ts';
import { leerAjustes } from '../ajustes/index.ts';

export interface Sugerencia {
  prob: number;
  odds: number;
  ventaja: number;
  fraccionKelly: number;
  /** Fracción del banco, ya con el tope por partido. */
  fraccion: number;
  bancoPersonal: number | null;
  /** Importe sugerido, si hay banco personal. */
  importe: number | null;
  tope: number;
  nota: string;
}

export function sugerenciaStake(prob: number, odds: number): Sugerencia {
  const p = politica().staking;
  const ventaja = prob * odds - 1;
  const kelly = ventaja > 0 ? fractionalKelly(prob, odds, p.kellyFraction) : 0;
  const fraccion = Math.min(p.maxPerEvent, Math.max(0, kelly));
  const banco = leerAjustes().bancoPersonal;
  return {
    prob,
    odds,
    ventaja,
    fraccionKelly: p.kellyFraction,
    fraccion,
    bancoPersonal: banco,
    importe: banco != null ? Math.round(fraccion * banco * 100) / 100 : null,
    tope: p.maxPerEvent,
    nota: ventaja <= 0 ? 'Sin ventaja a esa cuota: la política no apostaría.' : `Kelly × ${p.kellyFraction} con tope del ${(p.maxPerEvent * 100).toFixed(0)} % por partido. Es una sugerencia con la probabilidad que le des; nada se coloca solo.`,
  };
}
