// Leer un fichero de temporada de TML comprobando lo que trae (auditoría del 17 de octubre, punto 4).
//
// Antes se leía con `relax_column_count` y se guardaba todo: una fila cortada a media columna
// (2025.csv, línea 2945: 37 campos de 50, la final de las Next Gen) entraba con w_1stWon = 2, que es
// el trozo de un número; y los partidos que la fuente repite con otro número de partido (8 grupos
// en 2017–2025) contaban dos veces en el Elo. Aquí, fila a fila:
//
//   · Campos de más: las columnas están corridas y no se sabe cuál es cuál → fuera.
//   · Campos de menos: el último campo que llegó puede estar cortado. Si todo lo que identifica el
//     partido y su resultado (torneo, fecha, los dos, marcador, ronda) está ANTES de ese último
//     campo, se guarda el partido y las estadísticas de saque de los dos quedan DESCONOCIDAS (ni el
//     trozo que llegó: no se sabe si es el número entero). Si no, fuera.
//   · El mismo partido (torneo, ronda, ganador, perdedor y marcador) dos veces: se guarda una. Si las
//     copias no coinciden en algo, ese algo queda DESCONOCIDO (en las estadísticas, el lado entero,
//     como en serveStats: no se sabe cuál de los números es el bueno).
//   · Los mismos dos en la misma ronda con OTRO marcador: puede ser legítimo (round robin, Copa
//     Davis) o no. Se guardan los dos y se apunta para revisarlo.
//
// Nada se inventa ni se arregla a ojo, y todo queda apuntado con su fichero, su línea y su número
// de partido en la fuente (ingest_anomalias).

import { parse } from 'csv-parse/sync';

export type TipoAnomalia = 'campos_de_menos' | 'campos_de_mas' | 'faltan_datos' | 'duplicado_exacto' | 'duplicado_con_otros_datos' | 'clave_repetida';
/** recuperada: se guarda con lo dudoso a DESCONOCIDO; descartada: no se guarda; conservada: se guarda tal cual, apuntada. */
export type AccionAnomalia = 'recuperada' | 'descartada' | 'conservada';

export interface AnomaliaIngesta {
  fichero: string;
  /** Línea física del fichero (1 = cabecera). */
  linea: number;
  tipo: TipoAnomalia;
  accion: AccionAnomalia;
  /** El número de partido de la fuente (match_num), si lo trae. */
  idFuente: string | null;
  detalle: string;
}

export type FilaTml = Record<string, string | null>;

export interface LecturaTml {
  filas: FilaTml[];
  anomalias: AnomaliaIngesta[];
}

/** Lo que identifica un partido y su resultado: sin esto entero, la fila no se puede usar. */
const NECESARIAS = ['tourney_id', 'tourney_date', 'winner_id', 'loser_id', 'score', 'round'];
const esEstadistica = (c: string) => /^[wl]_/.test(c);
const lado = (c: string) => c.slice(0, 2);

export function leerTml(csv: string, fichero: string): LecturaTml {
  const registros = parse(csv, { relax_column_count: true, skip_empty_lines: true, info: true }) as { record: string[]; info: { lines: number } }[];
  const anomalias: AnomaliaIngesta[] = [];
  if (registros.length === 0) return { filas: [], anomalias };
  const cabecera = registros[0].record.map((c) => c.trim());
  const n = cabecera.length;
  const iNum = cabecera.indexOf('match_num');
  const ultimaNecesaria = Math.max(...NECESARIAS.map((c) => cabecera.indexOf(c)));
  const apuntar = (linea: number, rec: string[], tipo: TipoAnomalia, accion: AccionAnomalia, detalle: string) =>
    anomalias.push({ fichero, linea, tipo, accion, idFuente: iNum >= 0 && rec[iNum] ? rec[iNum] : null, detalle });

  // 1. Cada fila, con su número de campos comprobado.
  const leidas: { fila: FilaTml; linea: number; rec: string[] }[] = [];
  for (const { record: rec, info } of registros.slice(1)) {
    const linea = info.lines;
    if (rec.length > n) {
      apuntar(linea, rec, 'campos_de_mas', 'descartada', `${rec.length} campos y la cabecera tiene ${n}: las columnas están corridas`);
      continue;
    }
    if (rec.length < n) {
      const fiables = rec.length - 1;
      const ultimo = `${cabecera[rec.length - 1]}='${rec[rec.length - 1]}'`;
      if (fiables <= ultimaNecesaria) {
        apuntar(linea, rec, 'campos_de_menos', 'descartada', `${rec.length} de ${n} campos: el resultado no llegó entero (el último, ${ultimo}, puede estar cortado)`);
        continue;
      }
      const fila = Object.fromEntries(cabecera.map((c, i) => [c, i < fiables && !esEstadistica(c) ? rec[i] : null]));
      apuntar(linea, rec, 'campos_de_menos', 'recuperada', `${rec.length} de ${n} campos; se guarda el resultado y las estadísticas de saque de los dos quedan DESCONOCIDAS (el último campo, ${ultimo}, puede estar cortado)`);
      leidas.push({ fila, linea, rec });
      continue;
    }
    leidas.push({ fila: Object.fromEntries(cabecera.map((c, i) => [c, rec[i]])), linea, rec });
  }
  // Sin algo de lo que identifica el partido (los dos, la fecha, el marcador…) la fila no se puede
  // usar, y no se rellena: antes, una fecha vacía pasaba a ser el 1 de enero.
  for (let i = leidas.length - 1; i >= 0; i--) {
    const faltan = NECESARIAS.filter((c) => !String(leidas[i].fila[c] ?? '').trim());
    if (!faltan.length) continue;
    apuntar(leidas[i].linea, leidas[i].rec, 'faltan_datos', 'descartada', `sin ${faltan.join(', ')}: no se puede saber qué partido es`);
    leidas.splice(i, 1);
  }

  // 2. El mismo partido dos veces, y los mismos dos en la misma ronda con otro marcador.
  const partido = (f: FilaTml) => [f.tourney_id, f.round, f.winner_id, f.loser_id, f.score].join('|');
  const cruce = (f: FilaTml) => [f.tourney_id, f.round, f.winner_id, f.loser_id].join('|');
  const primeraDe = new Map<string, number>();
  const marcadoresDe = new Map<string, { score: string | null; linea: number }>();
  const fuera = new Set<number>();
  for (let i = 0; i < leidas.length; i++) {
    const { fila, linea, rec } = leidas[i];
    const k = partido(fila);
    const j = primeraDe.get(k);
    if (j === undefined) {
      primeraDe.set(k, i);
      const c = cruce(fila);
      const otro = marcadoresDe.get(c);
      if (otro) apuntar(linea, rec, 'clave_repetida', 'conservada', `los mismos dos en la misma ronda que la línea ${otro.linea}, con otro marcador (${otro.score} / ${fila.score}): se guardan los dos; revisar si es un round robin`);
      else marcadoresDe.set(c, { score: fila.score, linea });
      continue;
    }
    const base = leidas[j];
    const distintas = cabecera.filter((c) => c !== 'match_num' && (fila[c] ?? null) !== (base.fila[c] ?? null));
    fuera.add(i);
    // Si ni la fecha coincide, no se sabe cuándo se jugó: fuera las dos (una fecha DESCONOCIDA no se
    // puede guardar, y elegir una sería inventarla).
    const necesarias = distintas.filter((c) => NECESARIAS.includes(c));
    if (necesarias.length) {
      fuera.add(j);
      apuntar(base.linea, base.rec, 'duplicado_con_otros_datos', 'descartada', `el mismo partido que la línea ${linea} con otra ${necesarias.join(', ')}: no se sabe cuál es la buena; fuera las dos`);
      apuntar(linea, rec, 'duplicado_con_otros_datos', 'descartada', `el mismo partido que la línea ${base.linea} con otra ${necesarias.join(', ')}`);
      continue;
    }
    if (distintas.length === 0) {
      apuntar(linea, rec, 'duplicado_exacto', 'descartada', `igual que la línea ${base.linea} (partido ${base.fila.match_num || '—'}) salvo el número de partido`);
      continue;
    }
    // Lo que no coincide queda DESCONOCIDO en la que se guarda; en las estadísticas, el lado entero.
    const lados = new Set(distintas.filter(esEstadistica).map(lado));
    for (const c of cabecera) if ((esEstadistica(c) && lados.has(lado(c))) || (!esEstadistica(c) && distintas.includes(c) && c !== 'match_num')) base.fila[c] = null;
    if (!anomalias.some((a) => a.linea === base.linea && a.tipo === 'duplicado_con_otros_datos')) {
      apuntar(base.linea, base.rec, 'duplicado_con_otros_datos', 'recuperada', `el mismo partido que la línea ${linea} con otros datos (${distintas.join(', ')}): se guarda una vez y lo que no coincide queda DESCONOCIDO`);
    }
    apuntar(linea, rec, 'duplicado_con_otros_datos', 'descartada', `el mismo partido que la línea ${base.linea} con otros datos (${distintas.join(', ')})`);
  }
  anomalias.sort((a, b) => a.linea - b.linea);
  return { filas: leidas.filter((_, i) => !fuera.has(i)).map((x) => x.fila), anomalias };
}
