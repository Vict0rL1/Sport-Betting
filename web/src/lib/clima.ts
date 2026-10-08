// Clima y bullpen tal y como los sirve la API (Fase 2C). Información para la ficha; nunca
// entran en la probabilidad publicada. `DESCONOCIDO` llega con su motivo.

export interface ClimaFicha {
  estado: 'previsión' | 'observado' | 'DESCONOCIDO';
  horizonte: 'T-24h' | 'T-6h' | 'T-1h' | 'final' | null;
  estadio: { nombre: string; ciudad: string; techo: 'outdoors' | 'retractable' | 'dome' } | null;
  tempC: number | null;
  vientoMph: number | null;
  lluviaMm: number | null;
  probLluvia: number | null;
  descripcion: string | null;
  fechaDato: string | null;
  motivo: string | null;
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

export const TECHO: Record<NonNullable<ClimaFicha['estadio']>['techo'], string> = {
  outdoors: 'al aire libre',
  retractable: 'techo retráctil',
  dome: 'cubierto',
};
