// El resumen de aciertos de un alcance (deporte, cohorte), en el navegador, con la MISMA regla que
// el servidor (server/src/today.ts, `resumir`): así el titular y la lista de debajo salen de las
// mismas filas (rediseño de noviembre, PER-1).
//
// Unidad: el partido, en el mercado «quién gana» (1X2 en el fútbol). Acierta si el resultado más
// probable para el modelo fue el que pasó. Acierto = aciertos / partidos puntuados; lo que no tiene
// resultado no entra en el denominador.
//
// «Lo esperable» supone que las probabilidades del modelo son exactas y que los partidos son
// independientes: esperado = Σp, desviación = √Σp(1−p), y el margen del 95 % por la aproximación
// normal. No compara con ningún otro modelo ni con el mercado: dice si el número cuadra con lo que
// el propio modelo prometió.

export interface Resumen {
  total: number;
  aciertos: number;
  tasa: number | null;
  esperado: number | null;
  tasaEsperada: number | null;
  rangoNormal: [number, number] | null;
}

export function resumir(xs: readonly { probabilidad: number; acerto: boolean }[]): Resumen {
  const n = xs.length;
  if (n === 0) return { total: 0, aciertos: 0, tasa: null, esperado: null, tasaEsperada: null, rangoNormal: null };
  const aciertos = xs.filter((x) => x.acerto).length;
  const esperado = xs.reduce((a, x) => a + x.probabilidad, 0);
  const sd = Math.sqrt(xs.reduce((a, x) => a + x.probabilidad * (1 - x.probabilidad), 0));
  return {
    total: n,
    aciertos,
    tasa: aciertos / n,
    esperado,
    tasaEsperada: esperado / n,
    rangoNormal: [Math.max(0, Math.ceil(esperado - 1.96 * sd)), Math.min(n, Math.floor(esperado + 1.96 * sd))],
  };
}
