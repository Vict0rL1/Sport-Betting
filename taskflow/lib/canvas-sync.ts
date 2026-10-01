import "server-only";

import {
  type CanvasCourse,
  type CanvasPlannerItem,
  type ExistingRow,
  canvasGetAll,
  insertRow,
  mapPlannerItems,
  planSync,
  safeUpsertRow,
  submittedIds,
} from "./canvas";
import { addDays } from "./date";
import { canvasConfigured, requireCanvasEnv } from "./env.server";
import type { Ctx } from "./data";
import { type ErrorCode, IntegrationError, errorCodeOf, logEvent, safeMessage } from "./log";
import { recordRun } from "./sync-state";

/** Ventana que se pide a Canvas, en días alrededor de hoy. */
const DAYS_BACK = 14;
const DAYS_AHEAD = 180;

export type SyncResult = {
  ok: boolean;
  /** Cuántos deadlines quedaron en la base tras esta corrida. */
  items: number;
  inserted: number;
  updated: number;
  /** Filas con edición manual: sólo se les refrescó título y fecha. */
  protected: number;
  /** Entregadas en Canvas que se marcaron hechas. */
  completed: number;
  /** Ya no están en Canvas: a la papelera. */
  vanished: number;
  message: string;
};

/**
 * Trae los deadlines de Canvas y los deja en `tasks`.
 *
 * Los dos `upsert` son la regla dura hecha SQL: el primero manda las columnas
 * del sync, el segundo sólo título y fecha. Lo que no viaja en el objeto es
 * exactamente lo que Postgres no toca — `done`, `priority`, `area` y
 * `est_minutes` de una fila editada a mano sobreviven intactos.
 */
export async function syncCanvas(ctx: Ctx): Promise<SyncResult> {
  const { baseUrl, token } = requireCanvasEnv();

  const start = addDays(ctx.today, -DAYS_BACK);
  const end = addDays(ctx.today, DAYS_AHEAD);

  const plannerUrl =
    `${baseUrl}/planner/items?start_date=${start}&end_date=${end}&per_page=100`;
  const coursesUrl = `${baseUrl}/users/self/favorites/courses?per_page=100`;

  const [planner, courses] = await Promise.all([
    canvasGetAll(plannerUrl, token),
    // Los cursos son para clasificar; si fallan, el sync sigue sin ellos.
    canvasGetAll(coursesUrl, token).catch(() => null),
  ]);
  const rawItems = planner.items;
  const rawCourses = courses?.items ?? [];

  const incoming = mapPlannerItems(
    rawItems as CanvasPlannerItem[],
    rawCourses as CanvasCourse[],
    { areas: ctx.profile.areas, timeZone: ctx.tz, baseUrl },
  );

  // El filtro por `user_id` es explícito a propósito. Con la sesión bastaría la
  // RLS, pero el reloj corre con la service role, que la salta: sin esto leería
  // y pisaría las filas de cualquier otro usuario.
  const { data: existing, error: readError } = await ctx.supabase
    .from("tasks")
    .select("external_id, user_edited_at, done, deleted_at, due_date")
    .eq("user_id", ctx.userId)
    .eq("source", "canvas")
    .returns<ExistingRow[]>();

  // Si no se pudo leer lo que hay, NO se sigue. Antes, una lectura fallida
  // dejaba la lista en blanco, todo parecía nuevo, y el upsert completo pisaba
  // el área de las filas que Victor había editado — justo lo que la regla
  // dura prohíbe.
  if (readError || !existing) {
    throw new IntegrationError(
      "CANVAS_DB_FAILED",
      "No se pudieron leer los deadlines guardados: " + (readError?.message ?? "sin respuesta"),
      true,
    );
  }

  const plan = planSync(incoming, existing, {
    submitted: submittedIds(rawItems as CanvasPlannerItem[]),
    coursesOk: courses != null,
    window: { start, end, complete: planner.complete },
  });

  // Filas que son del sync: se insertan o se refrescan enteras.
  const owned = [...plan.insert, ...plan.updateAll].map((t) => insertRow(t, ctx.userId));
  if (owned.length) {
    const { error } = await ctx.supabase
      .from("tasks")
      .upsert(owned, { onConflict: "user_id,source,external_id" });
    if (error) throw new IntegrationError("CANVAS_DB_FAILED", "No se pudieron guardar los deadlines: " + error.message, true);
  }

  // Filas que Victor tocó: sólo título y fecha.
  const manual = plan.updateSafe.map((t) => safeUpsertRow(t, ctx.userId));
  if (manual.length) {
    const { error } = await ctx.supabase
      .from("tasks")
      .upsert(manual, { onConflict: "user_id,source,external_id" });
    if (error) {
      throw new IntegrationError("CANVAS_DB_FAILED", "No se pudieron actualizar los deadlines editados: " + error.message, true);
    }
  }

  // Las dos escrituras que no son upsert repiten la condición en el UPDATE
  // (`user_edited_at is null`, etc.). Si Victor tocó la fila entre la lectura de
  // arriba y este momento, la condición ya no se cumple y la fila no se toca.
  const now = new Date().toISOString();
  if (plan.complete.length) {
    const { error } = await ctx.supabase
      .from("tasks")
      .update({ done: true, done_at: now })
      .eq("user_id", ctx.userId)
      .eq("source", "canvas")
      .in("external_id", plan.complete)
      .is("user_edited_at", null)
      .eq("done", false);
    if (error) throw new IntegrationError("CANVAS_DB_FAILED", "No se pudieron marcar las entregadas: " + error.message, true);
  }

  if (plan.vanished.length) {
    const { error } = await ctx.supabase
      .from("tasks")
      .update({ deleted_at: now, focus_day: null })
      .eq("user_id", ctx.userId)
      .eq("source", "canvas")
      .in("external_id", plan.vanished)
      .is("user_edited_at", null)
      .is("deleted_at", null)
      .eq("done", false);
    if (error) throw new IntegrationError("CANVAS_DB_FAILED", "No se pudo limpiar lo que ya no está en Canvas: " + error.message, true);
  }

  if (plan.vanishedHeld) {
    logEvent({
      event: "canvas.vanish_held", result: "skipped", userId: ctx.userId, integration: "canvas",
      count: plan.vanishedHeld,
    });
  }

  const partes = [`${incoming.length} deadlines`, `${plan.insert.length} nuevos`];
  if (plan.updateSafe.length) partes.push(`${plan.updateSafe.length} respetando tus cambios`);
  if (plan.complete.length) partes.push(`${plan.complete.length} entregada${plan.complete.length > 1 ? "s" : ""}`);
  if (plan.vanished.length) partes.push(`${plan.vanished.length} ya no está${plan.vanished.length > 1 ? "n" : ""} en Canvas (a la papelera)`);

  const nada = !plan.insert.length && !plan.updateAll.length && !plan.updateSafe.length &&
    !plan.complete.length && !plan.vanished.length;
  const message = nada ? "Canvas no trajo deadlines pendientes" : partes.join(" · ");

  return {
    ok: true,
    items: incoming.length,
    inserted: plan.insert.length,
    updated: plan.updateAll.length,
    protected: plan.updateSafe.length,
    completed: plan.complete.length,
    vanished: plan.vanished.length,
    message,
  };
}

export type CanvasRun =
  | { ok: true; result: SyncResult }
  | { ok: false; message: string; code?: ErrorCode };

/**
 * Corre el sync y deja constancia en `sync_state` y en el log, salga bien o
 * mal. Es lo que llaman el botón de Ajustes, la ruta y el reloj: los tres
 * repetían el mismo try/catch y cada uno lo registraba un poco distinto.
 */
export async function runCanvasSync(ctx: Ctx, trigger: "cron" | "manual"): Promise<CanvasRun> {
  if (!canvasConfigured()) {
    return { ok: false, code: "CANVAS_NOT_CONFIGURED", message: "Falta CANVAS_TOKEN en las variables del servidor." };
  }

  const started = Date.now();
  try {
    const result = await syncCanvas(ctx);
    await recordRun(ctx.supabase, ctx.userId, "canvas", { ok: true, items: result.items });
    logEvent({
      event: "canvas.sync", result: "ok", userId: ctx.userId, integration: "canvas", trigger,
      items: result.items, inserted: result.inserted, updated: result.updated, protected: result.protected,
      ms: Date.now() - started,
    });
    return { ok: true, result };
  } catch (e) {
    const code = errorCodeOf(e);
    const message = safeMessage(e, "Falló el sync de Canvas");
    await recordRun(ctx.supabase, ctx.userId, "canvas", { ok: false, error: message, code });
    logEvent({
      event: "canvas.sync", result: "error", userId: ctx.userId, integration: "canvas", trigger,
      errorCode: code, message, ms: Date.now() - started,
    });
    return { ok: false, message, code };
  }
}
