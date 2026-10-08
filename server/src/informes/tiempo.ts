// El reloj de los informes: «cada mañana» y «el lunes» son horas de una ciudad, no de UTC.
// La zona sale de APP_TIMEZONE; sin ella, la del servidor.

import { zonedToUtc } from '../timezone.ts';

export function zonaApp(): string {
  const z = process.env.APP_TIMEZONE?.trim();
  if (z) {
    try {
      new Intl.DateTimeFormat('es', { timeZone: z });
      return z;
    } catch {
      // Una zona mal escrita no puede parar los informes: se cae a la del servidor.
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Fecha (YYYY-MM-DD), hora (0–23) y día de la semana (1 = lunes … 7 = domingo) en la zona. */
export function local(d: Date, zona = zonaApp()): { fecha: string; hora: number; diaSemana: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  const dias: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, diaSemana: dias[p.weekday] ?? 1 };
}

export function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** La semana ISO de una fecha: «2026-W41» (el jueves de la semana decide el año). */
export function semanaIso(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1);
  const semana = Math.ceil(((d.getTime() - inicio) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

/** El lunes de la semana de una fecha. */
export function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  return sumarDias(fecha, -((d.getUTCDay() + 6) % 7));
}

/** El instante (ISO) en que empieza un día local. */
export function inicioDelDia(fecha: string, zona = zonaApp()): string {
  return zonedToUtc(fecha, '00:00', zona) ?? `${fecha}T00:00:00.000Z`;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** «martes 7 de octubre». */
export function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  return `${DIAS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** «07/10 18:30» en la zona. */
export function horaCorta(iso: string, zona = zonaApp()): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: zona, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
