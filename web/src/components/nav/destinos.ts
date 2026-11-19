import { RUTA_DE_PESTANA, RUTA_PARTIDOS } from '../../rutas';

const RUTAS = [RUTA_PARTIDOS, RUTA_DE_PESTANA.trust, RUTA_DE_PESTANA.bets];

/** El destino principal al que pertenece una ruta (Partidos, Rendimiento, Mis apuestas), o null. */
export function destinoPrincipal(pathname: string): string | null {
  for (const r of RUTAS) if (pathname === r || pathname.startsWith(r + '/')) return r;
  return null;
}
