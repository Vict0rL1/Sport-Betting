# Fase 5 — Rediseño de la interfaz y sistema visual

Se aplica a través de `web/src/lib/theme.ts` y `web/src/components/ui/`. Se conservan la escala
tipográfica de ocho niveles y los colores de datos validados (local azul, visitante naranja,
empate verde-agua; beneficio/pérdida verde-agua/naranja). Todo el texto en español; el inglés
llega con el catálogo de la 5.25, con el español como fuente de verdad. Sin CDN: la fuente y
cualquier dependencia nueva van en `node_modules` y las empaqueta Vite.

Dependencias nuevas (npm, no CDN): `react-router` (rutas reales), `@fontsource/ibm-plex-sans`
(fuente autoalojada, woff2 en el bundle), `@axe-core/playwright` (accesibilidad en los tests).

## 5A Estructura

1. **Partir `components/ui/index.tsx`** (1.924 líneas) por familia: `ui/cards.tsx`, `ui/marks.tsx`
   (SeriesDot, TeamCrest, Flag, LeagueFlag), `ui/rows.tsx`, `ui/days.tsx`, `ui/states.tsx`,
   `ui/picks.tsx`, `ui/dashboard.tsx`, `ui/slate.tsx`; `ui/index.tsx` reexporta, así ningún
   import cambia. Ningún fichero nuevo por encima de ~400 líneas; los que ya lo superan
   (tarjetas de 600–680 líneas) se parten al tocarlos en 5B.
2. **Rutas reales** (`web/src/rutas.ts`, `BrowserRouter`): `/destacados`, `/futbol/:league?`,
   `/baloncesto/:league?`, `/beisbol/:league?`, `/nfl/:league?`, `/tenis/:tour?`, `/apuestas`,
   `/confianza`, `/confianza/diagnostico`, `/ajustes`, `/partido/:sport/:id`,
   `/equipo/:sport/:league/:id`, `/jugador/:tour/:id`, `/liga/:sport/:league`, `/glosario`;
   `/` redirige a la última pestaña. Filtros en la query (`?dia=`, `?orden=`, `?horas=`…) y se
   restauran al abrir el enlace. El servidor ya sirve `index.html` en cualquier ruta
   (`static.ts`).
3. **Navegación móvil** (< 1024 px): barra inferior con cuatro destinos —Destacados, Deportes
   (abre una hoja con los cinco deportes), Apuestas, Confianza—; la cabecera superior se queda
   con la marca y la píldora de estado. Nada fuera de pantalla a 390 px. La barra fija de «Mi
   selección» se coloca encima de la barra inferior.
4. **Píldora de estado global**: `GET /api/estado` (modo de cuotas demo/real, frescura de datos
   por deporte, última actualización de resultados, cuota restante) y `StatusPill` en la barra
   lateral y la cabecera, con detalle desplegable. Sustituye a `DemoOddsNote` en las tres
   pestañas que lo repetían.
5. **«Cómo le fue al modelo»** solo en las pestañas de deporte y como sección de Destacados; se
   quita de Apuestas y Confianza.
6. **Diagnóstico** (`/confianza/diagnostico`): latencia del escáner y canal SSE (salen de
   Apuestas), `ingestion_runs`, `error_log` (`GET /api/errores`, sin datos sensibles), estado del
   registro de trabajos, frescura de la copia y cuota. Apuestas se queda con el registro personal,
   la exposición y el banco de papel.
7. **Ajustes** (`/ajustes`): umbrales de la política (crea versión), interruptores de funciones
   (`PATCH /api/features/:nombre`, anulación guardada en `settings`), deportes visibles,
   cadencias (`PATCH /api/scheduler/:nombre` gana `cadenciaMin`), canales de notificación con
   «probar», tema, idioma, banco de papel. Lo que cambia un número enseña «antes → después» y
   pide confirmación. `GET/PUT /api/ajustes` para las claves de usuario permitidas.

## 5B Tarjetas y densidad

8. **Revelado progresivo** en las tarjetas: una línea por concepto a la vista (probabilidad,
   cuota contra justa, insignia de confianza) y el resto detrás de «¿por qué?». Filtros móviles
   en una hoja inferior con un chip-resumen de los activos.
9. **Insignia de confianza**: estado «Sin mercado» (neutro) distinto de «Confianza baja» (rojo);
   la falta de cuotas no puede pintarse como confianza baja (también en `trust/decision.ts`).
10. **Sin truncados**: los nombres de equipo saltan a dos líneas en tablas y en «gana X»; los
    chips de liga de fútbol en una sola fila con scroll horizontal.
11. **Página de partido** (`/partido/:sport/:id`, el destino para compartir): línea temporal
    pre-partido (T-24h → final), movimiento de cuotas por casa, desglose del modelo, calidad de
    datos, cara a cara, matriz de marcadores donde existe, clima donde existe, qué pasaría si, y
    «¿Acertó?» tras el resultado.
12. **Página de equipo / jugador**: historia del Elo (`GET /api/elo/historia/:sport/:league/:id`,
    reproducción de la liga cacheada por día), forma, descanso, local/visitante o superficie,
    próximos partidos con probabilidad y lo que la simulación de temporada dice del equipo.
13. **Página de liga**: clasificación junto al puesto por Elo y la distribución simulada de final
    de temporada, con la evolución de esas probabilidades a lo largo de la temporada
    (`GET /api/simulation/season/:sport/:league/historial`, de `simulation_runs`).
14. **Seguimiento**: equipos, jugadores y partidos seguidos (`watchlist`, libro mayor;
    `GET/POST/DELETE /api/watchlist`); sección «Seguimiento» en Destacados; las notificaciones de
    línea movida solo para los partidos seguidos.
15. **Mi selección → acción**: enviar a Apuestas como borrador, probabilidad conjunta y EV con
    correlación (4.8), copiar como texto, descargar JSON, exportar `.ics` con la probabilidad en
    la descripción, y tarjeta SVG generada en el servidor (`POST /api/picks/tarjeta.svg`) que el
    navegador guarda como PNG (sin rasterizador nativo en el servidor: se anota).
16. **Registro personal**: importación CSV, etiquetas, CLV de las apuestas propias cuando hay
    snapshot, «¿lo habría apostado el modelo?», curva de capital y sugerencia de stake con la
    misma política Kelly (solo sugerencia).
17. **Búsqueda global** (Ctrl/Cmd+K): equipos, jugadores, partidos, ligas y páginas
    (`GET /api/buscar?q=`); atajos de teclado para pestañas y búsqueda.
18. **Glosario**: página `/glosario` y tooltips (`<Termino>`) para CLV, Kelly, de-vig, Brier, ECE,
    log loss, abstención, walk-forward, holdout.
19. **Primer uso**: recorrido corto (píldora de estado, insignia de confianza, modo demo);
    descartable y recordado.

## 5C Visual

20. **IBM Plex Sans autoalojada** (`@fontsource/ibm-plex-sans`, pesos 400/500/600) con cifras
    tabulares, aplicada por la escala tipográfica.
21. **Tema claro** con los mismos tokens: los colores de tinta, superficie y línea pasan a
    variables CSS (`--ink-*`, `--surface-*`, `--line`, `--raised`) definidas en `index.css` y
    usadas por Tailwind (`text-(--ink-strong)`); `prefers-color-scheme` por defecto y
    conmutador manual. Los colores de datos no cambian; se valida su contraste (≥ 3:1) en las dos
    superficies con un test.
22. **Gráficos** (`components/charts/`, SVG propio, una sola biblioteca): fiabilidad por deporte,
    deriva T-24h → final de un partido, curva de capital del banco de papel, Brier/log loss
    móviles, acierto por segmento, distribuciones de la simulación, cuotas por casa. Cada gráfico
    con resumen en texto para lectores de pantalla.
23. **Colores de club** de LaLiga, Serie A, Bundesliga y Ligue 1; NBA completa; gris para lo
    desconocido.
24. **Accesibilidad**: roles de pestaña con flechas, anillos de foco visibles, movimiento reducido,
    `aria-live` en alertas, etiquetas unificadas («Baloncesto» en todas partes); axe en Playwright.
25. **i18n**: catálogo `web/src/i18n/` con el español como fuente de verdad y el inglés al lado;
    idioma en Ajustes y por `Accept-Language`; números, fechas y moneda con `Intl`. Se extrae el
    armazón y todas las páginas nuevas; las tarjetas por deporte se van extrayendo al tocarlas y
    la cobertura se anota abajo.
26. **Sin conexión**: el service worker cachea el armazón y la última respuesta de las
    predicciones; banner «Sin conexión: datos de HH:MM».

## 5D Tests

27. Playwright: cada ruta a 1280 y 390 px sin scroll horizontal ni errores de consola; la barra
    inferior enseña los cuatro destinos en móvil; los enlaces profundos restauran el estado; axe
    en claro y oscuro. Capturas de la tarjeta de partido, la píldora de estado y la insignia de
    confianza.

## Hecho cuando

Playwright en verde en CI; cada página nueva con su juego de cadenas en español e inglés;
doctor, tests, verify:data, typecheck, lint y build en verde; `CHANGELOG.md` al día. Lighthouse
≥ 90 se mide a mano (no hay Lighthouse en el contenedor) y se anota.
