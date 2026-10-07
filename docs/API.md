# API

La API REST: la especificación viva en `/docs` (Swagger UI, detrás de la contraseña) y `/openapi.json`; las rutas operativas de la Fase 3; y la descripción original por deporte.

## Rutas operativas (Fase 3)

| Ruta | Qué |
|---|---|
| `GET /health`, `GET /healthz` | Vive (sin contraseña) |
| `GET /ready` | Listo: migraciones y trabajos (sin contraseña; 503 si no) |
| `GET /docs`, `GET /openapi.json` | Swagger UI y la especificación de todas las rutas |
| `GET /api/features` | Interruptores de `config/features.json` |
| `GET /api/metrics` | Métricas en texto de Prometheus |
| `GET /api/datos/estado` | Ficheros de la base, última copia, retención |
| `GET /api/ingestion-runs` | Última ingesta por fuente e historial |
| `GET /api/scheduler`, `PATCH /api/scheduler/:nombre`, `POST /api/scheduler/:nombre/ejecutar` | Trabajos programados |
| `GET /api/policy`, `POST /api/policy` | La política de apuestas versionada |
| `GET /api/notifications/canales`, `POST /api/notifications/test/:canal`, `GET/POST/DELETE /api/notifications/push/…` | Notificaciones |
| `GET /api/export/:dataset` | Exportación CSV/JSON con filtros |

Las rutas operativas llevan esquema de respuesta; `server/src/api/contract.test.ts` falla si una
respuesta deja de cumplirlo o si una ruta registrada no aparece en la especificación.

## API REST (puerto 7374)

Los tres deportes viven en espacios de nombres distintos: ningún endpoint puede devolver dos.

| Endpoint | Descripción |
|----------|-------------|
| `GET /api/meta` | Fuente de datos y conteos |
| `GET /api/track-record?tour=` | Acierto medido de la app en partidos ya jugados (+ mercado) |
| `GET /api/tours` | Circuitos ATP/WTA con conteos |
| `GET /api/points?tour=&p1=&p2=&surface=&bestOf=&tourney=` | **Los cuatro mercados del modelo de puntos**: partido, set, hándicap de juegos y total de juegos, todos de la misma distribución |
| `POST /api/live` | **Probabilidad en vivo** desde el marcador exacto: `{state, tour, p1, p2, tally?, odds?}` |
| `GET /api/power?tour=&limit=&minMatches=&activeDays=` | **Clasificación por Elo del circuito**, con Elo por superficie, ranking oficial y filtro de actividad (`activeDays=0` para la lista histórica) |
| `GET /api/tours/:tour/players?q=` | Jugadores (búsqueda) |
| `GET /api/players/:tour/:id` | Perfil: Elo general + por superficie + últimos resultados |
| `GET /api/tournaments?tour=` | Torneos configurados y cuáles tienen partidos próximos |
| `GET /api/matches/upcoming?tour=&tournament=` | Próximos partidos con odds y predicción |
| `GET /api/h2h?tour=&p1=&p2=` | Head-to-head entre dos jugadores |
| `GET /api/predictions/:id` | Predicción completa de un partido próximo |
| `GET /api/predictions?tournament=` | Predicciones de todos los próximos de un torneo |
| `POST /api/predict` | Predicción ad-hoc `{tour, p1, p2, surface, odds1?, odds2?}` |
| `GET /api/basketball/leagues` | Ligas con conteos y si tienen modelo Elo |
| `GET /api/basketball/games/upcoming?league=` | Partidos próximos con cuotas y predicción |
| `GET /api/basketball/games/:id` | Un partido con su predicción completa |
| `GET /api/basketball/teams/:league` | Todos los equipos de la liga |
| `GET /api/basketball/teams/:league/:id` | Ficha del equipo (balance, forma, anotación) |
| `GET /api/basketball/power?league=` | Ranking por Elo de todos los equipos |
| `GET /api/basketball/track-record?league=` | Acierto medido, incluido el error de margen |
| `POST /api/basketball/predict` | Predicción ad-hoc `{league, home, away, homeOdds?, awayOdds?}` |
| `GET /api/football/leagues` | Ligas con conteos y si tienen modelo Elo |
| `GET /api/football/fixtures/upcoming?league=` | Partidos próximos con 1X2, goles y cuotas |
| `GET /api/football/teams/:league/:id` | Ficha del equipo (balance, goles, forma) |
| `GET /api/football/power?league=` | Clasificación por Elo |
| `GET /api/football/track-record?league=` | Acierto medido en RPS |
| `POST /api/football/predict` | Predicción ad-hoc `{league, home, away, oddsHome?, oddsDraw?, oddsAway?}` |
| `GET /api/latency?hours=` | Latencia por etapa, objetivo, si es alcanzable, transporte y reparto adaptativo |
| `GET /api/latency/stream` | **SSE**: el servidor empuja los cambios de precio. Reemplaza al refresco manual |
| `POST /api/latency/client` | El navegador reporta la última etapa `{ms, sport?, fixtureId?}` |
| `GET /api/latency/stages` | Los cuatro tramos y sus etiquetas |
| `GET /api/staking/book?bankroll=` | La cartera de hoy: tamaño de cartera contra tamaño en solitario, exposición agregada real contra la ingenua, topes que recortaron y correlaciones medidas |
