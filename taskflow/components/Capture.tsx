"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { capture } from "@/app/actions";
import { fmtDur, fmtDate, minsToHHMM } from "@/lib/date";
import { parseInput } from "@/lib/parse";
import { type Mode, flushQueue, readQueue, writeQueue } from "@/lib/offline-queue";
import { Toast } from "./Toast";

const PLACEHOLDER: Record<Mode, string> = {
  tarea: "Escribe y presiona Enter…",
  nota: "Suelta la idea…",
  bloque: "Estudiar econ 3pm 90m",
};

const PRIO = ["", "alta", "media", "baja"];

const nuevoId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));

/** La barra de captura rápida. El parser corre aquí en vivo y otra vez en el servidor. */
export function Capture({ areas, today }: { areas: string[]; today: string }) {
  const [mode, setMode] = useState<Mode>("tarea");
  const [text, setText] = useState("");
  const [state, formAction, pending] = useActionState(capture, null);
  const [local, setLocal] = useState<{ ok: boolean; message: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Al abrir y al volver la red, se sube lo anotado sin conexión (aquí o en
  // la página offline).
  useEffect(() => {
    async function subir() {
      const { subidas: n, comoNota } = await flushQueue(capture);
      if (n) {
        setLocal({
          ok: true,
          message: `Se subieron ${n} captura${n > 1 ? "s" : ""} guardada${n > 1 ? "s" : ""} sin conexión` +
            (comoNota ? ` (${comoNota} como nota, porque no se podía${comoNota > 1 ? "n" : ""} guardar como estaba${comoNota > 1 ? "n" : ""})` : ""),
        });
      }
    }
    void subir();
    window.addEventListener("online", subir);
    return () => window.removeEventListener("online", subir);
  }, []);

  // Sin red, la captura no se pierde: queda en el dispositivo. Con red, va con
  // su propio id, para que un reintento no la duplique.
  function enviar(fd: FormData) {
    const cid = nuevoId();
    if (!navigator.onLine) {
      const t = String(fd.get("text") ?? "").trim();
      if (!t) return;
      const ok = writeQueue([...readQueue(), { cid, text: t.slice(0, 500), mode, at: new Date().toISOString() }]);
      setLocal(ok
        ? { ok: true, message: "Sin conexión: quedó guardada en este dispositivo y se sube al volver la red" }
        : { ok: false, message: "Sin conexión, y este navegador no deja guardar nada" });
      if (ok) setText("");
      return;
    }
    fd.set("cid", cid);
    formAction(fd);
  }

  // Vacía el campo sólo si el guardado salió bien: si falló, el texto se queda
  // para corregirlo en vez de perderse. Ajuste en render, no en un efecto.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setText("");
  }

  // "Nueva tarea" / "Nueva nota" desde la paleta (⌘K) o desde los atajos del
  // ícono instalado (`?capturar=nota`).
  useEffect(() => {
    function onCapture(e: Event) {
      const m = (e as CustomEvent<{ mode?: Mode }>).detail?.mode;
      if (m === "tarea" || m === "nota" || m === "bloque") setMode(m);
      // Después de que el diálogo devuelva el foco.
      setTimeout(() => input.current?.focus(), 0);
    }
    window.addEventListener("taskflow:capture", onCapture);
    const pedido = new URLSearchParams(window.location.search).get("capturar");
    if (pedido) window.dispatchEvent(new CustomEvent("taskflow:capture", { detail: { mode: pedido } }));
    return () => window.removeEventListener("taskflow:capture", onCapture);
  }, []);

  // "/" enfoca la captura, como en el reference.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <form className="capture" action={enviar} data-pending={pending}>
        <input type="hidden" name="mode" value={mode} />

        <div className="seg" role="group" aria-label="Tipo de captura">
          {(["tarea", "nota", "bloque"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m);
                input.current?.focus();
              }}
            >
              {m === "tarea" ? "Tarea" : m === "nota" ? "Nota" : "Bloque"}
            </button>
          ))}
        </div>

        <input
          ref={input}
          type="text"
          name="text"
          autoComplete="off"
          placeholder={PLACEHOLDER[mode]}
          value={text}
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
        />

        <button className="btn" type="submit" disabled={pending || !text.trim()}>
          {pending ? "Guardando…" : "Agregar"}
        </button>

        <div className="hint">
          <span className="hinttext">
            <Hint raw={text} mode={mode} areas={areas} today={today} />
          </span>
          <button
            type="button"
            className="palbtn"
            onClick={() => window.dispatchEvent(new Event("taskflow:palette"))}
            aria-label="Buscar y comandos (Ctrl+K)"
            title="Buscar y comandos (Ctrl+K)"
          >
            Buscar <kbd>⌘K</kbd>
          </button>
        </div>
      </form>
      <Toast result={state} />
      <Toast result={local} />
    </>
  );
}

function Hint({ raw, mode, areas, today }: { raw: string; mode: Mode; areas: string[]; today: string }) {
  if (!raw.trim()) {
    return (
      <>
        <b>#area</b> · <b>!alta</b> · <b>mañana</b> / <b>vie</b> / <b>22 oct</b> · <b>3pm</b> ·{" "}
        <b>45m</b>
      </>
    );
  }

  // Una nota se guarda tal cual; no tiene sentido mostrarle campos parseados.
  if (mode === "nota") return <>→ se guarda tal cual</>;

  const p = parseInput(raw, { areas, today });
  const bits: React.ReactNode[] = [];
  if (p.area) bits.push(<>área <b>{p.area}</b></>);
  if (p.due) bits.push(<>para <b>{fmtDate(p.due, today)}</b></>);
  if (p.start !== null) bits.push(<>a las <b>{minsToHHMM(p.start)}</b></>);
  if (p.dur) bits.push(<><b>{fmtDur(p.dur)}</b></>);
  if (p.prio) bits.push(<>prioridad <b>{PRIO[p.prio]}</b></>);

  if (!bits.length) return null;

  return (
    <>
      → {p.title} —{" "}
      {bits.map((b, i) => (
        <span key={i}>
          {i > 0 ? " · " : ""}
          {b}
        </span>
      ))}
    </>
  );
}
