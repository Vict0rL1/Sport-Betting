import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/app/actions";
import { QUEUE, type Queued, flushQueue, readQueue } from "@/lib/offline-queue";

/**
 * La cola sin conexión no puede perder lo que escribiste: un elemento sale
 * sólo con una respuesta definitiva del servidor.
 */

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

const item = (cid: string, mode: Queued["mode"], text = "algo"): Queued => ({ cid, mode, text, at: "2026-10-06T10:00:00Z" });
const cola = (...q: Queued[]) => store.set(QUEUE, JSON.stringify(q));
const ok = (message = "ok"): ActionResult => ({ ok: true, message });

/** Un servidor de mentira: responde según el modo y anota lo que le llegó. */
function servidor(responde: (mode: string, text: string) => ActionResult | Promise<ActionResult>) {
  const llamadas: { mode: string; cid: string; text: string }[] = [];
  const send = vi.fn(async (_p: ActionResult | null, fd: FormData) => {
    const mode = String(fd.get("mode")), text = String(fd.get("text"));
    llamadas.push({ mode, cid: String(fd.get("cid")), text });
    return responde(mode, text);
  });
  return { send, llamadas };
}

describe("subir la cola sin conexión", () => {
  it("sube todo en orden y vacía la cola", async () => {
    cola(item("1", "tarea"), item("2", "nota"));
    const s = servidor(() => ok());
    expect(await flushQueue(s.send)).toEqual({ subidas: 2, comoNota: 0 });
    expect(s.llamadas.map((l) => [l.cid, l.mode])).toEqual([["1", "tarea"], ["2", "nota"]]);
    expect(store.has(QUEUE)).toBe(false);
  });

  it("si la base falla, no se tira nada: queda para la próxima", async () => {
    cola(item("1", "tarea"), item("2", "tarea"));
    const s = servidor(() => ({ ok: false, message: "No se pudo crear la tarea", retry: true }));
    expect(await flushQueue(s.send)).toEqual({ subidas: 0, comoNota: 0 });
    expect(readQueue().map((x) => x.cid)).toEqual(["1", "2"]);
    // Y no siguió golpeando la base con el resto.
    expect(s.llamadas).toHaveLength(1);
  });

  it("sin red a la mitad: lo subido sale, lo demás se queda", async () => {
    cola(item("1", "tarea"), item("2", "tarea"));
    let n = 0;
    const send = vi.fn(async () => {
      if (n++) throw new TypeError("Failed to fetch");
      return ok();
    });
    expect(await flushQueue(send)).toEqual({ subidas: 1, comoNota: 0 });
    expect(readQueue().map((x) => x.cid)).toEqual(["2"]);
  });

  it("una respuesta que no es un resultado (la sesión venció) no cuenta como subida", async () => {
    cola(item("1", "nota"));
    const send = vi.fn(async () => undefined as unknown as ActionResult);
    expect(await flushQueue(send)).toEqual({ subidas: 0, comoNota: 0 });
    expect(readQueue()).toHaveLength(1);
  });

  it("un bloque sin hora no se pierde: entra como nota con el mismo texto", async () => {
    cola(item("1", "bloque", "Estudiar econ"));
    const s = servidor((mode) => (mode === "bloque" ? { ok: false, message: "Un bloque necesita hora" } : ok("Nota guardada")));
    expect(await flushQueue(s.send)).toEqual({ subidas: 1, comoNota: 1 });
    expect(s.llamadas).toEqual([
      { mode: "bloque", cid: "1", text: "Estudiar econ" },
      { mode: "nota", cid: "1", text: "Estudiar econ" },
    ]);
    expect(store.has(QUEUE)).toBe(false);
  });

  it("si hasta como nota falla la base, se queda en la cola", async () => {
    cola(item("1", "bloque", "Estudiar econ"));
    const s = servidor((mode) => (mode === "bloque" ? { ok: false, message: "Un bloque necesita hora" } : { ok: false, message: "x", retry: true }));
    await flushQueue(s.send);
    expect(readQueue()).toHaveLength(1);
  });

  it("repetida (ya estaba guardada) también sale: el servidor contesta ok", async () => {
    cola(item("1", "tarea"));
    const s = servidor(() => ok("Esa tarea ya estaba guardada"));
    expect(await flushQueue(s.send)).toEqual({ subidas: 1, comoNota: 0 });
    expect(store.has(QUEUE)).toBe(false);
  });

  it("sin red no intenta nada", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    cola(item("1", "tarea"));
    const s = servidor(() => ok());
    expect(await flushQueue(s.send)).toEqual({ subidas: 0, comoNota: 0 });
    expect(s.llamadas).toEqual([]);
  });
});
