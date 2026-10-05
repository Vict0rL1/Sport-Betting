// La evaluación de confianza de un partido, tal como la sirve el servidor (server/src/trust).

export interface ItemDato {
  estado: 'ok' | 'aviso' | 'desconocido';
  texto: string;
  max: number;
  puntos: number;
}

export interface EvaluacionConfianza {
  sport: string;
  matchKey: string;
  outcomes: string[];
  probs: number[];
  calidadDatos: { puntuacion: number; items: ItemDato[]; explicacion: string };
  incertidumbre: {
    ruidoRatingPp: number;
    sesgoCalibracionPp: number | null;
    nTramo: number | null;
    totalPp: number;
    rango: { bajo: number; alto: number };
    significado: string;
  };
  estabilidad: {
    nivel: 'ALTA' | 'MEDIA' | 'BAJA';
    base: number;
    escenarios: { texto: string; p: number }[];
    p10: number;
    p90: number;
    anchoPp: number;
    supuestos: string[];
    criterio: string;
  };
  desacuerdo: { nivel: 'BAJO' | 'MEDIO' | 'ALTO' | 'SIN COMPONENTES'; rangoPp: number; componentes: { nombre: string; p: number }[]; criterio: string };
  sensibilidad: { base: number; contribuciones: { etiqueta: string; pp: number }[]; final: number; metodo: string; exacta: boolean };
  mercado: {
    etiqueta: string;
    calidad: 'ALTA' | 'MEDIA' | 'BAJA' | 'SIN DATOS';
    dispersion: 'BAJA' | 'MEDIA' | 'ALTA' | null;
    casas: number;
    lineas: { seleccion: string; mejor: number; mejorCasa: string; mediana: number; peor: number; casas: number; dispersionPp: number }[];
    ultimaActualizacionMin: number | null;
    observaciones24h: number;
    horasAlInicio: number | null;
    motivos: string[];
  };
  ood: { grave: boolean; texto: string }[];
  regimen: { etiqueta: string; nota: string | null };
  confianza: { nivel: 'ALTA' | 'MEDIA' | 'BAJA'; porQue: { ok: boolean; texto: string }[]; criterio: string };
  decision: {
    decision: 'BET' | 'NO BET' | 'SIN MERCADO';
    seleccion: { indice: number; nombre: string; p: number; cuota: number; edge: number } | null;
    razones: string[];
    factorStake: number;
    recortes: { texto: string; factor: number }[];
    contrafactual: string[];
    desaparece: number | null;
  };
  deriva: string;
  nota: string;
}

export interface PrePartidoRef {
  sport: string;
  matchKey: string;
}

export interface Horizonte {
  etiqueta: string;
  marca: string;
  fila: { probs: number[]; captured_at: string; outcomes: string[] } | null;
  minutosAntesDeLaMarca: number | null;
}

export interface PrePartido {
  instantaneas: number;
  horizontes: Horizonte[];
  cambios: { desde: string; hasta: string; deltaPp: number[]; causas: string[]; atribucion: string }[];
  final: { probs: number[]; frozen_at: string; source: string } | null;
}
