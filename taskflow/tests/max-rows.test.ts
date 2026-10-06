import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CANVAS_BASE_URL = "https://canvas.prueba/api/v1";
  process.env.CANVAS_TOKEN = "7~token-de-prueba-de-canvas-123456";
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { syncCanvas } from "@/lib/canvas-sync";
import { NOTE_COLS, TASK_COLS, loadHabitLog, loadIcsSources, loadNotes, loadTasks } from "@/lib/data";
import { buildExport, parseBackup, planImport } from "@/lib/backup";
import { PAGE, fetchAll } from "@/lib/paginate";
import type { CanvasPlannerItem } from "@/lib/canvas";
import { ctxFor, fakeProject } from "./helpers/supa";

/**
 * Supabase corta cada lectura en 1000 filas sin avisar (y el harness ahora
 * también). Con unos semestres de Canvas se pasa de mil tareas; aquí se
 * comprueba que nada de lo que tiene que verlo todo se quede corto.
 */

const A = "a@ejemplo.com";
const HOY = "2026-10-01";
let p: Awaited<ReturnType<typeof fakeProject>>;
let a: string;

beforeEach(async () => {
  p = await fakeProject([A]);
  a = p.id(A);
});
afterEach(() => vi.unstubAllGlobals());

const ctx = () => ctxFor(p.as(A), a, HOY);
const MAS_DE_MIL = 1105;

/** Tareas viejas y hechas de semestres pasados, para pasar el tope. */
async function relleno(n: number, extra: Record<string, unknown> = {}, ext: (i: number) => string | null = () => null) {
  const filas = Array.from({ length: n }, (_, i) => ({
    user_id: a, title: `vieja ${i}`, due_date: "2024-03-01", done: true, source: "manual", external_id: ext(i), ...extra,
  }));
  const { error } = await p.admin.from("tasks").insert(filas);
  if (error) throw new Error(error.message);
}

describe("el tope de 1000 filas", () => {
  it("el harness lo impone, como Supabase", async () => {
    await relleno(MAS_DE_MIL);
    const { data } = await p.as(A).from("tasks").select("id").eq("user_id", a);
    expect(data).toHaveLength(1000);
  });

  it("fetchAll pide de a mil hasta una página corta, y se detiene en un error", async () => {
    const pedidos: [number, number][] = [];
    const filas = Array.from({ length: 2 * PAGE + 3 }, (_, i) => i);
    const r = await fetchAll(async (from, to) => {
      pedidos.push([from, to]);
      return { data: filas.slice(from, to + 1), error: null };
    });
    expect(r.data).toHaveLength(2 * PAGE + 3);
    expect(pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);

    const roto = await fetchAll(async (from) => (from ? { data: null, error: { message: "x" } } : { data: [1], error: null }));
    expect(roto).toEqual({ data: [1], error: null });
  });

  it("las tareas de hoy siguen en Hoy aunque haya mil viejas", async () => {
    await relleno(MAS_DE_MIL);
    await p.as(A).from("tasks").insert({ user_id: a, title: "Problem set 6", due_date: "2026-10-02" });
    const tareas = await loadTasks(ctx());
    expect(tareas).toHaveLength(MAS_DE_MIL + 1);
    expect(tareas.some((t) => t.title === "Problem set 6")).toBe(true);
  });

  it("las notas, todas", async () => {
    const { error } = await p.admin.from("notes").insert(Array.from({ length: MAS_DE_MIL }, (_, i) => ({ user_id: a, body: `nota ${i}` })));
    expect(error).toBeNull();
    expect(await loadNotes(ctx())).toHaveLength(MAS_DE_MIL);
  });

  it("el historial de rutinas, con nueve rutinas diarias", async () => {
    const { data: hs } = await p.admin.from("habits").insert(Array.from({ length: 9 }, (_, i) => ({ user_id: a, name: `r${i}` }))).select("id");
    const dias = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 5, 4 + i)).toISOString().slice(0, 10));
    const { error } = await p.admin.from("habit_log").insert(hs!.flatMap((h) => dias.map((day) => ({ habit_id: h.id, user_id: a, day }))));
    expect(error).toBeNull();
    const log = await loadHabitLog(ctx(), "2026-06-01", HOY);
    expect([...log.values()].reduce((n, s) => n + s.size, 0)).toBe(9 * 120);
  });

  it("las fuentes .ics cuentan todos sus eventos", async () => {
    const { error } = await p.admin.from("events").insert(Array.from({ length: MAS_DE_MIL }, (_, i) => ({
      user_id: a, title: "clase", source: "ics", external_id: `ics:SFU:${i}`, course_ref: "SFU", all_day_date: "2026-10-01",
    })));
    expect(error).toBeNull();
    expect(await loadIcsSources(ctx())).toEqual([{ name: "SFU", count: MAS_DE_MIL }]);
  });

  it("el respaldo lleva todo, y al reimportarlo no duplica nada", async () => {
    await relleno(MAS_DE_MIL);
    const respaldo = JSON.parse(JSON.stringify(await buildExport(ctx(), { tasks: TASK_COLS, notes: NOTE_COLS })));
    expect(respaldo.tasks).toHaveLength(MAS_DE_MIL);
    const plan = await planImport(ctx(), parseBackup(respaldo));
    expect(plan.summary.tasks).toMatchObject({ total: MAS_DE_MIL, new: 0 });
  });

  /**
   * El que más importa. Si la lectura de "lo que ya trajo Canvas" se queda
   * corta, lo que no vino parece nuevo y el upsert completo pisa la fila:
   * una tarea que marcaste hecha vuelve a quedar pendiente.
   */
  it("Canvas no pisa una tarea editada aunque haya más de mil de Canvas", async () => {
    await relleno(MAS_DE_MIL, { source: "canvas", done: true }, (i) => `canvas:assignment:${100000 + i}`);
    const { error } = await p.as(A).from("tasks").insert({
      user_id: a, title: "Problem Set 6", due_date: "2026-10-19", source: "canvas", external_id: "canvas:assignment:7",
      done: true, priority: 1, area: "Personal", user_edited_at: "2026-09-30T00:00:00Z",
    });
    expect(error).toBeNull();

    const items: CanvasPlannerItem[] = [{
      course_id: "1", plannable_id: "7", plannable_type: "assignment", plannable_date: "2026-10-20T06:59:00Z",
      plannable: { title: "Problem Set 6" }, submissions: { submitted: false },
    }];
    vi.stubGlobal("fetch", vi.fn(async (u: string) =>
      new URL(String(u)).pathname.endsWith("/planner/items") ? Response.json(items) : Response.json([])));

    await syncCanvas(ctx());
    const { data } = await p.admin.from("tasks").select("done, priority, area").eq("external_id", "canvas:assignment:7").single();
    expect(data).toEqual({ done: true, priority: 1, area: "Personal" });
  });
});
