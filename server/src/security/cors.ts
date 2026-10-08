// CORS: cerrado por defecto.
//
// Antes era `origin: true`, que refleja CUALQUIER origen: cualquier página web podía
// pedirle datos a la API con las credenciales del navegador. No hacía falta para nada: la
// pantalla vive en el mismo origen que la API (en producción la sirve el propio servidor;
// en desarrollo el proxy de Vite reenvía `/api`). Así que sin `CORS_ORIGINS` no se permite
// ningún origen ajeno, y con ella, solo los de la lista, exactos.

export function origenesPermitidos(entorno: NodeJS.ProcessEnv = process.env): string[] {
  return (entorno.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** La opción `origin` de @fastify/cors: una función que solo acepta los de la lista. */
export function politicaCors(permitidos: string[]): (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => void {
  const set = new Set(permitidos);
  return (origin, cb) => {
    // Sin cabecera Origin (misma página, curl) no hay CORS que decidir.
    if (!origin) return cb(null, false);
    cb(null, set.has(origin.replace(/\/$/, '')));
  };
}
