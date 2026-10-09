// Cargas de las pestañas de deporte y enlaces profundos (D8 de la revisión del 8 de octubre).

/**
 * El `?dia=` con el que seguir. Mientras carga (o antes de la primera carga) no hay días que
 * mirar, y los que hay pueden ser de la liga anterior: el día se conserva. Solo cuando la carga
 * terminó y ese día no existe se quita (un día vacío parecería «no hay partidos»).
 */
export function conservarDia(dia: string | null, dias: string[], cargando: boolean): string | null {
  if (!dia) return null;
  if (cargando || dias.length === 0) return dia;
  return dias.includes(dia) ? dia : null;
}

/** Numera las peticiones: solo la última puede escribir su respuesta. */
export function contadorDePeticiones(): { nueva: () => number; esUltima: (n: number) => boolean } {
  let ultima = 0;
  return {
    nueva: () => ++ultima,
    esUltima: (n) => n === ultima,
  };
}
