// Horas de silencio (G3 de la revisión del PR 17). Opcionales y apagadas por defecto.
//
// SEMÁNTICA
//   · La ventana [desde, hasta) se mide en la HORA LOCAL de `zona` (IANA), con Intl: el cambio de
//     hora no la mueve (de 01:00 a 03:30 sigue acabando a las 03:30 de reloj, también el día en que
//     a las 02:00 son las 03:00).
//   · Si `desde` > `hasta`, cruza la medianoche (23:00–07:00). `desde` = `hasta` no es una ventana:
//     se rechaza al guardarla (no se adivina si quería «nunca» o «siempre»).
//   · Solo se silencian los CANALES externos (Telegram, webhook, correo, push). La bandeja de la app
//     lo recibe todo siempre, y «Enviar prueba» nunca se silencia.
//   · `suprimir`: no se envía y queda anotado. `aplazar`: se guarda y se envía al acabar la ventana,
//     una vez por clave (evento + título + enlace; gana la última versión), salvo que haya pasado
//     `caducaHoras` desde que se generó: entonces se anota como caducada y no sale.

export interface Silencio {
  activo: boolean;
  desde: string;
  hasta: string;
  zona: string;
  modo: 'suprimir' | 'aplazar';
  caducaHoras: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutos = (h: string) => {
  const m = HHMM.exec(h)!;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Valida una configuración; null la apaga. Lanza con el motivo si no vale. */
export function validarSilencio(v: unknown): Silencio | null {
  if (v === null) return null;
  const o = (v ?? {}) as Record<string, unknown>;
  const desde = String(o.desde ?? '');
  const hasta = String(o.hasta ?? '');
  if (!HHMM.test(desde) || !HHMM.test(hasta)) throw new Error('silencio: desde y hasta en HH:MM (00:00–23:59)');
  if (desde === hasta) throw new Error('silencio: desde y hasta iguales no definen una ventana');
  const zona = String(o.zona ?? '');
  try {
    new Intl.DateTimeFormat('en', { timeZone: zona });
  } catch {
    throw new Error('silencio: zona IANA no válida');
  }
  if (!zona) throw new Error('silencio: zona IANA no válida');
  if (o.modo !== 'suprimir' && o.modo !== 'aplazar') throw new Error('silencio: modo suprimir o aplazar');
  const caducaHoras = Number(o.caducaHoras);
  if (!Number.isInteger(caducaHoras) || caducaHoras < 1 || caducaHoras > 72) throw new Error('silencio: caducaHoras entero entre 1 y 72');
  return { activo: o.activo !== false, desde, hasta, zona, modo: o.modo, caducaHoras };
}

/** Los minutos desde la medianoche, en la hora local de `zona`, de un instante. */
const FORMATOS = new Map<string, Intl.DateTimeFormat>();
function minutoLocal(ahora: Date, zona: string): number {
  // Un formateador por zona (revisión de seguridad de G3): finDeSilencio da hasta 1500 pasos.
  let fmt = FORMATOS.get(zona);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    FORMATOS.set(zona, fmt);
  }
  const partes = fmt.formatToParts(ahora);
  const h = Number(partes.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(partes.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** ¿Está `ahora` dentro de la ventana? Apagado o sin configuración: nunca. */
export function enSilencio(ahora: Date, s: Silencio | null | undefined): boolean {
  if (!s || !s.activo) return false;
  const t = minutoLocal(ahora, s.zona);
  const a = minutos(s.desde);
  const b = minutos(s.hasta);
  return a < b ? t >= a && t < b : t >= a || t < b;
}

/** El primer minuto, a partir de `ahora`, fuera de la ventana (null si no se está dentro). */
export function finDeSilencio(ahora: Date, s: Silencio | null | undefined): Date | null {
  if (!enSilencio(ahora, s)) return null;
  // Al minuto: como mucho un día y una hora (una ventana no dura más de 24 h, y un cambio de hora
  // puede alargarla una).
  const base = Math.floor(ahora.getTime() / 60_000) * 60_000;
  for (let i = 1; i <= 25 * 60; i++) {
    const t = new Date(base + i * 60_000);
    if (!enSilencio(t, s)) return t;
  }
  return null;
}
