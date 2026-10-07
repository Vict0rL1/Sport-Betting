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
export const ESQUEMA_FEATURES = o({ features: { type: 'object', additionalProperties: o({ on: bool, activa: bool, descripcion: str, falta: nullable('string') }) } });
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
  nombre: str, descripcion: str, cadenciaMin: num, enabled: bool, lastRunAt: nullable('string'), lastDurationMs: nullable('integer'),
  lastStatus: nullable('string'), lastError: nullable('string'), nextRunAt: nullable('string'), runsOk: int, runsError: int,
});
export const ESQUEMA_SCHEDULER = o({ arrancado: bool, trabajos: { type: 'array', items: ESQUEMA_TRABAJO } });
export const ESQUEMA_POLICY_VERSION = o({ id: int, created_at: str, parent_id: nullable('integer'), hash: str, nota: nullable('string'), origen: str, config: { type: 'object', additionalProperties: true } });
export const ESQUEMA_POLICY = o({ vigente: ESQUEMA_POLICY_VERSION, historial: { type: 'array', items: ESQUEMA_POLICY_VERSION } });
export const ESQUEMA_CANAL = o({ nombre: str, configurado: bool, falta: { type: 'array', items: str }, descripcion: str });
export const ESQUEMA_CANALES = o({ canales: { type: 'array', items: ESQUEMA_CANAL }, ultimos: { type: 'array', items: { type: 'object', additionalProperties: true } } });
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
