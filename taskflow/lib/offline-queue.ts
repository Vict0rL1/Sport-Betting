import type { ActionResult } from "@/app/actions";

/**
 * La cola de lo que se anotó sin conexión: en esta barra o en la página
 * offline del service worker (`public/offline.html`, misma clave y formato).
 *
 * Vive en `localStorage` y se sube al volver la red. Lo que importa es no
 * perder nada: un elemento sólo sale de la cola cuando el servidor dio una
 * respuesta definitiva sobre él.
 */

export const QUEUE = "taskflow.offlineQueue";
export type Mode = "tarea" | "nota" | "bloque";
export type Queued = { cid: string; text: string; mode: Mode; at: string };

export function readQueue(): Queued[] {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE) || "[]");
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

export function writeQueue(q: Queued[]): boolean {
  try {
    if (q.length) localStorage.setItem(QUEUE, JSON.stringify(q));
    else localStorage.removeItem(QUEUE);
    return true;
  } catch {
    return false;
  }
}

type Send = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/** Para que dos pestañas (o el doble efecto de desarrollo) no suban lo mismo a la vez. */
let subiendo = false;

const form = (it: Queued, mode: Mode) => {
  const fd = new FormData();
  fd.set("text", it.text);
  fd.set("mode", mode);
  fd.set("cid", it.cid);
  return fd;
};

/** Una respuesta que no es un resultado (un redirect al login, por ejemplo) no dice nada sobre el elemento. */
const esResultado = (r: unknown): r is ActionResult => !!r && typeof r === "object" && "ok" in r;

/**
 * Sube lo anotado, de a uno y en orden. Cada uno lleva su id (`cid`), así
 * que repetir una subida que llegó pero cuya respuesta no volvió no duplica.
 *
 * - Sin red, sin sesión o con la base fallando (`retry`): se detiene y lo que
 *   falta queda para la próxima.
 * - Si no se puede guardar como lo que era (un bloque sin hora), se guarda
 *   como nota con el mismo texto: nunca se tira lo que escribiste.
 */
export async function flushQueue(send: Send): Promise<{ subidas: number; comoNota: number }> {
  const out = { subidas: 0, comoNota: 0 };
  if (subiendo || !navigator.onLine) return out;
  subiendo = true;
  try {
    for (const it of readQueue()) {
      let r: unknown;
      try {
        r = await send(null, form(it, it.mode));
        if (esResultado(r) && !r.ok && !r.retry && it.mode !== "nota" && it.text.trim()) {
          r = await send(null, form(it, "nota"));
          if (esResultado(r) && r.ok) out.comoNota++;
        }
      } catch {
        break; // sin red otra vez
      }
      if (!esResultado(r) || (!r.ok && r.retry)) break;
      writeQueue(readQueue().filter((x) => x.cid !== it.cid));
      if (r.ok) out.subidas++;
    }
  } finally {
    subiendo = false;
  }
  return out;
}
