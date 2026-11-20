// Un club que openfootball partió en dos ids entre temporadas, vuelto a unir.
//
// openfootball cambia a veces cómo escribe a un club de una temporada a otra («Bayer Leverkusen» en
// 2019-20, «Bayer 04 Leverkusen» después; «SL Benfica» hasta 2022-23, «Sport Lisboa e Benfica» desde
// 2023-24), y `clubId` (openfootball.ts) solo une nombres que normalizados son iguales: cada grafía era
// un id, y para el modelo, dos equipos con el Elo reiniciado. Con los datos reales, 24 clubes en 7 ligas
// (docs/plans/nocturno-datos.md, hallazgo A).
//
// Dos ids de una liga son el mismo club si se cumple todo esto:
// - nunca coinciden en una temporada (dos clubes de la misma temporada son dos clubes: Paris FC y el PSG);
// - uno va después del otro;
// - los nombres encajan: las palabras de uno están en el otro, sin contar números («04», «1901», «'65»),
//   o una palabra es la sigla de varias seguidas del otro («SL» = «Sport Lisboa», «CP» = «Clube de
//   Portugal»);
// - si hay temporadas de hueco entre los dos (el club salió de la liga y volvió), el nombre nuevo
//   contiene entero al viejo: «SC Cambuur» → «SC Cambuur-Leeuwarden» sí, pero «Chievo Verona» (hasta
//   2021) → «Verona» (2027, el Hellas) no;
// - ninguno es el filial del otro: una marca de filial («B», «II», «Castilla», «Jong», «U23»…) en un
//   nombre y no en el otro descarta la pareja («Villarreal CF B» no es «Villarreal CF»; «Willem II» sí es
//   «Willem II Tilburg», porque los dos llevan «II») (revisión data-guardian);
// - y es la única pareja posible de cada uno de los dos. Si hay dudas, no se une nada.
//
// Se queda el id MÁS RECIENTE: es el que usan los partidos de ahora, las predicciones y el libro mayor,
// así que nada vivo cambia de id. Las filas del viejo pasan al nuevo en las tablas de la historia (nunca
// en el libro mayor), y el nombre viejo queda como alias: una nueva ingesta de esa temporada cae en el
// mismo club y no lo vuelve a partir.

import { getDb } from '../../db.ts';
import { TABLAS_LEDGER } from '../../db/tables.ts';
import { normalizeTeamName } from './teamNames.ts';

export interface Fusion {
  league: string;
  viejo: string;
  nuevo: string;
  nombreViejo: string;
  nombreNuevo: string;
  /** Temporadas fuera de la liga entre el último partido del viejo y el primero del nuevo. */
  hueco: number;
}

/** Tablas de la HISTORIA con ids de equipo de fútbol. El libro mayor (fb_prediction_log…) no está, ni puede estar. */
const TABLAS: { tabla: string; columnas: string[]; filtro?: string }[] = [
  { tabla: 'fb_matches', columnas: ['home_id', 'away_id'] },
  { tabla: 'fb_upcoming', columnas: ['home_id', 'away_id'] },
  { tabla: 'fb_players', columnas: ['team_id'] },
  { tabla: 'fb_news', columnas: ['team_id'] },
  { tabla: 'fb_lineups', columnas: ['team_id'] },
  { tabla: 'fb_external_elo', columnas: ['team_id'] },
  { tabla: 'fb_team_aliases', columnas: ['team_id'] },
  { tabla: 'remaining_fixtures', columnas: ['home_id', 'away_id'], filtro: "sport = 'football'" },
];
for (const { tabla } of TABLAS) if (TABLAS_LEDGER.includes(tabla)) throw new Error(`${tabla} es del libro mayor: no se reescribe`);

const palabras = (n: string) => normalizeTeamName(n).split(' ').filter((t) => t && !/^\d+$/.test(t));

/** Lo que distingue a un filial o a otro equipo del mismo club. */
const FILIAL = new Set(['b', 'c', 'ii', 'iii', 'jong', 'castilla', 'reserve', 'reserves', 'amateure', 'futuro', 'atletic', 'atletico', 'primavera', 'next', 'gen', 'women', 'femenino', 'frauen']);
const esFilial = (t: string) => FILIAL.has(t) || /^u\d{2}$/.test(t);
/** ¿Una marca de filial en un nombre y no en el otro? */
const unoEsFilial = (a: string[], b: string[]) => a.some((t) => esFilial(t) && !b.includes(t)) || b.some((t) => esFilial(t) && !a.includes(t));

/** ¿Cada palabra de `corto` está en `largo`, o es la sigla de dos o más palabras seguidas de `largo`? */
function encaja(corto: string[], largo: string[]): boolean {
  if (!corto.length) return false;
  return corto.every((t) => {
    if (largo.includes(t)) return true;
    for (let i = 0; i < largo.length; i++) {
      for (let j = i + 2; j <= largo.length; j++) {
        if (largo.slice(i, j).map((x) => x[0]).join('') === t) return true;
      }
    }
    return false;
  });
}

/** Las parejas de ids de la liga que son el mismo club (sin tocar nada). */
export function clubesPartidos(league: string): Fusion[] {
  const filas = getDb()
    .prepare(
      `SELECT t.id, t.name, GROUP_CONCAT(DISTINCT m.season) AS temporadas
         FROM fb_teams t
         JOIN fb_matches m ON m.league = t.league AND (m.home_id = t.id OR m.away_id = t.id)
        WHERE t.league = ?
        GROUP BY t.id`,
    )
    .all(league) as unknown as { id: string; name: string; temporadas: string }[];
  const clubes = filas.map((f) => {
    const temporadas = f.temporadas.split(',').map(Number).sort((a, b) => a - b);
    return { ...f, temporadas, primera: temporadas[0], ultima: temporadas[temporadas.length - 1], palabras: palabras(f.name) };
  });

  const parejas: Fusion[] = [];
  for (const viejo of clubes) {
    for (const nuevo of clubes) {
      if (viejo.id === nuevo.id || viejo.ultima >= nuevo.primera) continue;
      const hueco = nuevo.primera - viejo.ultima - 1;
      const [corto, largo] = viejo.palabras.length <= nuevo.palabras.length ? [viejo.palabras, nuevo.palabras] : [nuevo.palabras, viejo.palabras];
      const nombres = hueco === 0 ? encaja(corto, largo) : encaja(viejo.palabras, nuevo.palabras);
      if (nombres && !unoEsFilial(viejo.palabras, nuevo.palabras)) parejas.push({ league, viejo: viejo.id, nuevo: nuevo.id, nombreViejo: viejo.name, nombreNuevo: nuevo.name, hueco });
    }
  }
  // Solo si es la única pareja posible de los dos.
  return parejas
    .filter((p) => parejas.filter((x) => x.viejo === p.viejo || x.nuevo === p.viejo).length === 1 && parejas.filter((x) => x.nuevo === p.nuevo || x.viejo === p.nuevo).length === 1)
    .sort((a, b) => a.viejo.localeCompare(b.viejo));
}

/** Une las parejas de `clubesPartidos`, en una transacción. Devuelve lo que unió (nada, si no había). */
export function unificarClubesPartidos(league: string): Fusion[] {
  const fusiones = clubesPartidos(league);
  if (!fusiones.length) return [];
  const db = getDb();
  const existe = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const f of fusiones) {
      for (const { tabla, columnas, filtro } of TABLAS) {
        if (!existe.has(tabla)) continue;
        const y = filtro ? ` AND ${filtro}` : '';
        for (const c of columnas) {
          // OR IGNORE + DELETE: lo que no se pudo mover choca con una fila que el id nuevo ya tiene (el
          // mismo partido, la misma alineación…), así que sobra.
          db.prepare(`UPDATE OR IGNORE ${tabla} SET ${c} = ? WHERE league = ? AND ${c} = ?${y}`).run(f.nuevo, league, f.viejo);
          db.prepare(`DELETE FROM ${tabla} WHERE league = ? AND ${c} = ?${y}`).run(league, f.viejo);
        }
      }
      // El rating se vuelve a calcular con los partidos ya unidos.
      db.prepare('DELETE FROM fb_team_ratings WHERE league = ? AND team_id = ?').run(league, f.viejo);
      db.prepare('DELETE FROM fb_teams WHERE league = ? AND id = ?').run(league, f.viejo);
      db.prepare(
        `INSERT INTO fb_team_aliases (league, alias, team_id, fuente, season, updated_at) VALUES (?, ?, ?, 'openfootball', NULL, ?)
         ON CONFLICT(league, alias) DO UPDATE SET team_id = excluded.team_id, fuente = excluded.fuente, updated_at = excluded.updated_at`,
      ).run(league, f.nombreViejo, f.nuevo, ahora);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return fusiones;
}
