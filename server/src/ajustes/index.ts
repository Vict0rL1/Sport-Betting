// Ajustes de la persona (Fase 5.7): lo que no es política de apuestas ni interruptor de
// función. Un JSON pequeño en `settings` (libro mayor); claves permitidas y validadas aquí.
import { getMeta, setMeta } from '../db.ts';
import { SPORT_IDS } from '../sports.ts';

export const CLAVE_AJUSTES = 'ajustes.usuario';

export interface Ajustes {
  /** Deportes que no se enseñan en la navegación. */
  deportesOcultos: string[];
  tema: 'auto' | 'oscuro' | 'claro';
  idioma: 'es' | 'en';
  /** El banco PERSONAL, para la sugerencia de stake del registro propio. No es el banco de papel. */
  bancoPersonal: number | null;
  /** El recorrido de primer uso ya se vio. */
  recorridoVisto: boolean;
}

export const AJUSTES_POR_DEFECTO: Ajustes = { deportesOcultos: [], tema: 'auto', idioma: 'es', bancoPersonal: null, recorridoVisto: false };

export function leerAjustes(): Ajustes {
  try {
    const raw = getMeta(CLAVE_AJUSTES);
    return raw ? { ...AJUSTES_POR_DEFECTO, ...(JSON.parse(raw) as Partial<Ajustes>) } : { ...AJUSTES_POR_DEFECTO };
  } catch {
    return { ...AJUSTES_POR_DEFECTO };
  }
}

/** Valida un cambio parcial; lo desconocido o inválido no entra. */
export function validarAjustes(cambios: unknown): Partial<Ajustes> {
  const o = (cambios ?? {}) as Record<string, unknown>;
  const out: Partial<Ajustes> = {};
  for (const k of Object.keys(o)) {
    switch (k) {
      case 'deportesOcultos': {
        const v = o[k];
        if (!Array.isArray(v) || v.some((x) => !(SPORT_IDS as readonly string[]).includes(String(x)))) throw new Error('deportesOcultos: lista de deportes conocidos');
        if (v.length >= SPORT_IDS.length) throw new Error('deportesOcultos: alguno tiene que quedar visible');
        out.deportesOcultos = [...new Set(v.map(String))];
        break;
      }
      case 'tema':
        if (!['auto', 'oscuro', 'claro'].includes(String(o[k]))) throw new Error('tema: auto, oscuro o claro');
        out.tema = o[k] as Ajustes['tema'];
        break;
      case 'idioma':
        if (!['es', 'en'].includes(String(o[k]))) throw new Error('idioma: es o en');
        out.idioma = o[k] as Ajustes['idioma'];
        break;
      case 'bancoPersonal': {
        const v = o[k];
        if (v === null) out.bancoPersonal = null;
        else if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9) out.bancoPersonal = Math.round(v * 100) / 100;
        else throw new Error('bancoPersonal: número ≥ 0 o null');
        break;
      }
      case 'recorridoVisto':
        out.recorridoVisto = !!o[k];
        break;
      default:
        throw new Error(`ajuste desconocido: ${k}`);
    }
  }
  return out;
}

export function guardarAjustes(cambios: unknown): Ajustes {
  const nuevo = { ...leerAjustes(), ...validarAjustes(cambios) };
  setMeta(CLAVE_AJUSTES, JSON.stringify(nuevo));
  return nuevo;
}

/** El idioma que pide el navegador, para el valor por defecto. */
export function idiomaDeAcceptLanguage(cabecera: string | undefined): 'es' | 'en' {
  const primero = (cabecera ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return primero.startsWith('en') ? 'en' : 'es';
}
