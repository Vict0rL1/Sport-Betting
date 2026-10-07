// Esquemas de respuesta (JSON Schema, el dialecto que entiende Fastify) para las rutas
// operativas, y un validador estructural propio para el test de contrato. Lo que cambie la
// forma de una de estas respuestas rompe el test antes de que lo descubra la pantalla.

export type Esquema = {
  type?: string | string[];
  properties?: Record<string, Esquema>;
  required?: string[];
  items?: Esquema;
  nullable?: boolean;
  additionalProperties?: boolean | Esquema;
  enum?: unknown[];
  description?: string;
};

const o = (properties: Record<string, Esquema>, required: string[] = Object.keys(properties), extra = false): Esquema => ({ type: 'object', properties, required, additionalProperties: extra });
const nullable = (type: string): Esquema => ({ type, nullable: true });
const str: Esquema = { type: 'string' };
const num: Esquema = { type: 'number' };
const bool: Esquema = { type: 'boolean' };
const int: Esquema = { type: 'integer' };

export const ESQUEMA_ERROR = o({ error: str });
export const ESQUEMA_HEALTH = o({ ok: bool });
export const ESQUEMA_READY = o({ ok: bool, migraciones: str, trabajos: str, detalle: { type: 'array', items: str } });
export const ESQUEMA_FEATURE = o({ on: bool, activa: bool, descripcion: str, falta: nullable('string'), anulada: bool });
export const ESQUEMA_FEATURES = o({ features: { type: 'object', additionalProperties: ESQUEMA_FEATURE } });
export const ESQUEMA_ESTADO = o({
  generado: str,
  cuotas: o({ modo: { type: 'string', enum: ['real', 'demo'] }, clave: bool, restantes: nullable('number'), plan: nullable('number'), ultimaConsulta: nullable('string'), error: nullable('string') }),
  deportes: { type: 'array', items: o({ sport: str, datosHasta: nullable('string'), proximos: int, ultimaCuota: nullable('string') }) },
  resultados: o({ ultima: nullable('string'), estado: nullable('string') }),
  copia: o({ ultima: nullable('string') }),
  errores24h: int,
  trabajosConError: int,
});
export const ESQUEMA_ERRORES = o({ errores: { type: 'array', items: o({ id: int, created_at: str, request_id: nullable('string'), method: nullable('string'), url: nullable('string'), status: int, message: str }) }, total24h: int });
export const ESQUEMA_AJUSTES = o({ ajustes: o({ deportesOcultos: { type: 'array', items: str }, tema: { type: 'string', enum: ['auto', 'oscuro', 'claro'] }, idioma: { type: 'string', enum: ['es', 'en'] }, bancoPersonal: nullable('number'), recorridoVisto: bool }), idiomaNavegador: { type: 'string', enum: ['es', 'en'] } });
export const ESQUEMA_SEGUIDO = o({ id: int, kind: { type: 'string', enum: ['equipo', 'jugador', 'partido'] }, sport: str, league: nullable('string'), ref_id: str, label: str, created_at: str });
export const ESQUEMA_WATCHLIST = o({ seguidos: { type: 'array', items: ESQUEMA_SEGUIDO } });
export const ESQUEMA_DATOS_ESTADO = o({
  layout: { type: 'string', enum: ['split', 'single'] },
  history: o({ ruta: str, mb: nullable('number') }),
  ledger: { ...o({ ruta: str, mb: nullable('number') }), nullable: true },
  backup: { type: 'object', additionalProperties: true },
  retencion: o({ ultima: nullable('string'), borradas: num }),
});
export const ESQUEMA_EJECUCION = o({
  id: int, source: str, started_at: str, finished_at: nullable('string'), status: { type: 'string', enum: ['running', 'ok', 'error'] },
  rows_added: nullable('integer'), rows_updated: nullable('integer'), error: nullable('string'), detail: nullable('string'),
});
export const ESQUEMA_INGESTION_RUNS = o({ ultimas: { type: 'array', items: ESQUEMA_EJECUCION }, historial: { type: 'array', items: ESQUEMA_EJECUCION } });
export const ESQUEMA_TRABAJO = o({
  nombre: str, descripcion: str, cadenciaMin: num, cadenciaPorDefecto: num, enabled: bool, lastRunAt: nullable('string'), lastDurationMs: nullable('integer'),
  lastStatus: nullable('string'), lastError: nullable('string'), nextRunAt: nullable('string'), runsOk: int, runsError: int,
});
export const ESQUEMA_SCHEDULER = o({ arrancado: bool, trabajos: { type: 'array', items: ESQUEMA_TRABAJO } });
export const ESQUEMA_POLICY_VERSION = o({ id: int, created_at: str, parent_id: nullable('integer'), hash: str, nota: nullable('string'), origen: str, config: { type: 'object', additionalProperties: true } });
export const ESQUEMA_POLICY = o({ vigente: ESQUEMA_POLICY_VERSION, historial: { type: 'array', items: ESQUEMA_POLICY_VERSION } });
export const ESQUEMA_CANAL = o({ nombre: str, configurado: bool, falta: { type: 'array', items: str }, descripcion: str });
export const ESQUEMA_CANALES = o({ canales: { type: 'array', items: ESQUEMA_CANAL }, ultimos: { type: 'array', items: { type: 'object', additionalProperties: true } } });
export const ESQUEMA_AVISO_MUESTRA = o({ nivel: { type: 'string', enum: ['insuficiente', 'orientativa', 'suficiente'] }, texto: nullable('string') });
export const ESQUEMA_CUBETA = o({ desde: num, hasta: num, n: int, predicha: nullable('number'), observada: nullable('number') });
export const ESQUEMA_DIAGRAMA = o({
  origen: { type: 'string', enum: ['backtest', 'live'] }, deporte: str, partidos: int, cubetas: { type: 'array', items: ESQUEMA_CUBETA },
  ece: nullable('number'), aviso: ESQUEMA_AVISO_MUESTRA, generado: str, model_version: nullable('string'),
});
export const ESQUEMA_FIABILIDAD = o({ backtest: { ...ESQUEMA_DIAGRAMA, nullable: true }, live: ESQUEMA_DIAGRAMA });
export const ESQUEMA_CELDA_PREDICCION = o({ n: int, acierto: nullable('number'), brier: nullable('number'), logLoss: nullable('number'), publicada: bool });
export const ESQUEMA_CELDA_APUESTAS = o({ n: int, conCierre: int, clvMedio: nullable('number'), roi: nullable('number'), publicada: bool });
export const ESQUEMA_SEGMENTOS = o({
  deporte: str, generado: str,
  predicciones: o({ n: int, dimensiones: { type: 'object', additionalProperties: { type: 'object', additionalProperties: ESQUEMA_CELDA_PREDICCION } } }),
  apuestas: o({ n: int, dimensiones: { type: 'object', additionalProperties: { type: 'object', additionalProperties: ESQUEMA_CELDA_APUESTAS } } }),
  umbrales: o({ predicciones: int, apuestas: int }),
});
export const ESQUEMA_PUNTO_SERIE = o({ dia: str, n: int, logLoss: nullable('number'), brier: nullable('number'), psi: nullable('number') });
export const ESQUEMA_MONITORIZACION = o({
  deporte: str, ventanaDias: int, serie: { type: 'array', items: ESQUEMA_PUNTO_SERIE }, actual: { ...ESQUEMA_PUNTO_SERIE, nullable: true },
  referencia: { ...o({ logLoss: nullable('number'), brier: nullable('number'), n: int }), nullable: true },
  deriva: o({ hay: bool, motivos: { type: 'array', items: str }, n: int, aviso: ESQUEMA_AVISO_MUESTRA }),
  umbrales: o({ psi: num, erroresTipicos: num, minVentana: int }), generado: str,
});
export const ESQUEMA_CLASIFICACION = o({ puntos: num, jugados: int, victorias: int, empates: int, derrotas: int });
export const ESQUEMA_EQUIPO_SIMULADO = o({
  id: str, nombre: str, grupo: nullable('string'), actual: ESQUEMA_CLASIFICACION, puntosEsperados: num, victoriasEsperadas: num,
  titulo: num, top: num, descenso: num, posiciones: { type: 'array', items: num },
});
export const ESQUEMA_SIMULACION = o({
  sport: str, league: str, season: nullable('integer'), generado: str, corridas: int, semilla: int, etiqueta: str,
  reglas: { type: 'object', additionalProperties: true, nullable: true },
  calendario: o({ origen: { type: 'string', enum: ['fuente', 'reconstruido', 'ninguno'] }, fuente: nullable('string'), pendientes: int, sinProbabilidad: int, nota: nullable('string') }),
  jugados: int, equipos: { type: 'array', items: ESQUEMA_EQUIPO_SIMULADO }, motivo: nullable('string'),
});
export const ESQUEMA_TORNEO = o({
  cuadroDisponible: bool, motivo: str, etiqueta: str, semilla: int,
  siguientes: { type: 'array', items: o({ torneo: nullable('string'), superficie: nullable('string'), cuando: str, p1: str, p2: str, prob1: nullable('number') }) },
});
export const ESQUEMA_COMBINADA = o({
  patas: int, independiente: num, conjunta: num, factorCorrelacion: num,
  vinculos: { type: 'array', items: o({ a: str, b: str, rho: num, motivo: str }) }, incompatibles: { type: 'array', items: str },
  cuotaCombinada: nullable('number'), cuotaJusta: nullable('number'), ventaja: nullable('number'), etiqueta: str,
});
const EVENTO_MERCADO = { eventId: str, sport: str, league: str, market: str, partido: str, cuando: nullable('string') };
export const ESQUEMA_INTEL = o({
  generado: str, ventanaHoras: int, eventos: int,
  steam: { type: 'array', items: o({ ...EVENTO_MERCADO, seleccion: str, desde: num, hasta: num, movimientoPp: num, minutos: int, casas: int, observadoEn: str }) },
  surebets: { type: 'array', items: o({ ...EVENTO_MERCADO, suma: num, margenPct: num, patas: { type: 'array', items: o({ seleccion: str, cuota: num, casa: str }) } }) },
  referencia: { type: 'array', items: o({ ...EVENTO_MERCADO, casa: str, selecciones: { type: 'array', items: o({ seleccion: str, referencia: num, consenso: num, desviacionPp: num }) }, observadoEn: str }) },
  etiqueta: str,
});
export const ESQUEMA_HISTORIA_ELO = o({ sport: str, league: str, teamId: str, puntos: { type: 'array', items: o({ fecha: str, elo: num, rival: str, local: bool }) }, generado: str, nota: str });
export const ESQUEMA_HISTORIAL_SIMULACION = o({ sport: str, league: str, dias: { type: 'array', items: o({ dia: str, equipos: { type: 'array', items: o({ id: str, nombre: str, titulo: num, top: num, descenso: num, puntosEsperados: num }) } }) } });
export const ESQUEMA_RESULTADO = o({ sport: str, matchKey: str, casa: str, fuera: str, cuando: nullable('string'), probabilidades: { type: 'array', items: num }, resuelto: bool, resultado: { type: ['string', 'null'], enum: ['casa', 'empate', 'fuera', null] }, marcador: nullable('string'), probabilidadDada: nullable('number'), acerto: { type: ['boolean', 'null'] } });
export const ESQUEMA_BUSQUEDA = o({ q: str, resultados: { type: 'array', items: o({ tipo: { type: 'string', enum: ['equipo', 'jugador', 'partido', 'liga'] }, sport: str, league: nullable('string'), id: str, etiqueta: str, detalle: nullable('string'), ruta: str }) } });
export const ESQUEMA_CUOTAS_POR_CASA = o({ eventId: str, market: str, casas: { type: 'array', items: str }, series: { type: 'array', items: o({ casa: str, seleccion: str, puntos: { type: 'array', items: o({ at: str, cuota: num }) } }) } });
export const ESQUEMA_EXPORT_JSON = o({ dataset: str, filas: int, columnas: { type: 'array', items: str }, datos: { type: 'array', items: { type: 'object', additionalProperties: true } } });

/** Comprueba que `valor` cumple `esquema`. Devuelve los problemas (vacío = cumple). */
export function validar(valor: unknown, esquema: Esquema, ruta = '$'): string[] {
  const problemas: string[] = [];
  if (valor === null || valor === undefined) {
    if (esquema.nullable || (Array.isArray(esquema.type) && esquema.type.includes('null'))) return [];
    return [`${ruta}: es null y el esquema no lo permite`];
  }
  const tipos = Array.isArray(esquema.type) ? esquema.type : esquema.type ? [esquema.type] : [];
  const tipoReal = Array.isArray(valor) ? 'array' : typeof valor === 'number' ? (Number.isInteger(valor) ? 'integer' : 'number') : typeof valor;
  const compatible = tipos.length === 0 || tipos.some((t) => t === tipoReal || (t === 'number' && tipoReal === 'integer'));
  if (!compatible) return [`${ruta}: es ${tipoReal}, se esperaba ${tipos.join('|')}`];
  if (esquema.enum && !esquema.enum.includes(valor)) problemas.push(`${ruta}: ${JSON.stringify(valor)} no está en ${JSON.stringify(esquema.enum)}`);
  if (tipoReal === 'object' && esquema.type === 'object') {
    const obj = valor as Record<string, unknown>;
    for (const k of esquema.required ?? []) if (!(k in obj)) problemas.push(`${ruta}.${k}: falta`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = esquema.properties?.[k];
      if (sub) problemas.push(...validar(v, sub, `${ruta}.${k}`));
      else if (esquema.additionalProperties === false) problemas.push(`${ruta}.${k}: propiedad no prevista`);
      else if (typeof esquema.additionalProperties === 'object') problemas.push(...validar(v, esquema.additionalProperties, `${ruta}.${k}`));
    }
  }
  if (tipoReal === 'array' && esquema.items) (valor as unknown[]).forEach((x, i) => problemas.push(...validar(x, esquema.items!, `${ruta}[${i}]`)));
  return problemas;
}

// --- Fase 6: laboratorio de estrategias ---
const objetoLibre: Esquema = { type: 'object', additionalProperties: true };
const objetoLibreONulo: Esquema = { type: 'object', additionalProperties: true, nullable: true };
const ESQUEMA_AVISO = o({ nivel: { type: 'string', enum: ['insuficiente', 'orientativa', 'suficiente'] }, texto: nullable('string') });
export const ESQUEMA_ESTRATEGIA = o({ id: int, created_at: str, nombre: str, config: objetoLibre, hash: str, nota: nullable('string'), archived_at: nullable('string') });
export const ESQUEMA_FILA_COMPARACION = o({
  id: nullable('integer'), nombre: str, archivada: bool, config: objetoLibreONulo, banco: num, beneficio: num, apuestas: int, liquidadas: int,
  pendientes: int, ganadas: int, perdidas: int, roi: nullable('number'), acierto: nullable('number'), clvMedio: nullable('number'), conCierre: int,
  drawdown: objetoLibreONulo, aviso: ESQUEMA_AVISO, comparable: bool, curva: { type: 'array', items: o({ t: str, banco: num }) },
});
export const ESQUEMA_ESTRATEGIAS = o({
  estrategias: { type: 'array', items: ESQUEMA_ESTRATEGIA },
  comparacion: o({ filas: { type: 'array', items: ESQUEMA_FILA_COMPARACION }, nota: str }),
  historicos: { type: 'array', items: o({ sport: str, partidos: int, generado: nullable('string'), fuente: nullable('string') }) },
  limites: o({ maxActivas: int, deportes: { type: 'array', items: str }, mercados: { type: 'array', items: str } }),
  politica: objetoLibre,
});
export const ESQUEMA_HISTORICO_ESTRATEGIA = o({
  sport: str, disponible: bool, motivo: nullable('string'), fuente: nullable('string'), generado: nullable('string'), partidos: int,
  desde: nullable('string'), hasta: nullable('string'), temporadas: objetoLibreONulo, apuestas: int, ganadas: int, beneficio: num, bancoFinal: num, roi: nullable('number'),
  acierto: nullable('number'), drawdown: objetoLibreONulo, clvMedio: nullable('number'), conClv: int, aviso: ESQUEMA_AVISO,
  curva: { type: 'array', items: o({ fecha: str, banco: num }) },
  porTemporada: { type: 'array', items: o({ temporada: str, apuestas: int, beneficio: num, roi: nullable('number') }) },
  notas: { type: 'array', items: str },
});
export const ESQUEMA_APUESTAS_ESTRATEGIA = o({ apuestas: { type: 'array', items: objetoLibre } });

// --- Fase 6: bandeja e informes ---
export const ESQUEMA_AVISO_BANDEJA = o({
  id: int, created_at: str, origen: { type: 'string', enum: ['notificacion', 'alerta'] }, tipo: str, severidad: { type: 'string', enum: ['info', 'aviso', 'importante'] },
  sport: nullable('string'), match_key: nullable('string'), titulo: str, cuerpo: str, url: nullable('string'), alert_id: nullable('integer'), leida_at: nullable('string'),
});
export const ESQUEMA_BANDEJA = o({ avisos: { type: 'array', items: ESQUEMA_AVISO_BANDEJA }, noLeidas: int, tipos: { type: 'array', items: o({ tipo: str, n: int }) }, hayMas: bool });
export const ESQUEMA_CONTADOR_BANDEJA = o({ noLeidas: int });
export const ESQUEMA_MARCADAS = o({ marcadas: int, noLeidas: int });
const RESUMEN_INFORME = { id: int, tipo: { type: 'string', enum: ['diario', 'semanal'] }, periodo: str, created_at: str, titulo: str, resumen: str };
export const ESQUEMA_RESUMEN_INFORME = o(RESUMEN_INFORME);
export const ESQUEMA_INFORMES = o({ informes: { type: 'array', items: ESQUEMA_RESUMEN_INFORME }, zona: str, pdf: bool, diario: bool, semanal: bool });
export const ESQUEMA_INFORME = o({ ...RESUMEN_INFORME, markdown: str, datos: objetoLibre, pdf: bool });
export const ESQUEMA_INFORME_GENERADO = o({ id: int, nuevo: bool, periodo: str });
