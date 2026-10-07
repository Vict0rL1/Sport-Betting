// Tablas de «Lo que el modelo destacaría» (lib/picks.ts): avisos por deporte y tasas base del
// mercado con las que se ordena. Partido de picks.ts en la Fase 7 (ningún fichero de lib/ por encima de ~400 líneas).

/**
 * What the reader has to know before acting on any of this, per sport.
 *
 * Written from the backtests in this repo, not from optimism. The NFL line is the
 * uncomfortable one and it is the most important one on the page.
 */
export const CAVEATS: Record<string, string> = {
  football:
    'Dixon-Coles jerárquico: ataque y defensa por equipo, ventaja de campo, decay de un año de ' +
    'semivida y priors que encogen a los equipos con pocos partidos hacia la media de su liga. ' +
    'Medido sobre 20.824 partidos de 14 ligas sin tocar el holdout: RPS 0.2007 en las primeras ' +
    'divisiones y 0.2177 en las segundas, frente a 0.2230 de la referencia, con el empate ' +
    'calibrado a ±1,4 pp. Contra el modelo de Elo anterior gana claramente en el MARCADOR EXACTO ' +
    '(p = 0,0005) y en el hándicap, pero NO de forma medible en el 1X2 (p = 0,054): la mejora está ' +
    'en la forma de la distribución de goles, no en acertar quién gana. En «ambos marcan» no ' +
    'cambia nada. Un equipo recién ascendido se predice con su Elo de Segunda más el salto de ' +
    'división medido en su país; la tarjeta lo dice y su banda es más ancha. La probabilidad que se ' +
    'publica pasa además por una calibración de Platt ajustada sobre predicciones históricas fuera ' +
    'de muestra (mejora el log loss en 0,0009, que es poco y no sobrevive a la corrección por ' +
    'comparaciones múltiples). NO se mezcla con el mercado: para ajustar ese peso hacen falta ' +
    'cuotas de partidos ya jugados y este archivo no las tiene, así que se deja apagado en vez de ' +
    'poner un número a ojo. Nunca se ha medido contra las cuotas de cierre, así que una diferencia ' +
    'con el mercado es una diferencia, no una ganancia demostrada. Los mercados de menos ' +
    'liquidez —mitades, córners, tarjetas y props de jugador— van en su propio panel porque ' +
    'NO están igual de calibrados: las mitades andan entre 0,05 y 3,2 pp de error medido ' +
    'sobre 3.634 partidos, con el de cada línea escrito al lado, y a los que cotizan pocas ' +
    'casas hay que exigirles dos o tres veces más ventaja porque el margen se la come antes.',
  baseball:
    'Medido sobre 36.235 partidos: Brier 0.2431 y over/under acertado el 54,9 %. El modelo no ' +
    'conoce el bullpen ni la alineación del día, que es justo lo que mueve una cuota a última hora.',
  basketball:
    'Medido sobre 85.562 partidos: acierto 68,1 % y Brier 0.2044, empatado con el modelo que ' +
    'publicaba FiveThirtyEight en los mismos partidos. El hándicap sale de una σ medida sobre las ' +
    'últimas temporadas, no de una constante. No se ha medido contra las cuotas de cierre.',
  nfl:
    'Este modelo NO le gana a la línea de cierre: 50,6 % contra el hándicap donde el punto de ' +
    'equilibrio está en 52,4 %, y la línea acierta más que él (Brier 0.2115 frente a 0.2180 en ' +
    '7.276 partidos). Así que la probabilidad que se publica aquí NO es la del modelo: es una ' +
    'mezcla en la que el backtest le da al modelo un peso de 0,10 y al precio el resto, y ese peso ' +
    'baja aún más cuando el modelo se aleja del precio. Con eso la mezcla queda en 0,6294 de log ' +
    'loss frente a 0,6270 del mercado solo — o sea, sigue sin mejorar la línea, solo deja de ' +
    'empeorarla. La tarjeta enseña las dos probabilidades para que se vea cuánto se ha movido. ' +
    'Cuando el modelo y el precio discrepen, la apuesta razonable es que se equivoque el modelo.',
  tennis:
    'Medido sobre 46.166 partidos ATP: acierto 67,0 % frente al 64,8 % de fiarse del ranking, y ' +
    'cuando discrepa del ranking acierta el 55,4 %. Las bajas de última hora y las retiradas —que ' +
    'en tenis deciden partidos enteros— no están dentro.',
};

/** Las de segunda división. Los mercados que no dependen del escalón no están. */
export const BASE_RATE_TIER2: Record<string, number> = {
  '1X2': 0.427,
  'Doble oportunidad': 0.712,
  'Ambos marcan': 0.511,
  'Total de goles': 0.463,
};

export const BASE_RATE: Record<string, number> = {
  // Football, primera división
  '1X2': 0.435,               // el local gana
  'Doble oportunidad': 0.685, // 1X; X2 es 0.565, se usa la más común
  'Ambos marcan': 0.538,
  'Total de goles': 0.530,    // +2.5
  // Basketball / baseball / NFL winner markets, home side
  Ganador: 0.55,
  Hándicap: 0.5,              // una línea justa es 50/50 por construcción
  'Línea de carreras': 0.5,
  'Total de puntos': 0.5,
  'Total de carreras': 0.5,
};

/**
 * Las segundas divisiones que la app ingiere.
 *
 * Una lista explícita y no una heurística sobre el nombre: "Championship" no lleva
 * ningún "2" y "LaLiga Hypermotion" tampoco, así que cualquier regla por el texto
 * fallaría justo en las dos ligas con más partidos de este grupo.
 */
export const TIER2 = new Set(['championship', 'laliga2', 'bundesliga2', 'serieb', 'ligue2']);
