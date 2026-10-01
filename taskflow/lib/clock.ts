import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canvasSyncDue } from "./canvas";
import { runCanvasSync } from "./canvas-sync";
import { canvasConfigured, pushSendConfigured, telegramConfigured } from "./env.server";
import { DEFAULT_TIMEZONE, addDays, minutesInTz, todayInTz } from "./date";
import { buildDigest, digestDue, sendDigest, type Digest, type DigestKind, type PushSubscriptionRow } from "./push";
import { classifyTelegramError, sendDigestTelegram } from "./telegram";
import { loadEvents, loadTasks, type Ctx } from "./data";
import { IntegrationError, errorCodeOf, logEvent, safeMessage } from "./log";
import { recordRun } from "./sync-state";
import type { Profile } from "./types";

/**
 * El reloj de la app: lo que hace `/api/sync` en cada tic.
 *
 * Vive aquí y no en el route handler para poder probarlo entero contra una
 * base de verdad. La ruta sólo autentica y llama a `runClock`.
 *
 * Corre con la service role, que **salta la RLS**: todo lo de adentro filtra
 * por `user_id` a mano.
 */

export type Admin = SupabaseClient;

export type ClockOptions = {
  /** Para el botón "Abrir TaskFlow" de Telegram. */
  origin: string;
  /** Forzar este aviso ya, saltándose la ventana y el registro. */
  digest?: DigestKind | null;
  /** Forzar el sync de Canvas aunque acabe de correr. */
  forceCanvas?: boolean;
  /** Sólo para pruebas. */
  now?: Date;
};

export type ClockLine = { user: string; ok: boolean; message: string; aviso: string };

export async function runClock(admin: Admin, opts: ClockOptions): Promise<ClockLine[]> {
  const now = opts.now ?? new Date();
  const { data: profiles, error } = await admin.from("profiles").select("*").returns<Profile[]>();
  if (error) throw new IntegrationError("CRON_DB_FAILED", "No se pudieron leer los perfiles: " + error.message, true);

  const lines: ClockLine[] = [];
  for (const profile of profiles ?? []) {
    // Cada perfil por separado: que uno reviente no deja sin aviso a los demás.
    lines.push(await tick(admin, profile, now, opts));
  }
  return lines;
}

async function tick(admin: Admin, profile: Profile, now: Date, opts: ClockOptions): Promise<ClockLine> {
  const tz = profile.timezone || DEFAULT_TIMEZONE;
  const ctx: Ctx = {
    supabase: admin as unknown as Ctx["supabase"],
    userId: profile.id,
    profile,
    tz,
    today: todayInTz(tz, now),
  };
  const hora = Math.floor(minutesInTz(tz, now) / 60);

  // El latido. Primero el intento, al final el éxito: si la función muere a
  // medias (timeout de Vercel), Ajustes ve una corrida que empezó y no terminó.
  await admin
    .from("sync_state")
    .upsert({ user_id: ctx.userId, source: "cron", last_synced_at: now.toISOString() }, { onConflict: "user_id,source" });

  try {
    let message = "Canvas no está configurado";
    let ok = true;

    if (canvasConfigured()) {
      if (!opts.forceCanvas && !(await canvasToca(ctx, admin, now))) {
        message = "Canvas: sincronizado hace poco, se salta";
      } else {
        const r = await runCanvasSync(ctx, "cron");
        message = r.ok ? r.result.message : r.message;
        ok = r.ok;
      }
    }

    // El aviso va después del sync, para que cuente los deadlines que acaban
    // de entrar. Que falle no debe tumbar la corrida.
    const kind = opts.digest ?? digestDue(profile, hora);
    const hayCanal = pushSendConfigured() || telegramConfigured();
    let aviso = !kind ? `no toca (son las ${hora})` : "ningún canal configurado (ni push ni Telegram)";
    if (kind && hayCanal) {
      try {
        aviso = await avisar(ctx, admin, kind, opts.digest != null, opts.origin);
      } catch (e) {
        aviso = "falló el aviso: " + safeMessage(e, "error");
      }
    }

    await recordRun(ctx.supabase, ctx.userId, "cron", { ok: true });
    logEvent({ event: "cron.tick", result: "ok", userId: ctx.userId, integration: "cron", hour: hora, digest: kind ?? null });
    return { user: profile.id, ok, message, aviso };
  } catch (e) {
    const message = safeMessage(e, "Falló la corrida");
    const code = errorCodeOf(e) ?? "CRON_DB_FAILED";
    await recordRun(ctx.supabase, ctx.userId, "cron", { ok: false, error: message, code });
    logEvent({ event: "cron.tick", result: "error", userId: ctx.userId, integration: "cron", errorCode: code, message });
    return { user: profile.id, ok: false, message, aviso: "no se llegó al aviso" };
  }
}

/* ------------------------------------------------------------------ Canvas */

/** ¿Toca preguntarle a Canvas? Desde el último sync que salió bien, no desde el último intento. */
async function canvasToca(ctx: Ctx, admin: Admin, now: Date): Promise<boolean> {
  const { data } = await admin
    .from("sync_state")
    .select("last_success_at")
    .eq("user_id", ctx.userId)
    .eq("source", "canvas")
    .maybeSingle<{ last_success_at: string | null }>();
  return canvasSyncDue(data?.last_success_at, now.getTime());
}

/* ------------------------------------------------------------------ avisos */

/**
 * Manda el aviso que toca, si hay algo que decir.
 *
 * Devuelve una línea legible para el cuerpo de la respuesta.
 *
 * El orden importa: **primero se reserva el turno en `digest_log`, después se
 * arma el aviso**. Al revés, un día sin nada que decir dejaría el turno libre
 * y el reloj volvería a preguntar a las 8, a las 9 y a las 10, hasta que algo
 * apareciera y el aviso de la mañana saliera a mediodía. Con la reserva
 * primero, la decisión se toma una sola vez al día, en la primera corrida de
 * la ventana. Si el envío se cae de verdad, la reserva se devuelve.
 */
export async function avisar(
  ctx: Ctx,
  admin: Admin,
  kind: DigestKind,
  forzado: boolean,
  origin: string,
): Promise<string> {
  if (!forzado && !(await reservar(ctx, admin, kind))) return `${kind}: ya se avisó hoy`;

  const dia = kind === "night" ? addDays(ctx.today, 1) : ctx.today;

  try {
    const [tasks, events] = await Promise.all([loadTasks(ctx), loadEvents(ctx, dia, dia)]);

    const digest = buildDigest(kind, tasks, events, ctx.today);
    if (!digest) return `${kind}: nada que avisar`;

    // El título viaja en la respuesta a propósito: es lo único que permite
    // mirar el registro de Vercel y saber QUÉ se mandó, no sólo cuántos. El
    // workflow de GitHub no imprime este cuerpo, justo por eso.
    const que = ` «${digest.title}»`;

    // Los dos canales van por separado y ninguno puede tumbar al otro: un
    // Telegram caído no debe dejarte sin el push, ni al revés. Por lo mismo,
    // sus fallos se informan en la línea en vez de lanzarse — si se lanzaran,
    // la reserva se devolvería y el canal que SÍ llegó repetiría el aviso
    // dentro de una hora.
    const partes = await Promise.all([avisarPush(ctx, admin, digest), avisarTelegram(ctx, admin, digest, origin)]);

    return `${kind}: ${partes.filter(Boolean).join(" · ") || "sin canales conectados"}${que}`;
  } catch (e) {
    // Se cayó la base: devolver el turno para que el reloj lo reintente dentro
    // de una hora, mientras la ventana siga abierta.
    if (!forzado) await liberar(ctx, admin, kind);
    throw e;
  }
}

/** Push a cada navegador suscrito. Cadena vacía si push no está configurado. */
async function avisarPush(ctx: Ctx, admin: Admin, digest: Digest): Promise<string> {
  if (!pushSendConfigured()) return "";

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", ctx.userId)
    .returns<PushSubscriptionRow[]>();
  if (error) throw new IntegrationError("CRON_DB_FAILED", "No se pudieron leer las suscripciones: " + error.message, true);

  if (!subs?.length) return "push: sin navegadores suscritos";

  const r = await sendDigest(subs, digest);

  // Las suscripciones muertas se borran: si no, fallan todos los días.
  if (r.caducadas.length) {
    await admin.from("push_subscriptions").delete().eq("user_id", ctx.userId).in("endpoint", r.caducadas);
  }

  if (r.enviadas) {
    await recordRun(ctx.supabase, ctx.userId, "push", { ok: true, items: r.enviadas });
  } else {
    // Ninguno llegó. Si es porque todos estaban muertos, eso es lo que hay
    // que contar: el usuario cree que tiene avisos y ya no los tiene.
    const code = r.errorCode ?? "PUSH_SUBSCRIPTION_GONE";
    const error = r.errorCode
      ? "Ningún navegador aceptó el aviso."
      : "Tus navegadores se dieron de baja de los avisos. Vuelve a activarlos en Ajustes.";
    await recordRun(ctx.supabase, ctx.userId, "push", { ok: false, error, code });
  }
  logEvent({
    event: "digest.push", result: r.enviadas ? "ok" : "error", userId: ctx.userId, integration: "push",
    sent: r.enviadas, gone: r.caducadas.length, failed: r.fallidas, errorCode: r.errorCode,
  });

  return `push: ${r.enviadas} enviado(s)` +
    (r.caducadas.length ? `, ${r.caducadas.length} caducada(s) borrada(s)` : "") +
    (r.fallidas ? `, ${r.fallidas} fallida(s)` : "");
}

/** El chat de Telegram conectado, si hay uno. Cadena vacía si Telegram no está configurado. */
async function avisarTelegram(ctx: Ctx, admin: Admin, digest: Digest, origin: string): Promise<string> {
  if (!telegramConfigured()) return "";

  const { data: chat, error } = await admin
    .from("telegram_chats")
    .select("chat_id")
    .eq("user_id", ctx.userId)
    .not("chat_id", "is", null)
    .maybeSingle<{ chat_id: number }>();
  if (error) throw new IntegrationError("CRON_DB_FAILED", "No se pudo leer el chat de Telegram: " + error.message, true);

  if (!chat) return "telegram: sin chat conectado";

  try {
    await sendDigestTelegram(chat.chat_id, digest, origin);
    await recordRun(ctx.supabase, ctx.userId, "telegram", { ok: true });
    logEvent({ event: "digest.telegram", result: "ok", userId: ctx.userId, integration: "telegram" });
    return "telegram: enviado";
  } catch (e) {
    const t = classifyTelegramError(e);
    // Bloqueado o chat borrado: el chat está muerto y se suelta, igual que una
    // suscripción push caducada; si no, fallaría dos veces al día para siempre.
    // Pero ANTES se deja escrito por qué, para que Ajustes lo explique: antes
    // simplemente desaparecía y Victor no sabía que había dejado de recibir.
    if (t.dead) {
      await admin.from("telegram_chats").delete().eq("user_id", ctx.userId).eq("chat_id", chat.chat_id);
    }
    await recordRun(ctx.supabase, ctx.userId, "telegram", { ok: false, error: t.message, code: t.code });
    logEvent({ event: "digest.telegram", result: "error", userId: ctx.userId, integration: "telegram", errorCode: t.code });
    return t.dead ? `telegram: ${t.code}, desconectado` : `telegram: falló (${t.code})`;
  }
}

/**
 * Reserva el aviso del día. `true` si es nuestro, `false` si ya estaba.
 *
 * Quien decide no es esta función: es la clave primaria de `digest_log`. El
 * insert va con `ON CONFLICT DO NOTHING` y `.select()` devuelve sólo lo que se
 * insertó de verdad, así que una lista vacía significa "otra corrida llegó
 * antes". Es la única forma de que dos disparos simultáneos (el cron de Vercel
 * y el de GitHub caen a la misma hora) no manden el aviso dos veces.
 */
async function reservar(ctx: Ctx, admin: Admin, kind: DigestKind): Promise<boolean> {
  const { data, error } = await admin
    .from("digest_log")
    .upsert(
      { user_id: ctx.userId, day: ctx.today, kind },
      { onConflict: "user_id,day,kind", ignoreDuplicates: true },
    )
    .select("kind");
  // Si la base no contesta, no hay reserva: mejor no avisar esta hora que
  // avisar dos veces. El reloj vuelve a preguntar dentro de una hora.
  if (error) throw new IntegrationError("CRON_DB_FAILED", "No se pudo reservar el aviso: " + error.message, true);
  return Boolean(data?.length);
}

async function liberar(ctx: Ctx, admin: Admin, kind: DigestKind): Promise<void> {
  await admin
    .from("digest_log")
    .delete()
    .eq("user_id", ctx.userId)
    .eq("day", ctx.today)
    .eq("kind", kind);
}
