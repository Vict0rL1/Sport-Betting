// Modelos en sombra: alternativas que predicen a la vez que el campeón, se guardan, y se
// evalúan con partidos FUTUROS. No apuestan, no mueven el banco, no salen como
// recomendación, y nada los promociona solo: el informe (npm run shadow:report) compara, y
// la decisión de cambiar de campeón es de una persona, con un experimento registrado.
//
// ===========================================================================
// QUÉ SOMBRAS, Y POR QUÉ ESTAS
// ===========================================================================
// No se inventan modelos para tener sombras. Son los componentes que el propio modelo ya
// calcula y que plantean una pregunta real: ¿aporta la complejidad del campeón algo, en
// partidos que todavía no se habían jugado cuando se diseñó?
//
//   tenis      Elo general (sin superficie, forma ni H2H) · Elo de superficie
//   fútbol     Elo con el empate del modelo · Dixon-Coles crudo (sin calibrar)
//   MLB        Elo de equipos (sin abridores)
//   NFL        modelo sin QB · modelo crudo (sin la mezcla con el mercado)
//   todos      ensemble: el registrado en experiments/ensembles.json, si lo hay
//
// La predicción de cada sombra se guarda la PRIMERA vez que se sirve el partido, en el
// mismo instante que la del campeón: así la comparación es emparejada y sin ventaja de
// información para nadie.

import { getDb } from '../db.ts';
import { versionsFor } from '../versions.ts';
import type { EventoConfianza } from '../trust/types.ts';
import { combinarConEnsemble, idEstable } from './ensemble.ts';

export { SHADOW_SCHEMA } from './schema.ts';

/** Identificador estable a partir del nombre del componente (el mismo que usa el ensemble). */
export const idDe = idEstable;

/** Las sombras de un partido: componentes que no son el campeón, más el ensemble. */
export function sombrasDe(e: EventoConfianza): { id: string; nombre: string; probs: number[] }[] {
  const campeon = (n: string) => /completo|publicada|con abridores/i.test(n);
  const out = e.componentes.filter((c) => !campeon(c.nombre)).map((c) => ({ id: idDe(c.nombre), nombre: c.nombre, probs: c.probs }));
  const ens = combinarConEnsemble(e);
  if (ens) out.push({ id: 'ensemble', nombre: ens.nombre, probs: ens.probs });
  return out;
}

/** Guarda las sombras la primera vez que se sirve el partido. Nunca lanza. */
export function registrarSombras(e: EventoConfianza, now = new Date()): number {
  if (e.demo || Date.parse(e.commence) <= now.getTime()) return 0;
  try {
    const ins = getDb().prepare(
      `INSERT OR IGNORE INTO shadow_predictions (sport, match_key, shadow_id, shadow_name, commence_time, predicted_at, probs, champion_probs, odds,
         provider_event_id, provider_selections, champion_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let n = 0;
    for (const s of sombrasDe(e)) {
      n += Number(
        ins.run(e.sport, e.matchKey, s.id, s.nombre, e.commence, now.toISOString(), JSON.stringify(s.probs), JSON.stringify(e.probs),
          e.odds ? JSON.stringify(e.odds) : null, e.providerEventId, e.providerSelections ? JSON.stringify(e.providerSelections) : null,
          versionsFor(e.sport).model_version).changes,
      );
    }
    return n;
  } catch {
    return 0;
  }
}
