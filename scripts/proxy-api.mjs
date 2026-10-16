// Adónde manda Vite las llamadas a /api, y si cambia el Host por el camino (lote J, J1).
//
// Hacia la API local NO se cambia: la app comprueba que el Origin de un POST sea su propio
// host:puerto (server/src/security/origen.ts), y con `changeOrigin` el móvil en la misma wifi
// (Origin http://192.168.x.y:7373) llegaba con Host 127.0.0.1:7374 y se le negaba hasta entrar.
// Hacia otra máquina (VITE_API_BASE) sí: ese servidor espera su propio nombre. Un VITE_API_BASE que
// apunta a esta misma máquina sigue siendo la API local.

const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** `{ target, changeOrigin }` para el proxy de /api. */
export function proxyDeApi(entorno = process.env, puertoPorDefecto) {
  const base = entorno.VITE_API_BASE?.trim();
  // 127.0.0.1 y no «localhost»: la API escucha en IPv4 (scripts/escucha.mjs) y «localhost» puede
  // resolverse primero a ::1.
  const target = base || `http://127.0.0.1:${Number(entorno.PORT) || puertoPorDefecto}`;
  let remota = false;
  try {
    remota = !!base && !LOCAL.has(new URL(base).hostname.toLowerCase());
  } catch {
    remota = !!base;
  }
  return { target, changeOrigin: remota };
}
