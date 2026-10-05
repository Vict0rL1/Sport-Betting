// El ciclo pre-partido: predecir todos los próximos (registro, instantánea y evaluación de
// confianza) y congelar la final de lo que ya empezó. Lo llama el servidor cada 15 minutos
// y, además, justo ANTES de apostar: la abstención necesita una evaluación hecha con las
// mismas cuotas que se van a apostar (ver paper/bankroll.ts).

import { predecirProximosTenis } from '../routes/api.ts';
import { predecirProximosFutbol } from '../routes/football.ts';
import { predecirProximosBaloncesto } from '../routes/basketball.ts';
import { predecirProximosBeisbol } from '../routes/baseball.ts';
import { predecirProximosNfl } from '../routes/nfl.ts';
import { freezeFinals } from './snapshots.ts';

export function cicloPrePartido(log: (m: string) => void = () => {}): { congeladas: number } {
  for (const [nombre, f] of [
    ['tenis', predecirProximosTenis], ['fútbol', predecirProximosFutbol], ['baloncesto', predecirProximosBaloncesto],
    ['béisbol', predecirProximosBeisbol], ['NFL', predecirProximosNfl],
  ] as const) {
    try {
      f();
    } catch (e) {
      log(`Pre-partido (${nombre}): ${(e as Error).message}`);
    }
  }
  const r = freezeFinals();
  if (r.congeladas) log(`Pre-partido: ${r.congeladas} predicción(es) final(es) congelada(s).`);
  return r;
}
