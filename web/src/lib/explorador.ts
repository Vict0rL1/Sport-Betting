// El explorador de partidos, sin React: tipos de /api/partidos y la lógica de filtros, orden y
// grupos (rediseño de noviembre, D2/D3). La misma regla para la lista y para los recuentos, así
// que el número de una pastilla siempre es el de filas que salen al tocarla.

import type { DeporteId } from './partidos';

export type Resultado = 'local' | 'empate' | 'visitante';

export interface FilaPartido {
  sport: DeporteId;
  id: string;
  matchKey: string | null;
  liga: { id: string; nombre: string } | null;
  torneo: string | null;
  cuando: string;
  empezado: boolean;
  local: { nombre: string; id: string | null };
  visitante: { nombre: string; id: string | null };
  sede: 'local' | 'neutral';
  mercado: { id: 'resultado'; resultados: Resultado[]; excluyentes: true; prorroga: 'no' | 'incluida' | 'no-aplica' };
  prediccion: { probs: number[]; capturadaEn: string; version: string | null; fuente: 'instantanea' | 'registro' } | null;
  sinPrediccion: 'sin-registro' | 'invalida' | 'demo' | null;
  cuotas: { precios: (number | null)[]; completas: boolean; casas: number | null; recibidasEn: string | null; origen: 'casa' | 'demo'; antiguas: boolean } | null;
  origen: 'real' | 'demo';
}

export interface RespuestaExplorador {
  generado: string;
  desde: string;
  hasta: string;
  filas: FilaPartido[];
  cuarentena: { n: number; ejemplos: string[] };
  duplicados: number;
  porDeporte: { sport: DeporteId; filas: number; error: string | null }[];
}

export type Orden = 'hora' | 'probabilidad';

export interface Filtros {
  /** null = todos los deportes. */
  deporte: DeporteId | null;
  liga: string | null;
  q: string;
  guardados: boolean;
  /** Probabilidad mínima del favorito (0–1), o null. */
  minimo: number | null;
  orden: Orden;
}

export const FILTROS_POR_DEFECTO: Filtros = { deporte: null, liga: null, q: '', guardados: false, minimo: null, orden: 'hora' };

export function hayFiltros(f: Filtros): boolean {
  return f.deporte != null || f.liga != null || f.q.trim() !== '' || f.guardados || f.minimo != null || f.orden !== 'hora';
}

/** La zona del navegador (IANA), o UTC si no la da. */
export function zonaDelNavegador(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** El día (YYYY-MM-DD) de un instante en una zona. */
export function diaEn(iso: string | Date, zona: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function diaSiguiente(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** El resultado más probable del mercado ganador y su probabilidad. */
export function favorito(f: FilaPartido): { indice: number; p: number } | null {
  const ps = f.prediccion?.probs;
  if (!ps?.length) return null;
  let indice = 0;
  for (let i = 1; i < ps.length; i++) if (ps[i] > ps[indice]) indice = i;
  return { indice, p: ps[indice] };
}

/** Sin acentos ni mayúsculas, para buscar «atletico» y encontrar «Atlético». */
const plano = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export const claveGuardado = (f: Pick<FilaPartido, 'sport' | 'matchKey'>) => `${f.sport}|${f.matchKey ?? ''}`;

/** Filtra con todo menos el deporte (para los recuentos) o con todo. */
function pasa(f: FilaPartido, filtros: Filtros, guardados: ReadonlySet<string>, conDeporte: boolean): boolean {
  if (conDeporte && filtros.deporte && f.sport !== filtros.deporte) return false;
  if (conDeporte && filtros.deporte && filtros.liga && f.liga?.id !== filtros.liga) return false;
  if (filtros.guardados && !guardados.has(claveGuardado(f)) && !guardados.has(`${f.sport}|eq|${f.local.id}`) && !guardados.has(`${f.sport}|eq|${f.visitante.id}`)) return false;
  if (filtros.minimo != null) {
    const fav = favorito(f);
    if (!fav || fav.p < filtros.minimo) return false;
  }
  const q = plano(filtros.q.trim());
  if (q) {
    const texto = plano([f.local.nombre, f.visitante.nombre, f.liga?.nombre ?? '', f.torneo ?? ''].join(' '));
    if (!q.split(/\s+/).every((p) => texto.includes(p))) return false;
  }
  return true;
}

export function filtrar(filas: readonly FilaPartido[], filtros: Filtros, guardados: ReadonlySet<string>): FilaPartido[] {
  return filas.filter((f) => pasa(f, filtros, guardados, true));
}

/** Cuántas filas tendría cada deporte con los demás filtros puestos (para las pastillas). */
export function contarPorDeporte(filas: readonly FilaPartido[], filtros: Filtros, guardados: ReadonlySet<string>): Partial<Record<DeporteId | 'total', number>> {
  const out: Partial<Record<DeporteId | 'total', number>> = {};
  for (const f of filas) {
    if (!pasa(f, { ...filtros, liga: null }, guardados, false)) continue;
    out.total = (out.total ?? 0) + 1;
    out[f.sport] = (out[f.sport] ?? 0) + 1;
  }
  return out;
}

const porHora = (a: FilaPartido, b: FilaPartido) =>
  a.cuando < b.cuando ? -1 : a.cuando > b.cuando ? 1 : `${a.sport}|${a.id}`.localeCompare(`${b.sport}|${b.id}`);

/**
 * Por hora (y desempate por deporte e id), o por la probabilidad del favorito del mercado
 * ganador: de mayor a menor, lo que no tiene predicción al final, y los empates por hora.
 * Es «el resultado más probable», no «la mejor apuesta» ni «confianza alta».
 */
export function ordenar(filas: readonly FilaPartido[], orden: Orden): FilaPartido[] {
  const copia = [...filas];
  if (orden === 'hora') return copia.sort(porHora);
  return copia.sort((a, b) => {
    const pa = favorito(a)?.p;
    const pb = favorito(b)?.p;
    if (pa == null && pb == null) return porHora(a, b);
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pb - pa || porHora(a, b);
  });
}

export interface GrupoDia {
  dia: string;
  grupos: { clave: string; titulo: string; sport: DeporteId; filas: FilaPartido[] }[];
}

/**
 * Por día local y, dentro, por competición (deporte + liga o torneo), cada grupo en el orden de
 * su primer partido. Espera las filas ya ordenadas por hora.
 */
export function agrupar(filas: readonly FilaPartido[], zona: string): GrupoDia[] {
  const dias: GrupoDia[] = [];
  const porDia = new Map<string, GrupoDia>();
  for (const f of filas) {
    const dia = diaEn(f.cuando, zona);
    let d = porDia.get(dia);
    if (!d) {
      d = { dia, grupos: [] };
      porDia.set(dia, d);
      dias.push(d);
    }
    const titulo = f.torneo ?? f.liga?.nombre ?? f.sport;
    const clave = `${f.sport}|${f.torneo ?? f.liga?.id ?? ''}`;
    let g = d.grupos.find((x) => x.clave === clave);
    if (!g) {
      g = { clave, titulo, sport: f.sport, filas: [] };
      d.grupos.push(g);
    }
    g.filas.push(f);
  }
  return dias;
}
