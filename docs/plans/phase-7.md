# Fase 7 — Rendimiento y experiencia de desarrollo

Primero se midió (`scripts/carga.mjs`, 60 peticiones por endpoint, 6 a la vez, por HTTP). Con la
base de demostración del e2e todo responde en menos de 15 ms salvo los próximos de tenis (p95
350 ms). Con la base completa de este entorno, los próximos de cada deporte son el problema:

| Endpoint (base completa) | p50 | p95 | Una sola petición |
|---|---|---|---|
| `/api/football/fixtures/upcoming` | 3.808 ms | 8.570 ms | 0,86 s y **1,4 MB** sin comprimir |
| `/api/basketball/games/upcoming` | 2.347 ms | 5.216 ms | 0,55 s |
| `/api/matches/upcoming?tour=atp` | 1.235 ms | 2.769 ms | 0,27 s |
| `/api/nfl/games/upcoming` | 1.202 ms | 2.737 ms | 0,29 s |
| `/api/baseball/games/upcoming` | 613 ms | 1.370 ms | 0,14 s |
| `/api/estado` | 59 ms | 135 ms | |
| SSE, 50 conexiones | primer byte p95 50 ms | `/api/meta` con ellas abiertas p95 18 ms | |

Ninguna respuesta va comprimida y ninguna lleva ETag. Cada petición a los próximos recalcula todas
las predicciones (y registra las de partidos reales, igual que el ciclo pre-partido de cada 15
minutos).

## 7A Servidor

1. **Compresión**: Brotli o gzip para las respuestas JSON y de texto de más de 1 KB según
   `Accept-Encoding`, con `node:zlib` (sin dependencia). Los assets de `web/dist` se comprimen al
   construir (`.br` y `.gz` al lado) y `@fastify/static` los sirve con `preCompressed`.
2. **ETag y 304** en todo `GET /api/*` con cuerpo: ETag débil sobre el cuerpo sin comprimir,
   `Cache-Control: no-cache` (revalidar siempre) y 304 sin cuerpo si coincide. Cubre los datos
   «estáticos» (interruptores, históricos, tablas) sin enumerarlos.
3. **Caché de los próximos con invalidación por datos**: la respuesta de cada endpoint de próximos
   se guarda en memoria con una firma barata —`PRAGMA data_version` (cambia cuando otro proceso
   escribe: `update-data`, `update-results`), el `MAX(updated_at)` y el número de filas de la tabla
   de próximos (cambian con cada refresco de cuotas) y, en fútbol, alineaciones y noticias— y dura
   como mucho dos minutos (lo que depende de la hora: «empezado», precio viejo). El ciclo
   pre-partido la calienta al terminar. La primera petición de cada versión calcula y registra
   como antes; las demás sirven lo mismo. **No cambia ninguna probabilidad**: es la misma respuesta.
4. **Prueba de carga y presupuestos**: `scripts/carga.mjs` (endpoints de predicciones y 50
   conexiones SSE) y `config/presupuestos.json` con un p95 por endpoint fijado con margen sobre lo
   medido después de 7A. En CI corre contra el servidor de e2e (`--arrancar --presupuesto`).

## 7B Pruebas

5. **Propiedades** (`fast-check`, dependencia de desarrollo): de-vig (suma 1, orden, invariancia),
   Kelly y `decideStake` (nunca apuesta sin ventaja, nunca pasa los topes, redondea hacia abajo,
   monótono en p), topes por grupo de correlación (`cabeEnGrupos` nunca deja pasar un grupo), y
   adelgazamiento de snapshots (conserva apertura, horizontes y cierre; idempotente).
6. **Mutación de las reglas de abstención**: cada umbral de `ABSTENCION` y `RECORTES` se desplaza y
   cada regla se apaga, uno a uno; los casos frontera de los tests tienen que «matar» cada mutante.
   Un mutante vivo es un umbral que ningún test vigila.

## 7C Web y experiencia de desarrollo

7. **Partir los ficheros de `web/src/lib` de más de 400 líneas** que quedaron de la Fase 5
   (`picks.ts`, `teamColors.ts`, `api.ts`), sin cambiar ninguna importación pública.
8. **Listas largas**: `content-visibility: auto` en los días de los calendarios y en las listas
   largas (el navegador no pinta lo que no está en pantalla, sin JavaScript); el archivo y la
   bandeja ya paginan.
9. **Lighthouse**, si se puede correr aquí con el Chromium del contenedor: rendimiento y
   accesibilidad de Destacados y una pestaña de deporte, antes y después.
10. **`CONTRIBUTING.md`**: el flujo por fases, el protocolo de experimentos (registro, holdout,
    `--unlock` nunca), la regla de no inventar datos, los umbrales de muestra, los interruptores y
    las validaciones de cada commit.

## Lo que salió

Las diez piezas, en tres commits (7A servidor, 7B pruebas, 7C web y experiencia de desarrollo).
Tests: 426 → 442 (373 del servidor, 14 unitarios de la web, 55 de Playwright) más la prueba de carga
en CI. Detalle y cifras en [RENDIMIENTO.md](../RENDIMIENTO.md).

- **Servidor**: próximos de fútbol p95 8.570 → 129 ms con la base completa; el resto entre 20 y 100
  veces más rápido. Nada cambia de lo que se responde.
- **Web**: Lighthouse 59/63 → 96/94; el desplazamiento de diseño, de 0,28 a ≤ 0,03.
- **Ficheros de `web/src/lib`** por debajo de 400 líneas: `picks.ts` en núcleo, datos y deportes;
  los colores de club en `teamColorsDatos.ts`; los tipos de la API en `apiTipos.ts`. Las
  importaciones públicas no cambian.
- **Virtualizar listas**: con `content-visibility` y no con una librería de listas virtuales; el
  archivo y la bandeja paginan. Si un día hiciera falta más (miles de tarjetas a la vez), habría que
  medirlo primero.
- **Precalcular tablas de referencia** (walk-forward, benchmark): ya se leen de ficheros pequeños de
  `experiments/` y miden por debajo de 20 ms; no se tocaron. Las simulaciones ya se cachean por día.
- **Mutación**: con un arnés propio sobre `decidir` y la política, no con Stryker (pesado para un
  módulo); cubre las reglas de abstención, que es lo que pedía la hoja de ruta.

