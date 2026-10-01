import { addDays, startOfWeek } from "./date";
import type { Task, TaskKind } from "./types";

/**
 * La carga que viene: "Próximos 14 días: 2 midterms + 1 proyecto".
 *
 * Determinista y sin Claude: cuenta lo que está en tus tareas, con el tipo
 * que tienen (de Canvas o corregido a mano). Si una tarea no tiene tipo, no
 * se adivina; cuenta como una entrega más.
 */

/** Lo que pesa de verdad en el semestre, en el orden en que se nombra. */
export const MAJOR: TaskKind[] = ["final", "midterm", "project", "presentation", "quiz"];

const NOMBRE: Record<TaskKind, [string, string]> = {
  final: ["final", "finales"],
  midterm: ["midterm", "midterms"],
  project: ["proyecto", "proyectos"],
  presentation: ["presentación", "presentaciones"],
  quiz: ["quiz", "quizzes"],
  assignment: ["entrega", "entregas"],
  reading: ["lectura", "lecturas"],
  other: ["otra", "otras"],
};

export const kindLabel = (k: TaskKind, n = 1) => NOMBRE[k][n === 1 ? 0 : 1];

export type Workload = {
  days: number;
  /** Las importantes, pendientes, dentro de la ventana, por fecha. */
  majors: Task[];
  counts: Partial<Record<TaskKind, number>>;
  /** El resto de lo que vence en la ventana. */
  others: number;
  /** "Próximos 14 días: 2 midterms + 1 proyecto", o null si no hay nada que destacar. */
  line: string | null;
  /** Suma de los pesos conocidos de las importantes, y cuántas lo tenían. */
  weight: { pct: number; known: number } | null;
  /** Semanas con dos o más importantes: ahí es donde hace falta empezar antes. */
  heavyWeeks: { monday: string; count: number; kinds: string }[];
};

/** "2 midterms + 1 proyecto". */
export function countPhrase(counts: Partial<Record<TaskKind, number>>, order: TaskKind[] = MAJOR): string {
  return order
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${kindLabel(k, counts[k])}`)
    .join(" + ");
}

export function upcomingWorkload(tasks: Task[], today: string, days = 14): Workload {
  const last = addDays(today, days - 1);
  const enVentana = tasks.filter(
    (t) => !t.done && !t.deleted_at && t.due_date && t.due_date >= today && t.due_date <= last,
  );
  const majors = enVentana
    .filter((t) => t.kind && MAJOR.includes(t.kind))
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || a.priority - b.priority);

  const counts: Partial<Record<TaskKind, number>> = {};
  for (const t of majors) counts[t.kind!] = (counts[t.kind!] ?? 0) + 1;
  const others = enVentana.length - majors.length;

  let line: string | null = null;
  if (majors.length) {
    line = `Próximos ${days} días: ${countPhrase(counts)}`;
  } else if (others >= 5) {
    // Sin exámenes ni proyectos, pero con muchas entregas juntas, también vale decirlo.
    line = `Próximos ${days} días: ${others} entregas`;
  }

  const conPeso = majors.filter((t) => t.weight_pct != null);
  const weight = conPeso.length
    ? { pct: Math.round(conPeso.reduce((a, t) => a + Number(t.weight_pct), 0) * 10) / 10, known: conPeso.length }
    : null;

  const semanas = new Map<string, Task[]>();
  for (const t of majors) {
    const lunes = startOfWeek(t.due_date!);
    semanas.set(lunes, [...(semanas.get(lunes) ?? []), t]);
  }
  const heavyWeeks = [...semanas]
    .filter(([, ts]) => ts.length >= 2)
    .map(([monday, ts]) => {
      const c: Partial<Record<TaskKind, number>> = {};
      for (const t of ts) c[t.kind!] = (c[t.kind!] ?? 0) + 1;
      return { monday, count: ts.length, kinds: countPhrase(c) };
    });

  return { days, majors, counts, others, line, weight, heavyWeeks };
}
