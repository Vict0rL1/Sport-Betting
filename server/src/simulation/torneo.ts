// Simulación de cuadro de tenis (Fase 4.7).
//
// `simularCuadro` juega un cuadro de eliminación directa muchas veces con una función de
// probabilidad entre dos jugadores: probabilidad de alcanzar cada ronda y de ganar el
// torneo. Es determinista con la semilla. Lo que NO hay es una fuente de cuadros: ninguna
// de las descargas trae el emparejamiento del torneo, así que la API lo dice
// (`cuadroDisponible: false`) y devuelve, en su lugar, el siguiente partido conocido de cada
// jugador con su probabilidad publicada. Nada se inventa: sin cuadro no hay «probabilidad
// de ganar el torneo».

import { getDb } from '../db.ts';
import { rng } from './rng.ts';
import { configSimulacion } from './season.ts';

export interface Cuadro {
  /** Jugadores en orden de cuadro (potencia de 2; `null` = bye). */
  jugadores: (string | null)[];
}

export interface JugadorSimulado {
  id: string;
  /** Probabilidad de alcanzar cada ronda: índice 0 = segunda ronda, …, último = campeón. */
  rondas: number[];
  campeon: number;
}

export const RONDAS = ['segunda ronda', 'tercera ronda', 'octavos', 'cuartos', 'semifinal', 'final', 'campeón'];

/** Nombres de las rondas de un cuadro de `n` jugadores, de la primera eliminatoria al título. */
export function nombresRondas(n: number): string[] {
  const total = Math.log2(n);
  const fin = ['campeón', 'final', 'semifinal', 'cuartos', 'octavos'];
  const out: string[] = [];
  for (let r = 1; r <= total; r++) {
    const desdeElFinal = total - r;
    out.push(desdeElFinal < fin.length ? fin[desdeElFinal] : `ronda ${r + 1}`);
  }
  return out;
}

export function simularCuadro(cuadro: Cuadro, prob: (a: string, b: string) => number, semilla: number, corridas = 10_000): JugadorSimulado[] {
  const n = cuadro.jugadores.length;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`cuadro de ${n}: tiene que ser potencia de 2`);
  const total = Math.log2(n);
  const ids = cuadro.jugadores.filter((j): j is string => !!j);
  const alcanza = new Map(ids.map((id) => [id, new Float64Array(total)]));
  const random = rng(semilla);
  for (let r = 0; r < corridas; r++) {
    let vivos = [...cuadro.jugadores];
    for (let ronda = 0; ronda < total; ronda++) {
      const siguiente: (string | null)[] = [];
      for (let i = 0; i < vivos.length; i += 2) {
        const a = vivos[i];
        const b = vivos[i + 1];
        const gana = a && b ? (random() < prob(a, b) ? a : b) : (a ?? b);
        siguiente.push(gana);
        if (gana) (alcanza.get(gana) as Float64Array)[ronda] += 1;
      }
      vivos = siguiente;
    }
  }
  return ids.map((id) => {
    const v = alcanza.get(id) as Float64Array;
    return { id, rondas: Array.from(v, (x) => x / corridas), campeon: v[total - 1] / corridas };
  });
}

export interface SiguientePartido {
  torneo: string | null;
  superficie: string | null;
  cuando: string;
  p1: string;
  p2: string;
  /** Probabilidad publicada del primero, si está registrada. */
  prob1: number | null;
}

export interface TorneoTenis {
  cuadroDisponible: false;
  motivo: string;
  etiqueta: string;
  semilla: number;
  siguientes: SiguientePartido[];
}

export function torneoTenis(ahora = new Date()): TorneoTenis {
  let siguientes: SiguientePartido[] = [];
  try {
    siguientes = getDb()
      .prepare(
        `SELECT u.tournament_name AS torneo, u.surface AS superficie, u.commence_time AS cuando, u.p1_name AS p1, u.p2_name AS p2, l.prob1
           FROM upcoming_matches u LEFT JOIN prediction_log l ON l.upcoming_id = u.id
          WHERE u.commence_time > ? AND u.source <> 'fixture' ORDER BY u.commence_time LIMIT 200`,
      )
      .all(ahora.toISOString()) as unknown as SiguientePartido[];
  } catch {
    siguientes = [];
  }
  return {
    cuadroDisponible: false,
    motivo: 'Ninguna fuente descargada trae el cuadro del torneo (solo los próximos partidos): sin cuadro no se puede decir quién gana el torneo. Se enseña el siguiente partido conocido de cada jugador con su probabilidad publicada.',
    etiqueta: 'Sin cuadro no hay simulación: nada de lo que sigue es una probabilidad de ganar el torneo.',
    semilla: configSimulacion().semilla,
    siguientes,
  };
}
