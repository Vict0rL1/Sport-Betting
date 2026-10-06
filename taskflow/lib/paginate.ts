/**
 * PostgREST corta cada respuesta en `max-rows` filas (1000 por defecto en
 * Supabase) y no avisa: la respuesta llega con status 200 y le faltan filas.
 * Para lo que tiene que ver TODO —las tareas, lo que ya trajo Canvas, un
 * respaldo— esto pide de a mil hasta que una página viene incompleta.
 *
 * La consulta que se pasa tiene que estar ordenada por algo único (al final,
 * `id`): si no, entre una página y la siguiente se pueden saltar o repetir
 * filas.
 */
export const PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(
  page: (from: number, to: number) => Page<T>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return { data: out, error: null };
  }
}
