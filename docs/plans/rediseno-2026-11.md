# Rediseño de noviembre de 2026: plan, matriz y relevo

El encargo: un explorador de partidos canónico, menos ruido y más verdad. Cada número tiene que
tener significado, fuente, alcance y fecha. Hay cinco fases (0–5); este documento es el plan, la
matriz de requisitos y el relevo entre sesiones. Se mantiene corto: lo largo está en el código y en
los tests que cita.

**Principios que no se negocian**

- Una lista de partidos, no tres.
- Lo demostrado nunca se presenta como verificado.
- Las predicciones publicadas no se reescriben.
- Lo registrado antes del partido y lo reconstruido no se suman.
- Sin datos inventados (DESCONOCIDO).
- Las reglas de CLAUDE.md mandan sobre este plan.

## Relevo (lo primero que se lee al retomar)

- **Base.** Rama `claude/tennis-prediction-app-jlhgxh`, desde `faf30e1`. Cuando se empezó, `main`
  estaba en `36ab259`. El árbol estaba limpio.
- **Entorno.** Node 22.23, npm 10.9 (workspaces `server`, `web`). Fastify 5, node:sqlite, React 19,
  Vite 6, React Router 7, Tailwind 4 y Playwright.
- **Arrancar para mirar.**
  - `npm run build`, y desde `web/`: `node ../scripts/e2e-server.mjs`. Levanta la base de
    demostración en el puerto 7390 (solo trae tenis).
  - Con datos reales: `DATA_DIR=<tmp> npm run fetch-data` y después el servidor con ese
    `DATA_DIR`. Nunca sobre `data/`.
- **Fase activa.** Se apunta abajo, en «Estado por fase».

## Fase 0: lo que hay de verdad (19-nov-2026)

Observaciones históricas, comprobadas una a una con la base de demostración (tenis) y con la
release `data-latest` (datos reales, sin clave de cuotas), a 1280 y 390 px:

| Observación histórica | Hoy | Dónde |
| --- | --- | --- |
| Los mismos partidos en tres sitios | **Confirmado.** Tenis los enseña cuatro veces: «Hoy» (TodayPanel), «Lo que el modelo ve más probable» (PicksPanel), «Los partidos» (SlateTable) y las tarjetas. Los otros deportes, igual. | `components/*/…Dashboard.tsx`, `App.tsx` (`conHoy`) |
| Insignia global «cuotas reales» junto a partidos de demostración | Ahora es la píldora `StatusPill`, con un único estado global. Sin clave dice «Modo demo» aunque NHL y NFL sean partidos reales sin cuotas. | `components/estado/StatusPill.tsx` |
| Marca de mercado junto a «Sin mercado» | **Confirmado.** Las tarjetas de demostración enseñan la barra «Mercado (odds sin vig)» y «Posible value», calculadas con cuotas inventadas, junto a «Sin mercado». | `MatchCard*`, `ui/cards.tsx` |
| «fiabilidad alta» junto a MEDIA/BAJA | **Confirmado.** Una tarjeta lleva «fiabilidad media ±3,6 pp» (incertidumbre del modelo), «¿Cuánto fiarse? ALTA» (capa de confianza) y, en Destacados, «Confianza media». Son tres escalas sin definir la diferencia. | `trust/ConfianzaBadge.tsx`, tarjetas |
| ES/EN mezclados | Parcial: «odds demo» y «odds sin vig» en la interfaz española. | `i18n/es.ts` |
| Alias como rivales («Betis vs Real Betis Balompié») | **Causa probable:** el generador de demostración elige rivales entre las filas de `fb_teams`, y un club partido en dos ids (lo que arregló `faf30e1`) se podía emparejar consigo mismo. Además, `fb_upcoming` no tiene guarda de mismo id a ambos lados (UFC y NFL sí la tienen). | `football/ingest/odds.ts` |
| «Ordenado por probabilidad» sin orden numérico | En tenis demo sí está ordenado. PicksPanel ordena por `rankPicks` (prioriza mercados con precio real), no por probabilidad, y la cabecera dice otra cosa cuando hay cuotas. | `lib/picksNucleo.ts` |
| Rendimiento con varios deportes estando en Fútbol | **Confirmado.** «Cómo le fue al modelo · 158 de 237 · 67 %» suma los siete deportes, y además los registrados con los reconstruidos. | `TodayPanel.tsx`, `today.ts` |
| «Ningún partido con estos filtros» mientras otra zona tenía partidos | SlateTable filtra por umbral; las tarjetas no. | `ui/slate.tsx` |
| Comandos operativos en la interfaz | **Confirmado.** «Ejecuta `npm run update-data:fb`», «Ponla en el fichero .env y corre `npm run update-data`» y StaleHistoryWarning con `fix=`. | dashboards, `ui/states.tsx` |
| Página muy alta | **Confirmado.** NFL mide 9.423 px a 1280 y 12.122 px a 390. | |
| Campana «99+» | **Confirmado en código.** Entra cada notificación y alerta, y cuenta todo lo no leído. | `bandeja/index.ts`, `Campana.tsx` |
| «Cuota mínima» y «Devolución» ambiguas, columnas de mercado vacías | **Confirmado** en PicksPanel y SlateTable. | `ui/picks.tsx`, `ui/slate.tsx` |
| «Por puro azar, entre X e Y» | **Confirmado:** el intervalo supone que el modelo acierta sus probabilidades y que los partidos son independientes, y no lo dice. | `RecentResults.tsx` |
| Export CSV | Existe (`/api/exportar/apuestas`). **Defecto:** no neutraliza celdas que empiezan por `= + - @`. | `exports/datasets.ts` |

Lo que ya funciona y se conserva:

- **Instantáneas inmutables.** `prediction_snapshots` y `prematch_final` tienen triggers. Solo se
  guarda una fila cuando la predicción cambia ≥0,1 pp, cambia una entrada, cambia la versión o se
  cruza T-24h/6h/1h. La captura tiene que ser anterior al inicio.
- **El ciclo pre-partido** (cada 15 min) predice todos los próximos y congela la final.
- **Seguimiento** de equipo, jugador o partido (`/api/watchlist`).
- **Diario de apuestas:**
  - `profitOf` cubre won, lost, void, half y cashout;
  - el ROI se calcula sobre lo arriesgado;
  - importación CSV y CLV.
- **Página de partido** `/partido/:sport/:id` con la deriva pre-partido, las cuotas por casa y
  «¿Acertó?».
- **Bandeja** con avisos leídos y no leídos.
- **Ajustes** (tema, idioma, deportes ocultos).
- **Glosario**, **Informes** y **Diagnóstico**.
- **i18n** es/en.
- **Rutas compartibles** y restauración de la posición al volver (L7/N15).

Legado sin procedencia fuerte:

- Las filas de `*_prediction_log` escritas después del inicio ya se excluyen de «en vivo»
  (`prepartidoSql`).
- Las reconstruidas no tienen fecha de publicación: son backtest y se etiquetan así.
- Nada se reetiqueta como registrado.

Proveedores:

- The Odds API, con `ODDS_API_KEY`. No está en este entorno y no se gasta cuota para mirar.
- Los calendarios y resultados son gratuitos (openfootball, football-data, ESPN, MLB, NHL,
  nflverse, ufcstats). El proxy de esta sesión bloquea la mayoría.
- Avisos: Telegram, SMTP, webhook y push VAPID, todos opcionales y aquí sin configurar.

## Decisiones

- **D1. Navegación.**
  - Destinos principales: **Partidos** (`/partidos`), **Rendimiento** (`/confianza`) y **Mis
    apuestas** (`/apuestas`).
  - Secundarios: Destacados, Informes, Bandeja, Ajustes, Diagnóstico y Glosario.
  - Los siete deportes pasan a un selector dentro de Partidos. Sus páginas (`/futbol`…) quedan
    como «Análisis del deporte»: Elo, ligas, mercados y tarjetas completas. Se llega desde
    Partidos, y las rutas antiguas siguen vivas.
  - La raíz abre `/partidos`.
- **D2. Fuente única de la lista.** `GET /api/partidos` lee las tablas de próximos y la última
  predicción registrada de cada partido, como «Hoy» y Destacados: no recalcula modelos dentro de
  la petición. Cada fila lleva:
  - el origen del partido (real o demostración);
  - el origen de la predicción (registrada a una hora, o ninguna);
  - el origen de las cuotas (casa real con hora, demostración, o ninguna);
  - el mercado (resultados, si son excluyentes y exhaustivos, y si incluye prórroga).
- **D3. Días.** Hoy y Mañana se calculan en la zona horaria de la persona: la del navegador, o la
  de Ajustes si la fija. El servidor recibe `desde` y `hasta` como instantes UTC calculados con esa
  zona. Sin rango: los próximos 7 días.
- **D4. Rendimiento.**
  - Por defecto, solo lo **registrado antes del partido**. Lo reconstruido va aparte y con su
    nombre.
  - El alcance de deporte de Rendimiento es **propio**: tiene su selector y no hereda el de
    Partidos. Se dice en la cabecera.
  - La unidad es el partido (mercado ganador o 1X2) y el periodo se cuenta por la fecha del
    partido.
- **D5. Tres conceptos, tres nombres.**
  - **Probabilidad del modelo.**
  - **Incertidumbre del modelo**, en ±pp: la «fiabilidad» actual, que pasa a llamarse así.
  - **Estado de los datos**: la capa de confianza, que mide calidad, estabilidad y desacuerdo.
  - Ninguno se llama «confianza alta». El acierto histórico va en Rendimiento.
- **D6. Cuotas.**
  - Una comparación con el mercado solo se hace con una cuota de casa real del mismo partido y
    mercado.
  - Las cuotas de demostración o derivadas del modelo nunca dan «valor» ni barra de mercado.
  - «Cuota mínima» pasa a «cuota justa del modelo» (1/p).
  - «Devolución» pasa a «pago potencial, con la apuesta».
- **D7. Bandeja acotada.**
  - La campana cuenta solo lo accionable de los últimos 7 días: partidos seguidos, apuestas y
    problemas de datos.
  - El resto sigue en la bandeja, sin número.
  - El número se muestra hasta 9 y, por encima, «9+».
- **D8. Mis apuestas.**
  - Moneda por apuesta, EUR por defecto, migración aditiva.
  - Totales separados por moneda.
  - Pago bruto y neto mostrados.
  - Importes con 2 decimales como máximo.
  - `push` como estado de devolución íntegra.

## Matriz de requisitos

Estados: OK · PARCIAL · FALTA · HECHO (en esta obra) · BLOQ (bloqueado) · DIFERIDO.

| ID | Requisito | Antes | Ahora | Código / tests |
| --- | --- | --- | --- | --- |
| NAV-1 | 3 destinos principales, el resto secundario | PARCIAL (10 pestañas) | HECHO | `components/nav/Principal.tsx`, `MobileNav.tsx`, e2e `rutas.spec.ts` |
| NAV-2 | Deporte como selector dentro de la vista | FALTA | HECHO | `pages/Partidos.tsx` (pastillas de deporte con recuento) |
| NAV-3 | Rutas y marcadores antiguos | OK | OK | rutas antiguas y atajos 1–0 intactos |
| EXP-1 | Un explorador canónico; sin secciones duplicadas | FALTA | HECHO | `/api/partidos`, `pages/Partidos.tsx`; SlateTable y «Hoy» fuera de las pestañas |
| EXP-2 | Hoy / Mañana / fecha, en la zona elegida | PARCIAL | HECHO | `partidos/explorador.ts` `ventana`, `lib/explorador.ts` `diaEn` (T22 en los dos) |
| EXP-3 | Filtros (deporte, liga, guardados, búsqueda) en la URL, «Quitar filtros», recuentos que cuadran | PARCIAL | HECHO | `lib/explorador.ts` `filtrar`/`contarPorDeporte` (T18) |
| EXP-4 | Orden por hora con desempate; por probabilidad del favorito del mercado ganador | PARCIAL | HECHO | `ordenar` (T21) |
| EXP-5 | Mercado según el deporte (sin empate falso; prórroga dicha) | PARCIAL | HECHO | `mercado.prorroga`, empate solo en fútbol (T06, T08) |
| EXP-6 | Un estado vacío por motivo | PARCIAL | HECHO | sin partidos / filtros / error / error de un deporte |
| EXP-7 | Respuestas fuera de orden | OK en deportes | HECHO | `contadorDePeticiones` + AbortController en Partidos (T17) |
| PRV-1 | Origen del partido, de la predicción y de las cuotas por fila; sin «demo» global | PARCIAL | HECHO | `origen` y `cuotas.origen` por fila; píldora = estado del servicio |
| PRV-2 | Demo o cuotas derivadas del modelo nunca dan ventaja ni barra de mercado | FALTA | HECHO | tenis, baloncesto y fútbol sin mercado con cuotas demo (T04) |
| ID-1 | Mismo participante a ambos lados: cuarentena | FALTA (fútbol) | HECHO | `football/ingest/odds.ts` cuarentena + explorador (T01) |
| ID-2 | Importar dos veces no duplica | OK | | T02 |
| TZ-1 | Instantes UTC, zona visible y elegible | PARCIAL | PARCIAL | zona elegible en Ajustes y usada en Partidos; el resto de pantallas sigue con la del navegador |
| DET-1 | Detalle con el orden del encargo, enlace profundo, foco | PARCIAL | PARCIAL | ficha existente; sin cajón lateral (se mantiene la página enlazable) |
| DET-2 | Resumen factual de lo que usó el modelo y lo que falta | PARCIAL | HECHO | «Lo que usó el modelo» de la última instantánea (`/api/prematch` `entradas`) |
| DET-3 | Probabilidad, incertidumbre, estado de datos y acierto separados | FALTA | HECHO | incertidumbre ±pp vs solidez de la estimación; textos del catálogo |
| HIS-1 | Instantáneas inmutables e idempotentes | OK | | `prematch/snapshots.test.ts` (T11, T31) |
| HIS-2 | Política de evaluación: la última antes del inicio | OK | | T12, T13 |
| HIS-3 | Línea temporal (original, revisiones, la evaluada) | PARCIAL | HECHO | `prematch/snapshots.ts` `historial` + ficha (T11/T12) |
| PER-1 | Registrado y reconstruido separados; el titular es solo lo registrado | FALTA | HECHO | `RecentResults.tsx` + `lib/rendimiento.ts` (T20) |
| PER-2 | Sin «por puro azar» sin supuestos | FALTA | HECHO | `acerto.explica` con sus supuestos |
| PER-3 | Calibración, Brier y log-loss documentados | por verificar | OK (ya estaba) | Analítica: fiabilidad/ECE backtest vs vivo, Brier, log-loss, PSI; «Histórico» con referencias y mercado |
| ODD-1 | Cuota justa del modelo, pago potencial y neto bien nombrados | FALTA | HECHO | cuota justa del modelo, pago si gana (con la apuesta), `lib/mercado.ts` |
| ODD-2 | Sin columnas de mercado vacías en la lista | FALTA | HECHO | la lista no tiene columnas de mercado |
| ODD-3 | Comparar solo mercados compatibles; doble oportunidad sin normalizar | por verificar | PARCIAL | `lib/mercado.ts` (T10, T33) probado; la ficha sigue con su comparación por deporte |
| FAV-1 | Seguir partido, equipo o jugador | OK | OK | `EstrellaSeguir` ahora sin éxito fingido (T24) |
| FAV-2 | Filtro «Guardados» en Partidos | FALTA | HECHO | «Guardados» = partidos y equipos seguidos |
| FAV-3 | Guardar una instantánea concreta | FALTA | HECHO | `saved_predictions` (ledger, v29), `/api/guardadas`, «Guardar esta estimación» en el historial de la ficha; entra en «Guardados» |
| PREF-1 | Zona horaria y deporte por defecto | FALTA | PARCIAL | zona horaria hecha; deporte por defecto no (la URL manda) |
| ACT-1 | Campana acotada y deduplicada | FALTA | HECHO | `contadorCampana` (T25), «9+» |
| ACT-2 | Avisos opt-in por tipo y horas de silencio | por verificar | PARCIAL | sin repetir en 6 h por tipo+partido, umbrales documentados (3 pp / 5 pp), canales opt-in con registro de envíos; SIN horas de silencio (diferido: toca el envío de notificaciones) |
| BET-1 | Alta, edición y borrado | OK | | |
| BET-2 | Pago bruto y neto (T27, T28) | PARCIAL (solo neto) | HECHO | `payoutOf`/`profitOf` en céntimos (T27, T28) |
| BET-3 | Moneda; sin sumar monedas distintas | FALTA | HECHO | `bets.currency`, resumen por moneda (T29) |
| BET-4 | Validación: decimales e infinitos | PARCIAL | HECHO | 2 decimales, moneda, NaN/∞ (T32) |
| BET-5 | Exportar lo propio sin inyección de fórmulas | PARCIAL (defecto) | HECHO | aCsv neutraliza fórmulas; la importación lo deshace |
| OPS-1 | Sin comandos en las vistas normales; Diagnóstico para eso | FALTA | HECHO | comandos solo en Diagnóstico («Puesta en marcha»), Ajustes y Laboratorio |
| I18N-1 | Un idioma cada vez | PARCIAL | PARCIAL | «odds demo» y etiquetas del servidor en español resueltas donde se tocó |
| A11Y-1 | WCAG 2.2 AA: foco, contraste, objetivos, reflujo a 320 px | PARCIAL | PARCIAL | axe en todas las rutas; foco y objetivos según los e2e |
| TOK-1 | Tokens grafito y menta, escala tipográfica, sin bordes anidados | PARCIAL | HECHO | grafito + menta, `tokens.test.ts` amplía el contraste |

## Orden de trabajo

1. **Base de dominio**
   - `lib/mercado.ts` (web): cuota justa, implícita, quitar margen solo en conjuntos completos,
     doble oportunidad desde la distribución, validación.
   - `aCsv` seguro.
   - Guarda de mismo id en `fb_upcoming`.
2. **`/api/partidos`** y sus tests.
3. **Explorador** `/partidos` y la navegación nueva.
4. **Ruido:**
   - comandos fuera de las vistas;
   - demo sin barra de mercado;
   - SlateTable fuera de los deportes;
   - TodayPanel fuera de las pestañas;
   - campana acotada.
5. **Tokens.**
6. **Rendimiento:** cohortes separadas, supuestos del intervalo, selector propio.
7. **Detalle:** resumen factual, línea temporal etiquetada y conceptos separados.
8. **Mis apuestas:** moneda, pago bruto, exportación y validación.
9. **Guardar instantánea**, zona horaria y deporte por defecto en Ajustes.
10. **Revisión**, e2e, accesibilidad y el informe final.

## Estado por fase

- **Fase 0:** hecha.
- **Fase 1:** hecha.
  - Navegación, `/api/partidos`, explorador y tokens.
  - Sin duplicados.
  - Procedencia por fila.
  - Comandos solo en Diagnóstico.
  - Campana acotada.
- **Fase 2:** en parte.
  - Hecho: historial etiquetado y «Lo que usó el modelo»; cohortes separadas en Rendimiento.
  - Sin hacer: el detalle sigue siendo una página (`/partido/:sport/:id`) y no un cajón. Es enlazable
    y «atrás» conserva filtros y posición.
- **Fase 3:** en parte.
  - Hecho: seguir partido o equipo y el filtro «Guardados»; zona horaria; moneda, pago bruto, push,
    validación y exportación de apuestas; campana.
  - FAV-3 hecho: «Guardar esta estimación» en el historial de la ficha; es una referencia en el libro
    mayor y la instantánea no se toca.
  - ACT-2 en parte: deduplicación y umbrales sí; horas de silencio no (diferido, toca el envío de
    notificaciones).
- **Fase 4:** ya estaba.
  - Calibración (ECE, backtest y en vivo), Brier, log-loss y PSI en Analítica; referencias y mercado
    en «Histórico».
  - Exportaciones en `/api/export/:dataset`, Líneas y cuotas por casa.
  - Hay que verificarlo en el navegador.
- **Fase 5:** hecha para lo hecho: suite completa en verde (Playwright 189/189), revisión ui-tester con sus hallazgos medios atendidos o anotados, revisiones data-guardian y quant-reviewer.

## Pendientes conocidos (decididos, no olvidados)

- **Dos reglas para la misma probabilidad.**
  - Destacados y «Hoy» leen la **primera** predicción registrada (`*_prediction_log`, que no se
    reescribe).
  - El explorador lee la **última instantánea** (`prediction_snapshots`), con su hora: es la
    estimación vigente.
  - La revisión quant lo marcó (medio). Unificar Destacados con el mismo resolutor cambia su orden y
    su evaluación de confianza: queda para un cambio propio, con quant-reviewer.
- **Predicciones de demostración en el registro.** El fútbol registra las de partidos `fixture`, igual
  que el tenis; la NFL ya no. No llegan al rendimiento porque nunca tienen resultado, pero lo correcto
  es no registrarlas (cambio en el libro mayor: necesita data-guardian).
- **La zona horaria elegida solo la usa Partidos.** El resto de pantallas formatea con la del navegador.
- **Prosa del servidor en español con la interfaz en inglés.** Los motivos de las tarjetas («En
  hierba, … llega con mejor Elo», «Forma: …») y las descripciones de `features.json` en Ajustes salen
  del servidor ya escritos en español. Traducirlos exige localizar esa prosa en el servidor (la
  petición sabe el idioma); queda abierto (I18N-1).
- **El código muerto** que quedó sin usar (`ui/slate.tsx` SlateTable, `lib/slate.ts`) se quita en la
  Fase 5 si nada más lo importa.

## Informe de entrega (19-nov-2026)

### Qué cambia para quien usa la app
- **Antes**
  - Cada deporte enseñaba los mismos partidos cuatro veces: «Hoy», «Lo que el modelo ve más
    probable», la tabla «Los partidos» y las tarjetas grandes.
  - Encima iban «Cómo le fue al modelo», que sumaba deportes y cohortes, y bloques con comandos.
  - Una píldora global decía «Cuotas reales · N peticiones» o «Modo demo».
  - La NFL medía 9.423 px a 1280.
- **Ahora**
  - Se entra en **Partidos**: título, alcance y zona, fecha (Hoy, Mañana, 7 días o día), deporte con
    recuento, búsqueda y Guardados.
  - La lista agrupa por día y competición, una fila por partido, con la probabilidad del modelo al
    lado de cada participante.
  - Lo demás vive en la ficha (`/partido/…`): lo que usó el modelo, el historial de la estimación,
    la deriva, las cuotas por casa y el resultado.
  - Arriba de **Rendimiento** está el registro antes del partido; **Mis apuestas** sigue con su
    diario.
  - Los deportes siguen como «Análisis por deporte».

### Dónde está cada cosa
| Qué | Dónde |
| --- | --- |
| Lista canónica | `/partidos` (`web/src/pages/Partidos.tsx`, `server/src/partidos/explorador.ts`) |
| Zona horaria | Ajustes › Zona horaria (`/ajustes#zona`) |
| Guardados | Partidos › Guardados: partidos seguidos, sus equipos y las estimaciones guardadas |
| Historial y entradas del modelo | ficha del partido |
| Registro frente a reconstrucción | Rendimiento, arriba |
| Moneda, pago bruto y exportación | Mis apuestas |
| Comandos de mantenimiento y cuarentena | Diagnóstico › Puesta en marcha / Partidos descartados |

### Límites y lo que no está verificado
Ver «Pendientes conocidos». Además:
- **Cuotas reales:** sin `ODDS_API_KEY` en este entorno, la comparación con casas reales no se ha
  visto de punta a punta. Solo se probó con datos sintéticos.
- **Avisos externos:** los canales (Telegram, SMTP, push) no están configurados aquí y no se han
  probado. Siguen como estaban.
- **Despliegue:** `fly deploy` no se ha ejecutado (lo decide quien es dueño del proyecto).

## Revisión ui-tester (19-nov, sobre `b382952`)

- 19 rutas a 1280 y 390 en los dos temas, y Partidos a 320: sin errores de consola, sin respuestas
  ≥ 400 y sin desbordamiento.
- Navegación, hoja «Más» (diálogo con foco y Escape), píldora, estados vacíos, vista previa del pago
  y Ajustes › Zona: bien.
- Hallazgos y qué se hizo:
  1. **Medio.** «Sin estimación todavía» en filas de demostración cuya ficha sí da una probabilidad.
     Corregido: las de demostración no se registran (solo las reales) y ahora dicen
     `sinPrediccion: 'demo'`, «la ficha la calcula al abrirla». Las reales sin registro dicen «Sin
     estimación registrada todavía».
  2. **Medio.** Prosa del servidor en español con la interfaz en inglés. Abierto (ver arriba).
  3. **Bajo.** El título «Mercado (odds sin vig)» seguía con cuotas de demostración. Quitado; «odds
     demo» pasa a «cuotas de demostración».
  4. **Bajo.** El banco de papel decía «1000 $» junto a apuestas en EUR. Ahora son «unidades (dinero
     simulado, sin moneda)».
  5–7. Claves de configuración en la prosa de Ajustes (es la página del operador), «Más filtros»
     como `<details>` y la exportación solo con apuestas: se quedan como están.

## Comandos y resultados

Línea base (19-nov, `faf30e1`): `npm run typecheck` ✓, `npm run lint` ✓, `npm test` ✓ (servidor 717/717,
web 95/95), `npm run build` ✓. Sin fallos previos.

Tras las fases 1–3 (sin commit todavía):

- `npm run typecheck`, `npm run lint` y `npm test` ✓: servidor 736/736, web 117/117.
- Primera pasada de Playwright: 130 de 191 bien. Los 61 fallos eran pruebas del panel «Hoy» y de la
  tabla «Los partidos» quitados, etiquetas viejas, comandos en la copia, y un `aria-label` en un
  `<span>` de la bandeja (arreglado).
- Segunda pasada: 181 de 189 bien. Los 8 fallos eran de las pruebas nuevas: el service worker servía
  datos reales por encima de los simulados, había un nombre no exacto y faltaba el endpoint de la
  M2.
- Tercera pasada: 188 de 189 bien. El que falló era una aserción demasiado estricta en
  `partidos.spec.ts` (el recuento lleva « · Quitar filtros» detrás); corregida, `partidos.spec.ts`
  da 8/8 por separado.
- `verify:data` 532/532 y `audit` 6051/6051, sobre una copia de la release `data-latest` en un
  directorio temporal (nunca `data/`).
- Tras la revisión ui-tester:
  - `npm run lint` ✓ y `npm test` ✓ (servidor 741/741, web 117/117);
  - `npm run build` ✓ (incluye `tsc -b`);
  - **Playwright 189/189** (`cd web && npx playwright test --trace off`).
- Ojo: en `web/`, `npx tsc -p .` no comprueba nada (el tsconfig raíz solo tiene referencias); el bueno
  es `npm run typecheck` (`tsc -b`).
