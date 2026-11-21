// Clima y bullpen tal y como los sirve la API (Fase 2C). Información para la ficha; nunca
// entran en la probabilidad publicada. `DESCONOCIDO` llega con su motivo.

import { es, type Clave } from '../i18n/es';

export interface ClimaFicha {
  estado: 'previsión' | 'observado' | 'DESCONOCIDO';
  horizonte: 'T-24h' | 'T-6h' | 'T-1h' | 'final' | null;
  estadio: { nombre: string; ciudad: string; techo: 'outdoors' | 'retractable' | 'dome' } | null;
  tempC: number | null;
  vientoMph: number | null;
  lluviaMm: number | null;
  probLluvia: number | null;
  descripcion: string | null;
  /** El cielo como código estable (G2); falta en respuestas de un servidor anterior. */
  cielo?: string | null;
  fechaDato: string | null;
  motivo: string | null;
  /** El porqué de DESCONOCIDO como código estable (G2). */
  motivoCodigo?: string | null;
}

export interface BullpenFicha {
  estado: 'conocido' | 'DESCONOCIDO';
  asOf: string | null;
  relevistasUsados3d: number;
  lanzamientos3d: number;
  lanzamientos1d: number;
  cansados: { nombre: string; apariciones3d: number; lanzamientos1d: number; lanzamientos3d: number }[];
  motivo: string | null;
}

/** Los cielos que manda el servidor (server/src/weather/openMeteo.ts → CIELOS; lo comprueba clima.test.ts). */
export const CIELOS = ['sin-dato', 'despejado', 'poco-nuboso', 'cubierto', 'niebla', 'llovizna', 'lluvia', 'nieve', 'chubascos', 'chubascos-nieve', 'tormenta'] as const;
export const MOTIVOS_CLIMA = ['sin-estadio', 'sin-prevision'] as const;

const claveSiExiste = (k: string): Clave | null => (Object.prototype.hasOwnProperty.call(es, k) ? (k as Clave) : null);

/** La clave del cielo, o null si el código no se conoce (se enseña entonces el texto del servidor). */
export const claveCielo = (c: string | null | undefined): Clave | null => (c ? claveSiExiste(`clima.cielo.${c}`) : null);
export const claveMotivoClima = (m: string | null | undefined): Clave | null => (m ? claveSiExiste(`clima.motivo.${m}`) : null);

export const TECHO: Record<NonNullable<ClimaFicha['estadio']>['techo'], string> = {
  outdoors: 'al aire libre',
  retractable: 'techo retráctil',
  dome: 'cubierto',
};
