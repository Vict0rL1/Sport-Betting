# Progreso del plan de correcciones (`docs/FIX_PLAN.md`)

Una línea por ítem. Al cerrar cada commit: marcar, poner estado, hash y una nota de una línea.
Estados: `pendiente` · `en curso` · `hecho` · `parcial` · `necesita a Victor`.

Material de partida: `docs/REVISION_GENERAL.md` (revisión del 8-oct-2026) y sus 25 capturas en
`docs/revision/` (el conjunto «antes»).

## Fase 0 — Red de seguridad

- [x] **0.1** Tests de frontend (Vitest + Testing Library + jsdom, `npm test`) — estado: hecho · commit: `a3aa047` · nota: vitest 5 + jsdom 30; tests junto al código (`*.test.tsx`), también pasan por `tsc -b`.
- [x] **0.2** Integración continua (`.github/workflows/ci.yml`) — estado: hecho · commit: `1fa46c5` · nota: ESLint nuevo (recomendado, pasa limpio); ruff laxo (E9/F63/F7/F82); `tsc -b` en vez de `tsc --noEmit` (el tsconfig raíz no comprueba nada); auditorías solo informan.
- [x] **0.3** Golden master del motor (`backend/tests/golden/`) — estado: hecho · commit: `9439108` · nota: 9 componentes, reloj congelado con time-machine; 12 umbrales con prueba de sensibilidad; regenerar solo con visto bueno (`python -m tests.golden.generar --escribir`). Ampliado en el commit de 0.5 (veredictos largos y Hoy con cartera), comprobado que lo anterior no cambió.
- [x] **0.4** Paquete de casos extremos (`backend/tests/fixtures/extremos/`) — estado: hecho · commit: `1c99295` · nota: 8 empresas, 5 carteras, 3 listas diarias; `tests/test_extremos.py` comprueba que cada caso provoca su rareza.
- [x] **0.5** Tests contra fugas de texto (backend y frontend) — estado: hecho · commit: `0c6ec32` · nota: trinquete con PENDIENTES por ítem (backend 11, frontend 19); respuestas reales exportadas para el frontend (`python -m tests.fixtures.exportar_frontend`).
- [x] **0.6** Capturas repetibles con un solo comando — estado: hecho · commit: `399d9eb` · nota: `cd frontend && npm run capturas -- <salida>`; 5 escenarios, 85 capturas, reloj congelado en backend y navegador.
- [x] **0.7** Grabar y reproducir respuestas reales de proveedores — estado: hecho (falta grabar con claves: **necesita a Victor**) · commit: `4f6042e` · nota: `python scripts/validar_con_datos_reales.py --grabar`; los tests de contrato se saltan hasta que haya grabaciones; la tubería está probada sobre una red simulada.
- [x] **0.8** Copia de seguridad de la base en `start.sh` — estado: hecho · commit: `7b8994f` · nota: `backend/scripts/copia_base.sh` (API de copia de SQLite), 10 últimas en `backups/`; sigue a DATABASE_PATH.
- [x] **0.9** Repaso rápido de seguridad — estado: hecho · commit: `5eee473` · nota: tipo común de ticker en 46 parámetros (6 rutas no validaban); «/api/etfs/recomendar» estaba tapada por «/{symbol}» (arreglado); CORS e historial ya limpios; host 127.0.0.1 explícito; npm audit sin avisos.

## Fase 1 — Corrección y fallos visuales (P1)

- [ ] **1.1** Tokens semánticos de color mínimos + `leerToken` + test de contraste — estado: pendiente · commit: — · nota: —
- [ ] **1.2** V1 · colores del gráfico de precios — estado: pendiente · commit: — · nota: —
- [ ] **1.3** V9 · etiquetas de IA — estado: pendiente · commit: — · nota: —
- [ ] **1.4** V3 · «undefined %» en el reparto del tamaño — estado: pendiente · commit: — · nota: —
- [ ] **1.5** V11 · contradicción en «Deuda y solidez» — estado: pendiente · commit: — · nota: —
- [ ] **1.6** V18 · etiquetas de ventana fija (5A, 10A, TTM) — estado: pendiente · commit: — · nota: —
- [ ] **1.7** V4, V5, V8 · un solo sistema de formato (`formato.py` / `formato.ts`) — estado: pendiente · commit: — · nota: —
- [ ] **1.8** V6 · identificadores internos, diccionario de etiquetas y `docs/GLOSARIO.md` — estado: pendiente · commit: — · nota: —
- [ ] **1.9** V7 · gramática, plurales y concordancia — estado: pendiente · commit: — · nota: —
- [ ] **1.10** V13 · mensajes obsoletos — estado: pendiente · commit: — · nota: —
- [ ] **1.11** Identificador del modelo de Claude en configuración — estado: pendiente · commit: — · nota: —
- [ ] **1.12** Límites de plausibilidad de tipos de cambio — estado: pendiente · commit: — · nota: —
- [ ] **1.13** Script de validación con datos reales (informe y `./start.sh validar`) — estado: pendiente · commit: — · nota: —

## Fase 2 — Claridad y uso diario (P2)

- [ ] **2.1** `<EstadoDato>` y estados de carga, vacío y error — estado: pendiente · commit: — · nota: —
- [ ] **2.2** V14 · `AvisoAgrupado` — estado: pendiente · commit: — · nota: —
- [ ] **2.3** Tipografía (mínimo 12 px, `<TituloPagina>`, `<TituloTarjeta>`) — estado: pendiente · commit: — · nota: —
- [ ] **2.4** V15 · `<BarraExposicion>` — estado: pendiente · commit: — · nota: —
- [ ] **2.5** V16 · aprovechamiento del espacio (matriz, tablas) — estado: pendiente · commit: — · nota: —
- [ ] **2.6** V10 · pestañas de la ficha (6 + «Más ▾») — estado: pendiente · commit: — · nota: —
- [ ] **2.7** V12 · estado de la tesis trimestral y anual — estado: pendiente · commit: — · nota: —
- [ ] **2.8** V17 · logo de TradingView y atribución — estado: pendiente · commit: — · nota: —
- [ ] **2.9** Modo resumen — estado: pendiente · commit: — · nota: —
- [ ] **2.10** Editar tesis, varias watchlists, exportar CSV — estado: pendiente · commit: — · nota: —
- [ ] **2.11** Vista global «qué cambió en mis posiciones» — estado: pendiente · commit: — · nota: —
- [ ] **2.12** V2 · diseño móvil — estado: pendiente · commit: — · nota: —
- [ ] **2.13** Accesibilidad (axe-core, foco, aria-label, color no único) — estado: pendiente · commit: — · nota: —
- [ ] **2.14** Rendimiento medido de Hoy — estado: pendiente · commit: — · nota: —

## Fase 3 — Estructura (plan primero, `docs/PLAN_NAVEGACION.md`, esperar aprobación)

- [ ] **3.1** Fusionar Portafolio y Cartera — estado: pendiente · commit: — · nota: —
- [ ] **3.2** Fusionar Tesis y Vigilancia — estado: pendiente · commit: — · nota: —
- [ ] **3.3** Un solo DCF — estado: pendiente · commit: — · nota: —
- [ ] **3.4** Jerarquía de rankings («Investigar») — estado: pendiente · commit: — · nota: —

## Fase 4 — Salud del código (P3)

- [ ] **4.1** Migración completa a tokens — estado: pendiente · commit: — · nota: —
- [ ] **4.2** Partir ficheros grandes sin cambiar comportamiento — estado: pendiente · commit: — · nota: —
- [ ] **4.3** Partir el README — estado: pendiente · commit: — · nota: —
- [ ] **4.4** Fuente Inter autoalojada y cifras tabulares — estado: pendiente · commit: — · nota: —
- [ ] **4.5** Linting más estricto y mypy con línea base — estado: pendiente · commit: — · nota: —
- [ ] **4.6** `CLAUDE.md` con las convenciones nuevas — estado: pendiente · commit: — · nota: —

## Cierres de fase

| Fase | Etiqueta de inicio | Revisión independiente | Capturas «después» | Etiqueta de cierre |
|---|---|---|---|---|
| 0 | `fase-0-inicio` = `e917365` | — | — | — |
| 1 | — | — | — | — |
| 2 | — | — | — | — |
| 3 | — | — | — | — |
| 4 | — | — | — | — |

## Revisión independiente de la Fase 0

Veredicto del revisor: «no se puede cerrar tal cual»; ninguna violación cambia decisiones, pero
la red de seguridad tenía agujeros. Cada hallazgo, su arreglo y su commit:

| # | Hallazgo | Estado | Commit |
|---|---|---|---|
| R1 | El golden descartaba códigos con tildes o espacios (`limite: "posición"`, `faltan: ["puntuación"]`…) | hecho: se guardan; un texto sin clasificar es un error | `4742548` |
| R2 | 14 umbrales (confianza, calidad) y los de `sizing` por defecto sin cubrir | hecho: inventario automático de 117 constantes, 95 cubiertas con prueba, 22 exentas con motivo | `4742548` |
| R3 | `generar.py` y `exportar_frontend.py` con `setdefault(DATABASE_PATH)` | hecho: asignación | `4742548` |
| R4 | El trinquete de fugas cuenta por token, no por sitio ni recuento | hecho: por sitio y con recuento (backend 30 filas, frontend 55); el frontend congela el reloj, exige un botón de replay por instantánea y pinta también cabecera, informe, valoración y portafolio | `e7cc849` |
| R5 | El servidor de demostración inventa datos para VACIA y usa `or 0` | hecho: `ServicioPantallas` completa sin inventar; la demo solo inventa fuera del paquete | `3807b51` |
| R6 | `capturas.ts` sale con 0 ante fallos; `scripts/` fuera de ESLint y tsc | hecho: lista de fallos y código 1 (botón ausente o «Cargando…» a los 15 s cuentan); `tsconfig.scripts.json` y ESLint con globals de Node | (este commit) |
| R7 | La copia de la base se salta en silencio (`backend/.env`, espacios, otros caminos que migran) | pendiente | — |
| R8 | `?symbol=` vacío y con espacios pasó a 422 sin documentar; validadores duplicados; `client.ts` sin codificar | pendiente | — |
| R9 | Tests de contrato que pasan en vacío; unidades | pendiente | — |
| R10 | Casos extremos que no son lo que dicen (`solo_cache_viejo`, `precio_nan`) | pendiente | — |
| R11 | Huecos de `test_seguridad.py` (símbolos buenos, rutas tapadas entre routers) | pendiente | — |
| R12 | `/api/etfs/recomendar` sin verificación visual; README dice POST | hecho: ETF ficticios en la demo y captura `22b_etfs_recomendar` (1440 y 390, verificada); README con GET | (este commit) |
| R13 | El tipo de cambio de la cartera usa la hora real | anotado abajo (cambia el replay: necesita a Victor) | — |

## Etiquetas

El proxy de este entorno deja empujar la rama pero corta los push de etiquetas, así que
las etiquetas viven en local. Cada sesión nueva las recrea desde la tabla de arriba:
`git tag fase-0-inicio e917365` (y así con las demás).

## Hallazgos fuera de la lista (para decidir en su fase)

- **`thesis_watch.evaluar_noticia` usa la hora real** (`datetime.now`) para la ventana de noticias, no el
  momento del análisis: un análisis a fecha pasada filtra las noticias de la tesis con la ventana de hoy.
  Posible fuga de «punto en el tiempo». Encontrado al montar el golden (que congela el reloj por esto).
  Tocarlo cambia decisiones del replay: requiere tu visto bueno.
- **El tipo de cambio de la cartera también usa la hora real** (encontrado por el revisor de la Fase 0).
  `contexto_cartera` llama a `_fx_completo` (`routers/portfolio.py`) sin pasarle el momento del
  análisis; `fx.inicio_de_ventana()` y `fx.tipo_desde_observaciones()` usan `date.today()` y no
  descartan observaciones posteriores. Un análisis a fecha pasada (o un replay) convierte con el tipo de
  hoy, un dato del futuro respecto a esa fecha. Misma familia que el anterior; mismo motivo para no
  tocarlo sin visto bueno.
- **Sin cotización, la ficha entera desaparece** (destapado al dejar de inventar datos en la demo).
  `TickerPage` trata la cotización como imprescindible: si falta, enseña «No se encontró el símbolo» y
  ninguna pestaña, aunque EDGAR tenga estados financieros, análisis, calidad e historial. Ausente ≠ «no
  existe». Para el ítem 2.1 (estados de dato); hasta entonces la captura `empresa_sin_datos` fotografía eso.
- **37 `?? 0` en el frontend** (`grep -rn "?? 0" frontend/src`): la mayoría solo eligen un color por el
  signo, pero alguno puede pintar un 0 donde falta el dato. Misma familia que el `or 0` de la demo. Para
  1.7 (formato) y 2.1 (estados de dato).
- **ETFs (captura `22b_etfs_recomendar`)**: «Patrimonio 400.0 B$» en la recomendación frente a «400 mM»
  en la tabla, y «3 € al año por cada 10.000» en fondos en dólares. Para 1.7 (formato y moneda).
- **El golden congela `levels.objetivo` / `objetivo_pct`** y la pantalla Hoy lo muestra. Choca con
  «sin precios objetivo» (§3). No lo causa esta fase; si una fase lo retira, el golden cambiará y habrá
  que explicarlo.

## Informe del repaso de seguridad (0.9)

| Punto | Estado | Detalle |
|---|---|---|
| `.env` en `.gitignore` y `.env.example` sin claves | Ya estaba bien | Corregida la pista de `DATABASE_PATH` (relativa a `backend/`). |
| Ninguna clave en el historial de git | Ya estaba bien | Nunca se versionó un `.env`; ningún patrón de clave en `git log -p`. |
| uvicorn solo en 127.0.0.1 | Ya estaba bien (por defecto) | Ahora explícito en `start.sh`, con guarda. |
| CORS solo el Vite local | Ya estaba bien | `localhost:5173` y `127.0.0.1:5173`, sin credenciales. |
| Tickers validados en la frontera | **Arreglado** | 6 rutas sin validar (2 llegaban al proveedor); patrón endurecido (empieza por letra o número). |
| Rutas tapadas | **Arreglado** (encontrado de paso) | `/api/etfs/recomendar` nunca llegó a su manejador. |
| Dependencias | **Arreglado** | `npm audit fix` (nanoid, source-map-js); `pip-audit` sin avisos. |

## Dónde me quedé

(Si una sesión termina a mitad de un ítem, aquí va exactamente qué falta.)
