import Link from "next/link";
import { sendTestPush, sendTestTelegram, syncCanvasNow } from "@/app/actions";
import { PushDeviceStatus } from "@/components/PushDeviceStatus";
import { RunButton } from "@/components/RunButton";
import { StatusBadge } from "@/components/StatusBadge";
import { ViewHead } from "@/components/TaskRow";
import { aiModel } from "@/lib/ai";
import { getCtx } from "@/lib/data";
import { fmtClock, fmtStamp } from "@/lib/date";
import { canvasConfigured, plannerConfigured, pushSendConfigured, telegramConfigured } from "@/lib/env.server";
import { type IntegrationHealth, type Source, type StateRow, ago, nextCanvasSync, nextClockTick } from "@/lib/health";
import { loadStatus } from "@/lib/status";
import { recentAiCost } from "@/lib/activity";
import { isFailing } from "@/lib/sync-state";

export const metadata = { title: "Estado del sistema · TaskFlow" };

/**
 * Ajustes → Estado del sistema.
 *
 * Una fila por cosa que corre sola, con lo justo para saber si funciona y,
 * si no, desde cuándo y qué hacer. Ninguna llave sale de aquí: sólo si está
 * puesta o no.
 */
export default async function EstadoPage() {
  const ctx = await getCtx();
  const [status, pendientes, costo] = await Promise.all([
    loadStatus(ctx),
    ctx.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId)
      .eq("source", "canvas")
      .eq("done", false)
      .is("deleted_at", null)
      .then((r) => r.count ?? 0),
    recentAiCost(ctx),
  ]);

  const { health, states, now } = status;
  const h = (k: Source) => health.items.find((i) => i.key === k)!;
  const when = (iso: string | null | undefined) => (iso ? `${fmtStamp(iso, ctx.tz)} (${ago(iso, now)})` : "nunca");
  const cronOk = h("cron").level === "ok";

  return (
    <>
      <ViewHead
        eyebrow="ajustes"
        title="Estado del sistema"
        right={<Link className="btn line sm" href="/ajustes">Volver a Ajustes</Link>}
      />

      <p className="stintro">
        {health.alerts.length
          ? `${health.alerts.length} cosa${health.alerts.length > 1 ? "s" : ""} que revisar.`
          : "Todo lo que corre solo está funcionando."}
      </p>

      <div className="stgrid">
        <Row item={h("cron")}>
          <dt>Última ejecución recibida</dt>
          <dd>{when(states.cron?.last_synced_at)}</dd>
          <dt>Última completa</dt>
          <dd>{when(states.cron?.last_success_at)}</dd>
          <dt>Próxima esperada</dt>
          <dd>hacia las {fmtClock(nextClockTick(now), ctx.tz)} (cada hora, al minuto 7 UTC)</dd>
          <LastError s={states.cron} tz={ctx.tz} now={now} />
          {h("cron").level === "warn" || h("cron").level === "error" ? (
            <p className="sthelp">
              El reloj es un workflow de GitHub Actions. Si se detuvo, revisa la pestaña <b>Actions</b> del
              repositorio: GitHub desactiva los workflows programados después de 60 días sin commits, y
              falla si faltan los secretos <code>APP_URL</code> o <code>CRON_SECRET</code>.
            </p>
          ) : null}
        </Row>

        <Row
          item={h("canvas")}
          actions={
            canvasConfigured() ? (
              <RunButton action={syncCanvasNow} label="Sincronizar ahora" busy="Sincronizando…" />
            ) : null
          }
        >
          <dt>Conectado</dt>
          <dd>{canvasConfigured() ? "sí (el token vive en el servidor)" : "no — falta CANVAS_TOKEN"}</dd>
          <dt>Última sincronización</dt>
          <dd>{when(states.canvas?.last_synced_at)}</dd>
          <dt>Última correcta</dt>
          <dd>{when(states.canvas?.last_success_at)}</dd>
          <dt>Deadlines pendientes</dt>
          <dd>{pendientes}</dd>
          {canvasConfigured() ? (
            <>
              <dt>Próxima (aprox.)</dt>
              <dd>
                {cronOk
                  ? `hacia las ${fmtClock(nextCanvasSync(states.canvas?.last_success_at, now), ctx.tz)}`
                  : "cuando el reloj vuelva a correr"}
              </dd>
            </>
          ) : null}
          <LastError s={states.canvas} tz={ctx.tz} now={now} />
        </Row>

        <Row
          item={h("push")}
          actions={
            pushSendConfigured() ? (
              <RunButton
                action={sendTestPush}
                label="Enviar notificación de prueba"
                busy="Enviando…"
                disabled={!status.pushEndpoints.length}
              />
            ) : null
          }
        >
          <dt>Servidor</dt>
          <dd>{pushSendConfigured() ? "llaves VAPID puestas" : "faltan las llaves VAPID"}</dd>
          <dt>Dispositivos suscritos</dt>
          <dd>{status.pushEndpoints.length}</dd>
          <dt>Este navegador</dt>
          <PushDeviceStatus endpoints={status.pushEndpoints} />
          <dt>Último aviso enviado</dt>
          <dd>{when(states.push?.last_synced_at)}</dd>
          <dt>Último aceptado por el servicio de push</dt>
          <dd>{when(states.push?.last_success_at)}</dd>
          <LastError s={states.push} tz={ctx.tz} now={now} />
        </Row>

        <Row
          item={h("telegram")}
          actions={
            telegramConfigured() && status.telegramLinkedAt ? (
              <RunButton action={sendTestTelegram} label="Enviar mensaje de prueba" busy="Enviando…" />
            ) : null
          }
        >
          <dt>Conectado</dt>
          <dd>
            {!telegramConfigured() ? "no — falta TELEGRAM_BOT_TOKEN" : status.telegramLinkedAt ? `desde ${fmtStamp(status.telegramLinkedAt, ctx.tz)}` : "sin chat (se conecta en Ajustes)"}
          </dd>
          <dt>Último mensaje</dt>
          <dd>{when(states.telegram?.last_success_at)}</dd>
          <LastError s={states.telegram} tz={ctx.tz} now={now} />
        </Row>

        <Row item={h("ai")}>
          <dt>Activado</dt>
          <dd>{plannerConfigured() ? "sí" : "no — falta ANTHROPIC_API_KEY"}</dd>
          <dt>Modelo</dt>
          <dd className="mono">{aiModel()}</dd>
          <dt>Último uso</dt>
          <dd>{when(states.ai?.last_synced_at)}</dd>
          <dt>Costo aprox. (30 días)</dt>
          <dd>
            {costo.calls
              ? `$${costo.usd < 0.01 ? costo.usd.toFixed(4) : costo.usd.toFixed(2)} en ${costo.calls} propuesta${costo.calls > 1 ? "s" : ""}`
              : "$0 — sin propuestas"}
          </dd>
          <LastError s={states.ai} tz={ctx.tz} now={now} />
        </Row>
      </div>
    </>
  );
}

function Row({ item, actions, children }: { item: IntegrationHealth; actions?: React.ReactNode; children: React.ReactNode }) {
  const id = "st-" + item.key;
  return (
    <section className={"panel strow " + item.level} aria-labelledby={id}>
      <div className="ph">
        <h2 id={id}>{item.label}</h2>
        <StatusBadge level={item.level} />
      </div>
      <div className="pb">
        <p className="stsum">{item.summary}</p>
        <dl className="kv">{children}</dl>
        {actions ? <div className="stactions">{actions}</div> : null}
      </div>
    </section>
  );
}

/** El último error, si lo hubo. Si ya se resolvió, se dice. */
function LastError({ s, tz, now }: { s?: StateRow; tz: string; now: number }) {
  if (!s?.last_error || !s.last_error_at) return null;
  return (
    <>
      <dt>Último error</dt>
      <dd className={isFailing(s) ? "sterr" : undefined}>
        {s.last_error}
        <span className="stwhen">
          {" "}— {fmtStamp(s.last_error_at, tz)} ({ago(s.last_error_at, now)})
          {s.last_error_code ? <code> {s.last_error_code}</code> : null}
          {isFailing(s) ? "" : " · resuelto"}
        </span>
      </dd>
    </>
  );
}
