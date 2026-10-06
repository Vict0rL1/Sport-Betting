import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  minutesInTz,
  startOfWeek,
  todayInTz,
  wallTimeToInstant,
  zonedDayMinute,
} from "@/lib/date";
import { mapPlannerItems } from "@/lib/canvas";
import { parseICS } from "@/lib/ics";

/**
 * Horario de verano y viajes.
 *
 * Vancouver pasa de UTC-7 a UTC-8 el domingo 1 de noviembre de 2026 a las
 * 2:00 (la 1:00–1:59 ocurre dos veces), y vuelve a UTC-7 el domingo 14 de
 * marzo de 2027 a las 2:00 (la 2:00–2:59 no existe).
 */
const VAN = "America/Vancouver";

describe("aritmética de fechas", () => {
  it("sumar días no se mueve con el cambio de hora", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2027-03-13", 1)).toBe("2027-03-14");
    expect(addDays("2027-03-14", 1)).toBe("2027-03-15");
    expect(daysBetween("2026-10-30", "2026-11-03")).toBe(4);
    expect(daysBetween("2027-03-12", "2027-03-16")).toBe(4);
  });

  it("la semana empieza en lunes también la semana del cambio", () => {
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26"); // el domingo del cambio
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
  });
});

describe("el día de hoy depende de la zona del perfil, no del servidor", () => {
  it("las 23:30 en Vancouver ya son mañana en UTC", () => {
    const t = Date.parse("2026-09-30T06:30:00Z"); // 29 sep, 23:30 en Vancouver
    expect(todayInTz(VAN, t)).toBe("2026-09-29");
    expect(todayInTz("UTC", t)).toBe("2026-09-30");
    expect(minutesInTz(VAN, t)).toBe(23 * 60 + 30);
  });

  it("de viaje: el mismo instante es otro día en Tokio", () => {
    const t = Date.parse("2026-09-30T06:30:00Z");
    expect(todayInTz("Asia/Tokyo", t)).toBe("2026-09-30");
    expect(minutesInTz("Asia/Tokyo", t)).toBe(15 * 60 + 30);
  });
});

// Los cambios de hora se prueban con los que YA pasaron (2 nov 2025 y 8 mar
// 2026): las fechas futuras dependen de la política de cada provincia y de
// qué tan nueva sea la base de zonas del Node que corre el test. Así pasó con
// BC, que dejó de cambiar la hora: ver el bloque de abajo.

describe("noviembre (2025): la 1:00 ocurre dos veces", () => {
  it("cada instante cae en su hora local correcta", () => {
    expect(zonedDayMinute("2025-11-02T08:30:00Z", VAN)).toEqual({ date: "2025-11-02", min: 90 }); // 1:30 PDT
    expect(zonedDayMinute("2025-11-02T09:30:00Z", VAN)).toEqual({ date: "2025-11-02", min: 90 }); // 1:30 PST
    expect(zonedDayMinute("2025-11-02T10:30:00Z", VAN)).toEqual({ date: "2025-11-02", min: 150 }); // 2:30 PST
  });

  it("una hora de pared se convierte con el desfase que rige ese día", () => {
    // Antes del cambio: UTC-7. Después: UTC-8.
    expect(new Date(wallTimeToInstant(2025, 11, 1, 9, 0, VAN)).toISOString()).toBe("2025-11-01T16:00:00.000Z");
    expect(new Date(wallTimeToInstant(2025, 11, 3, 9, 0, VAN)).toISOString()).toBe("2025-11-03T17:00:00.000Z");
  });

  it("un deadline de Canvas a las 23:59 del día del cambio queda ese día", () => {
    const [t] = mapPlannerItems(
      [{
        course_id: 1, plannable_id: 1, plannable_type: "assignment",
        plannable_date: "2025-11-03T07:59:00Z", plannable: { title: "PS5" },
      }],
      [],
      { areas: ["SFU"], timeZone: VAN },
    );
    expect(t.dueDate).toBe("2025-11-02");
    expect(t.dueTime).toBe("23:59:00");
  });
});

describe("marzo (2026): la 2:00 no existe", () => {
  it("una hora inexistente cae en un instante válido y cercano, sin reventar", () => {
    const i = wallTimeToInstant(2026, 3, 8, 2, 30, VAN);
    const local = zonedDayMinute(new Date(i).toISOString(), VAN);
    expect(local.date).toBe("2026-03-08");
    // Según el lado del salto que se tome, 1:30 o 3:30: nunca otro día ni NaN.
    expect([90, 210]).toContain(local.min);
  });

  it("una clase semanal de 9:00 sigue a las 9:00 después del cambio", () => {
    const evs = parseICS(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:clase",
        "SUMMARY:ECON 342",
        "DTSTART;TZID=America/Vancouver:20260302T090000",
        "DTEND;TZID=America/Vancouver:20260302T100000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      { source: "x", today: "2026-02-25", timeZone: VAN },
    );
    const locales = evs.map((e) => zonedDayMinute(e.startsAt!, VAN));
    expect(locales.map((l) => l.date)).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
    expect(locales.every((l) => l.min === 9 * 60)).toBe(true);
    // Y en UTC sí se movieron: de 17:00Z a 16:00Z.
    expect(evs[0].startsAt).toContain("T17:00:00");
    expect(evs[1].startsAt).toContain("T16:00:00");
  });
});

/**
 * British Columbia se queda en UTC-7 desde el 1 nov 2026. Esto tiene que dar
 * lo mismo con un Node viejo (tzdata 2025c, que todavía atrasa la hora) que
 * con uno al día: el mismo test corre en los dos.
 */
describe("BC sin cambio de hora desde noviembre de 2026", () => {
  it("el 1 de noviembre la 1:30 ocurre una sola vez y la hora no se atrasa", () => {
    expect(zonedDayMinute("2026-11-01T08:30:00Z", VAN)).toEqual({ date: "2026-11-01", min: 90 });
    expect(zonedDayMinute("2026-11-01T09:30:00Z", VAN)).toEqual({ date: "2026-11-01", min: 150 });
  });

  it("una clase de 9:00 es a las 16:00Z en octubre, en noviembre y en marzo", () => {
    for (const [y, m, d] of [[2026, 10, 30], [2026, 11, 2], [2026, 12, 7], [2027, 3, 15]]) {
      expect(new Date(wallTimeToInstant(y, m, d, 9, 0, VAN)).toISOString()).toBe(
        `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T16:00:00.000Z`,
      );
    }
  });

  it("un deadline a las 23:59 de noviembre queda ese día, con su hora", () => {
    const [t] = mapPlannerItems(
      [{
        course_id: 1, plannable_id: 1, plannable_type: "assignment",
        plannable_date: "2026-11-10T06:59:00Z", plannable: { title: "PS7" },
      }],
      [],
      { areas: ["SFU"], timeZone: VAN },
    );
    expect(t.dueDate).toBe("2026-11-09");
    expect(t.dueTime).toBe("23:59:00");
  });

  it("el día cambia a la medianoche de UTC-7, no a la de UTC-8", () => {
    const t = Date.parse("2026-11-15T07:30:00Z");
    expect(todayInTz(VAN, t)).toBe("2026-11-15");
    expect(minutesInTz(VAN, t)).toBe(30);
  });

  it("el generador del semestre (tools/) usa la misma regla que la app", async () => {
    const { wallTimeToInstant: delGenerador } = await import("../tools/semester.mjs");
    for (const ymd of ["2026-10-30", "2026-11-01", "2026-11-03", "2026-12-07", "2027-03-15"]) {
      const [y, m, d] = ymd.split("-").map(Number);
      expect(delGenerador(ymd, "10:30")).toBe(new Date(wallTimeToInstant(y, m, d, 10, 30, VAN)).toISOString());
    }
  });

  it("una clase semanal que cruza el 1 de noviembre no se mueve en UTC", () => {
    const evs = parseICS(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:clase",
        "SUMMARY:ECON 342",
        "DTSTART;TZID=America/Vancouver:20261027T103000",
        "DTEND;TZID=America/Vancouver:20261027T120000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      { source: "x", today: "2026-10-20", timeZone: VAN },
    );
    expect(evs.map((e) => e.startsAt)).toEqual([
      "2026-10-27T17:30:00.000Z", "2026-11-03T17:30:00.000Z", "2026-11-10T17:30:00.000Z",
    ]);
  });
});
