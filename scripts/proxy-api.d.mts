// Tipos de proxy-api.mjs (web/vite.config.ts la importa con `strict` y sin allowJs; ver ports.d.mts).

/** Destino del proxy de /api y si se cambia el Host: no hacia la API local, sí hacia VITE_API_BASE. */
export function proxyDeApi(entorno: Record<string, string | undefined>, puertoPorDefecto: number): { target: string; changeOrigin: boolean };
