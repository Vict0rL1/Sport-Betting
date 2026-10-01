/**
 * Tiempo libre y ocupado, en minutos locales de un día (0–1440).
 *
 * Todo aquí es determinista y puro. Es la parte que decide DÓNDE cabe algo:
 * Claude puede proponer qué hacer, pero quién calcula los huecos, los choques
 * y los límites es este archivo. Un modelo al que le pides que "respete los
 * compromisos" se los pisa de vez en cuando; uno al que sólo le das huecos ya
 * calculados — y cuya respuesta se vuelve a validar aquí — no puede.
 */

export type Gap = { start: number; end: number };

/** Un hueco por debajo de esto no sirve para nada: ni empiezas. */
export const MIN_GAP = 20;

/** Une los intervalos que se tocan o se enciman. */
export function mergeBusy(busy: Gap[]): Gap[] {
  const sorted = busy.filter((b) => b.end > b.start).map((b) => ({ ...b })).sort((a, b) => a.start - b.start);
  const out: Gap[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else out.push(b);
  }
  return out;
}

/**
 * Los ratos libres entre `from` y `to`.
 *
 * `busy` son los compromisos: clases, eventos con hora y los bloques que ya
 * tengas puestos. Se fusionan los solapados antes de restar, porque dos
 * eventos encimados dejarían un hueco negativo.
 */
export function freeGaps(busy: Gap[], from: number, to: number, minGap = MIN_GAP): Gap[] {
  const ocupado = mergeBusy(
    busy.map((b) => ({ start: Math.max(b.start, from), end: Math.min(b.end, to) })),
  );

  const libres: Gap[] = [];
  let cursor = from;
  for (const b of ocupado) {
    if (b.start - cursor >= minGap) libres.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (to - cursor >= minGap) libres.push({ start: cursor, end: to });
  return libres;
}

export const overlaps = (a: Gap, b: Gap) => a.start < b.end && b.start < a.end;

export type Proposed = Gap & { taskId?: string | null };

export type SkipReason = "ocupado" | "pasado" | "tarea";

/**
 * Qué parte de una propuesta se puede escribir AHORA.
 *
 * La propuesta se armó hace un rato; desde entonces pudo pasar de todo: que
 * agregaras un bloque a mano, que llegara un evento nuevo, que marcaras hecha
 * la tarea, o que el botón "Agendar" se pulsara dos veces. Se vuelve a medir
 * contra lo que hay en este momento:
 *
 *  - lo que choca con algo ocupado no entra (y así un doble "Agendar" no
 *    duplica nada: la segunda vez todo choca con lo que puso la primera);
 *  - lo que ya terminó no entra;
 *  - lo que adelanta una tarea que ya no está pendiente no entra.
 *
 * Nunca se toca lo que ya estaba: sólo se decide qué se agrega.
 */
export function acceptable<T extends Proposed>(
  proposed: T[],
  busy: Gap[],
  opts: { now?: number | null; liveTaskIds?: Set<string> } = {},
): { accepted: T[]; skipped: { block: T; reason: SkipReason }[] } {
  const taken = mergeBusy(busy);
  const accepted: T[] = [];
  const skipped: { block: T; reason: SkipReason }[] = [];

  for (const b of [...proposed].sort((x, y) => x.start - y.start)) {
    if (opts.now != null && b.end <= opts.now) skipped.push({ block: b, reason: "pasado" });
    else if (b.taskId && opts.liveTaskIds && !opts.liveTaskIds.has(b.taskId)) skipped.push({ block: b, reason: "tarea" });
    else if (taken.some((t) => overlaps(t, b)) || accepted.some((a) => overlaps(a, b))) {
      skipped.push({ block: b, reason: "ocupado" });
    } else accepted.push(b);
  }
  return { accepted, skipped };
}
