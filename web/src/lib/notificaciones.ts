// Notificaciones (Fase 3.6): canales configurados en el servidor, «enviar prueba» y la
// suscripción Web Push del navegador. Todo contra /api/notifications.

export interface CanalVista {
  nombre: string;
  configurado: boolean;
  falta: string[];
  descripcion: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status}`);
  return (await res.json()) as T;
}

export const canales = () => json<{ canales: CanalVista[] }>('/api/notifications/canales');
export const probar = (canal: string) => json<{ ok: boolean; canal: string; error: string | null }>(`/api/notifications/test/${canal}`, { method: 'POST' });

function base64aUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** ¿Puede este navegador recibir Web Push? */
export const pushDisponible = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;

export async function suscripcionActual(): Promise<PushSubscription | null> {
  if (!pushDisponible()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Pide permiso, se suscribe con la clave VAPID del servidor y guarda la suscripción. */
export async function activarPush(): Promise<{ ok: boolean; motivo?: string }> {
  if (!pushDisponible()) return { ok: false, motivo: 'este navegador no soporta notificaciones push' };
  const { clave } = await json<{ clave: string | null }>('/api/notifications/push/clave');
  if (!clave) return { ok: false, motivo: 'el servidor no tiene VAPID_PUBLIC_KEY (npm run vapid:generar)' };
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return { ok: false, motivo: 'permiso denegado en el navegador' };
  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64aUint8(clave) as BufferSource });
  const j = sub.toJSON();
  await json('/api/notifications/push/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }) });
  return { ok: true };
}

export async function desactivarPush(): Promise<void> {
  const sub = await suscripcionActual();
  if (!sub) return;
  await json('/api/notifications/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
  await sub.unsubscribe();
}
