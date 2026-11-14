# El nocturno «Datos» no ha pasado nunca

`.github/workflows/data.yml` reconstruye la historia desde las fuentes (`update-all -- --skip-odds`), la
comprueba (`verify:data`), la exporta y la publica en la release `data-latest`. **Ninguna de sus 35
ejecuciones ha pasado** de `verify:data`, así que nunca se ha publicado una release:
- `npm run fetch-data` no tiene nada que bajar;
- el paso «verify:data sobre la base publicada» de CI se salta («Sin release publicada»).

La última ejecución (13 de noviembre, sobre `main` `5c8b828`) falla 7 de 530 comprobaciones:

| # | Comprobación | Causa | Estado |
|---|---|---|---|
| 1 | noticias: un apellido ambiguo no se resuelve a ciegas («timber») | `matchPlayer` (`server/src/news/repo.ts`) | **Arreglado** |
| 2 | fútbol: todos los equipos de una temporada se cruzan (+982 parejas) | football-data.co.uk crea sus propios ids | Pendiente |
| 3 | fútbol: ningún club aparece con dos ids distintos (Mallorca, América, Necaxa) | la misma | Pendiente |
| 4 | ligamx: la excepción documentada sigue haciendo falta (2022–2024) | football-data rellena esas temporadas | Pendiente, con la 2 |
| 5 | ligue2: la excepción documentada sigue haciendo falta (2022–2024) | la misma | Pendiente, con la 2 |
| 6 | Baloncesto: sin partidos duplicados (199 claves) | sin investigar (ESPN) | Pendiente |
| 7 | Baloncesto: marcadores dentro de lo posible (13 partidos) | sin investigar (ESPN) | Pendiente |

## Cómo se reprodujo

Se reconstruyó todo como el nocturno, en un `DATA_DIR` temporal (nunca `data/`), y se pasó
`verify:data`. Esta sesión en la nube no alcanza todas las fuentes:
- **Se alcanza:** GitHub (openfootball, tenis, NFL…).
- **Bloqueados por la política de red:** www.football-data.co.uk, site.api.espn.com y
  fantasy.premierleague.com.
- El `fetch` de Node no pasa por el proxy salvo con `NODE_USE_ENV_PROXY=1`.

Sin esas fuentes, la reconstrucción falla solo la 1 (528 comprobaciones); con el arreglo, pasa 528 de 528.
Las 2 a 7 necesitan las fuentes bloqueadas para verse con datos reales.

## 1. «Timber» (arreglado)

FPL 2026-27 tiene a «J.Timber» (Arsenal) y a «Timber» (Crystal Palace). Dos defectos de `matchPlayer`:
- la coincidencia exacta con un nombre de una palabra ganaba aunque otro jugador llevara ese apellido;
- el punto se borraba sin dejar espacio («J.Timber» → «jtimber»), así que los 36 jugadores de la Premier
  con punto en el nombre nunca emparejaban por el apellido.

Pruebas en `server/src/news/repo.test.ts`.

## 2 a 5. football-data.co.uk crea un universo paralelo de equipos

`ingestFootballData` (`server/src/football/ingest/footballData.ts`) da a cada club el id
`slugify(nombre de football-data)` y no lo resuelve contra los que ya creó openfootball:
- «Man United» → `man-united`, frente a `manchester-united`;
- «Brighton» → `brighton`, frente a `brighton-hove-albion`.

El upsert `ON CONFLICT(league, match_date, home_id, away_id)`, pensado para añadir cuotas y córners al
partido de openfootball, solo funde los clubes cuyo slug coincide por casualidad. El resto entra dos veces,
con ids distintos, y por eso:
- hay equipos de la misma temporada que «nunca se cruzan»;
- hay clubes con dos ids («Mallorca» / «RCD Mallorca»);
- Liga MX y Ligue 2 tienen 2022–2024 (solo de football-data) con ids que no son los de openfootball.

**No se arregla con una tabla de alias de memoria.** Sería inventar el emparejamiento, y las grafías de
football-data no se pueden comprobar desde esta sesión. El criterio del proyecto está en
`openfootball.ts`: al crear equipos, solo la coincidencia exacta normalizada; con prefijos, Paris FC se
fundía con el PSG.

**Camino propuesto, por decidir con los datos delante:** aprender el emparejamiento de los partidos que
están en las dos fuentes (misma liga, mismo día, mismo marcador). Necesita las CSV reales para
comprobarlo.

## 6 y 7. Baloncesto

Sin investigar: vienen de ESPN (`server/src/basketball/ingest/espn.ts`), que esta sesión no alcanza.
