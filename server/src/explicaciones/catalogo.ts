// El catálogo de las explicaciones en español: la FUENTE de cada frase (ver ./index.ts).
//
// Sin imports, a propósito: el test de cobertura de la web (web/src/i18n/explicaciones.test.ts) lo lee
// tal cual y comprueba que cada código tiene su frase en es.ts (la misma) y en en.ts.
//
// Sintaxis de la web: `{x}` es un parámetro; `{n|uno|varios}`, el plural según `n`.

export const EXPLICACIONES = {
  // --- NHL ---
  'nhl.titular': '{fav} gana con un {p} (prórroga y tanda incluidas)',
  'nhl.elo': 'Elo {local} contra {visitante}, más {campo} puntos de jugar en casa.',
  'nhl.goles': 'Goles esperados a 60 minutos: {golesLocal} – {golesVisitante}; {pEmpate} de llegar empatados a la prórroga.',
  'nhl.total': 'Total esperado en el acta {total}: más de {linea}, {pMas}.',
  'nhl.mercado': 'La casa da {pMercado} al local sin margen; el modelo, {pModelo}.',
  'nhl.fiab.pocosPartidos': 'Solo {n} partidos detrás del Elo más flojo de los dos.',
  'nhl.fiab.parado': '{equipos} {n|no juega|no juegan} desde hace más de {dias} días: su Elo es el de la temporada pasada.',
  'nhl.fiab.igualado': 'Partido muy igualado: el favorito lo es por poco.',
  'nhl.fiab.sinPortero': 'No conoce al portero titular, que es lo que más mueve un partido de hockey.',

  // --- UFC ---
  'ufc.titular': '{fav} gana a {rival} con un {p}',
  'ufc.factor.elo': 'Elo {eloA} contra {eloB}: {pp} pp para {quien}.',
  'ufc.factor.record': 'Récord en la UFC {victoriasA}-{derrotasA} contra {victoriasB}-{derrotasB}: {pp} pp para {quien}.',
  'ufc.factor.edad': '{joven} es {anios} años más joven: {pp} pp para {quien}.',
  'ufc.factor.alcance': '{largo} tiene {cm} cm más de alcance: {pp} pp para {quien}.',
  'ufc.factor.experiencia': '{peleasA} peleas en la UFC contra {peleasB}: {pp} pp para {quien}.',
  'ufc.factor.otro': '{factor}: {pp} pp para {quien}.',
  'ufc.mercado': 'La casa da {pMercado} a {luchador} sin margen; el modelo, {pModelo}.',
  'ufc.categorias': 'Vienen de categorías distintas ({categoriaA} y {categoriaB}): uno cambia de peso.',
  'ufc.fiab.pocasPeleas': '{luchadores} {n|lleva|llevan} menos de {min} peleas en la UFC: su Elo apenas ha empezado a moverse.',
  'ufc.fiab.parado': '{luchadores} no {n|pelea|pelean} en la UFC desde hace más de año y medio.',
  'ufc.fiab.sinEdad': 'Falta la fecha de nacimiento de alguno de los dos: la edad no entra en este número.',
  'ufc.fiab.sinAlcance': 'Falta el alcance de alguno de los dos: no entra en este número.',
  'ufc.fiab.igualada': 'Pelea muy igualada: el favorito lo es por poco.',
  'ufc.fiab.soloUfc': 'Solo cuenta lo hecho en la UFC: no sabe de peleas en otras organizaciones, lesiones ni del corte de peso.',

  // --- NFL ---
  'nfl.titular': 'Lo más probable: gana {ganador} ({p}), {marcador} el marcador más repetido.',
  'nfl.veredicto': 'Gana {equipo}',
  'nfl.margen': 'Margen esperado: {margen} para {local} ({puntosLocal}-{puntosVisitante}).',
  'nfl.marcador': 'El marcador más probable es {marcador} ({p}).',
  'nfl.numerosClave': 'El margen cae justo en 3 o en 7 puntos el {p} de las veces: son los dos números alrededor de los que se mueve todo el mercado de hándicap.',
  'nfl.total': 'Total: {total} puntos esperados · over {linea} al {pOver}. Sale de los ritmos de anotación de los dos equipos ({aFavorLocal} y {aFavorVisitante} a favor, {enContraLocal} y {enContraVisitante} en contra), que mueven el total pero no el margen.',
  'nfl.campo': 'Ventaja de campo actual de la liga: {puntos} puntos.',
  'nfl.campoNeutral': 'Ventaja de campo actual de la liga: {puntos} puntos, pero este partido es en campo neutral.',
  'nfl.mercado.cuotas': 'El mercado da {p} al local (cuotas {cuotaLocal} / {cuotaVisitante}, margen {margen}).',
  'nfl.mercado.linea': 'El mercado da {p} al local, deducido de la línea de cierre ({linea}). Medido sobre {n} partidos, esta cifra predice mejor que la del modelo: Brier {brierMercado} frente a {brierModelo}.',
  'nfl.h2h': 'Historial directo: {victoriasLocal}-{victoriasVisitante} en {n} partidos.',
  'nfl.h2hEmpates': 'Historial directo: {victoriasLocal}-{victoriasVisitante}-{empates} en {n} partidos.',
  'nfl.lectura.neutral': '{favorito} llega mejor valorado ({puntos} puntos de diferencia por Elo) y se juega en campo neutral.',
  'nfl.lectura.casa': '{favorito} llega mejor valorado ({puntos} puntos por Elo) y jugar en casa vale {campo} puntos más.',
  'nfl.lectura.casaNoCompensa': '{favorito} llega mejor valorado ({puntos} puntos por Elo) y el campo no lo compensa.',
  'nfl.lectura.pretemporada': 'Los Elo vienen regresados hacia la media porque de por medio hay una pretemporada: en la NFL solo sobrevive el {queda} de la diferencia entre dos equipos.',
  'nfl.lectura.pretemporadas': 'Los Elo vienen regresados hacia la media porque de por medio hay {n} pretemporadas: en la NFL solo sobrevive el {queda} de la diferencia entre dos equipos.',
  'nfl.factor.elo': 'Elo (nivel del equipo)',
  'nfl.factor.pretemporada': 'Regresión de pretemporada (×{factor})',
  'nfl.factor.pretemporadas': 'Regresión de pretemporada (×{factor}, {n} veces)',
  'nfl.factor.qb': 'Quarterback titular',
  'nfl.factor.qbNombres': 'Quarterback titular ({nombres})',
  'nfl.factor.campo': 'Ventaja de campo (la que mide la liga hoy)',
  'nfl.factor.neutral': 'Campo neutral',
  'nfl.fiab.pocosPartidos': 'Solo {n} partidos detrás del Elo más flojo de los dos.',
  'nfl.fiab.temporadas': '{n|Falta|Faltan} {n} {n|temporada|temporadas} en el historial: los Elo no describen a las plantillas de hoy.',
  'nfl.fiab.igualado': 'Partido muy igualado: el favorito lo es por poco.',
} as const satisfies Record<string, string>;

export type CodigoExplicacion = keyof typeof EXPLICACIONES;
