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
- [x] **0.8** Copia de seguridad de la base en `start.sh` — estado: hecho · commit: `7b8994f` (rehecho tras la revisión, ver R7) · nota: `app/db/copia.py` (API de copia de SQLite), 10 últimas en `copias/` junto a la base; la llaman `start.sh`, `migrar()` y un `alembic upgrade` a mano.
- [x] **0.9** Repaso rápido de seguridad — estado: hecho · commit: `5eee473` · nota: tipo común de ticker en 46 parámetros (6 rutas no validaban); «/api/etfs/recomendar» estaba tapada por «/{symbol}» (arreglado); CORS e historial ya limpios; host 127.0.0.1 explícito; npm audit sin avisos.

## Fase 1 — Corrección y fallos visuales (P1)

- [x] **1.1** Tokens semánticos de color mínimos + `leerToken` + test de contraste — estado: hecho · commit: `90924e9` · nota: 14 tokens en `index.css`; `--text-muted` = #808eab (el #7c8aa8 del plan daba 4,37:1 sobre la superficie hundida); el test lee `index.css`; los rótulos `slate-400` existentes tienen el mismo 4,37:1 → para 2.13/4.1.
- [x] **1.2** V1 · colores del gráfico de precios — estado: hecho · commit: `bfba8f9` · nota: velas, rejilla, ejes, separadores de panel, RSI, MACD, medias y leyenda desde tokens (`leerToken`); volumen al 35 % en la quinta parte de abajo; logo con `var(--info)`; minigráficos, curva y matriz ya iban por clases invertidas (verificado en capturas). Guarda: ningún hexadecimal en `src/`. Pendiente fuera de V1: etiquetas de eje que se pisan entre paneles.
- [x] **1.3** V9 · etiquetas de IA — estado: hecho · commit: `9c68e0f` · nota: `components/ia/ContenidoIA.tsx` (etiqueta, bloque y botón con `--ai`/`--ai-bg`) sustituye 4 copias; también la píldora «IA activa». Hermanos: `text-amber-700` (3,45:1, 10 ficheros) → `amber-800`; `text-sky-950` dejaba invisible el coste antes de gastar en IA → `sky-900`. Guardas: fondos 50/100 y textos 700–950 solo si `index.css` los invierte; nada `violet-*` suelto. Test de render con IA presente.
- [x] **1.4** V3 · «undefined %» en el reparto del tamaño — estado: hecho · commit: `fc7e0d6` · nota: estado vacío «Hoy no hay candidatas que dimensionar»; campos del reparto opcionales en `types.ts`; «Ya en cartera» ya no rellena con 0. Guarda: ESLint con tipos (`restrict-template-expressions`, sin nulos en plantillas), que destapó 3 hermanos (modelo de IA, errores seguidos de alertas, precio en la barra de valoración). Trinquete: fuera la fila de `undefined`.
- [x] **1.5** V11 · contradicción en «Deuda y solidez» — estado: hecho · commit: `62f3b08` · nota: la lectura solo miraba deuda/capital y cobertura; ahora «sin datos» solo si faltan los cuatro datos de la sección, y si no dice lo que hay y nombra lo que falta. Deuda parcial dicha como en la Ronda 2 (nota y marcador compartido con Salud).
- [x] **1.6** V18 · etiquetas de ventana fija (5A, 10A, TTM) — estado: hecho · commit: `e70f3a8` · nota: el informe, Fundamentales y las dos valoraciones rotulaban «5A» una tasa calculada con los años que hubiera (uno en ACME); ahora `<Ventana>` dice la ventana real y la marca «parcial» si es corta, y la lectura del backend la nombra. Hermanos: el prompt del informe IA decía «CAGR 5A» con la ventana corta; la aceleración (5A frente a 3A) se calculaba con 3 años o menos, donde las dos tasas coinciden. Se quedan como están las cifras cuya ventana define el proveedor (`revenue_growth_5y`/`eps_growth_5y` de Finnhub, bono a 5 años de FRED). Guardas: tests de lectura y prompt en el backend; render del informe con la respuesta real de ACME.
- [x] **1.7** V4, V5, V8 · un solo sistema de formato (`formato.py` / `formato.ts`) — estado: hecho · commit: `00c5b77`, `4796384` · nota: módulos gemelos con una tabla de casos compartida (pytest y Vitest dan la misma cadena; el backend redondea como ICU). Frontend migrado en `00c5b77` (V5 y V8 en pantalla); backend aquí: 256 formatos sueltos y las cifras crudas («EPS estimado 0.52», «≥ 0.7», «90.0») pasan por `formato.py`. Hermanos: rótulos «media 200 ± X %» escritos a mano (ahora salen de la constante); `eps_estimate` 0,0 descartado por *falsy*; «de hace 0 min» y «nuevas 0» con el dato ausente; «€» y «B$» en ETFs sin moneda; cifras crudas en el prompt del informe IA (un `None` llegaba tal cual); con dos divisas, importes sin código en la cartera. Guardas: tabla compartida; test AST (especificadores, `round()` y constantes decimales crudas, 3 internos con motivo); ESLint contra `toFixed`/`toLocaleString`/`Intl`; patrón `decimal_punto` en los dos trinquetes de fugas. Fuera del trinquete las 6 filas del 1.7.
- [x] **1.8** V6 · identificadores internos, diccionario de etiquetas y `docs/GLOSARIO.md` — estado: hecho · commit: `2ad459b` · nota: un diccionario (`app/etiquetas.py`) con copia exportada al frontend y casos que demuestran que los dos etiquetan igual; fuera 11 diccionarios locales del frontend (dos `FAMILY_LABELS` idénticos entre ellos). Orígenes «analisis:14:35:00» → «análisis de las 14:35 UTC»; códigos desconocidos legibles y con aviso. Hermanos: «(modelo_interno)» dentro de frases de Expectativas; la regla anti-anticipación del replay en código; «net_debt» en un error; «EPS»/«Div. yield»/«Expense ratio» en pantalla. Guardas: exhaustiva (enums del backend + cada clave del paquete que emite códigos, clasificada como mostrada o interna); copia al día; etiquetas = tabla de materialidad de «Qué cambió»; glosario con columna «Nunca» que un test aplica a backend, frontend y diccionario. Fuera de los trinquetes las 11 + 37 filas del 1.8.
- [x] **1.9** V7 · gramática, plurales y concordancia — estado: hecho · commit: `5a4f217` · nota: `plural()` en `formato.py`/`formato.ts` (con casos en la tabla compartida); 21 frases del backend y 8 del frontend con su plural y el verbo y el adjetivo concordando («1 posición abierta no entra»). Los cuatro de la revisión: «una puntuación válida», «el punto salta si cae por debajo de 0,180», «El único punto de invalidación no se ha cruzado», «posición(es)». Hermanos: «1 de 3 puntos se han cruzado», «Ninguno de los 1 titulares», «1 no se pudieron comprobar», «undefined cambio(s)» si faltaba el recuento. Guardas: los cuatro casos (fallan con el código anterior); los trinquetes de fugas quedan VACÍOS en los dos lados.
- [x] **1.10** V13 · mensajes desfasados — estado: hecho · commit: `17d0b76` · nota: la lista diaria y la de sectores, cuando no puntúan, cuentan los motivos reales de cada empresa (`unavailable` y pendientes) en vez de «Revisa que FINNHUB_API_KEY…» (la puntuación sale de EDGAR); README sin «sin Alembic por ahora». Hermano: el calendario del panel de mercado tragaba el error y pintaba «Sin eventos (¿falta FINNHUB_API_KEY?)»; ahora un fallo se dice como fallo. Barrido: el resto de menciones a Finnhub son ciertas (pares, calendario, consenso). Guardas: test de la API con todo fallando (falla con el mensaje anterior) y render del calendario con fallo y con lista vacía.
- [x] **1.11** Modelo de Claude configurable — estado: hecho · commit: `34b23d3` · nota: `CLAUDE_MODEL` (por defecto `claude-sonnet-5-5`; `claude-opus-5-5` como alternativa; `ANTHROPIC_MODEL` se sigue leyendo como alias para no ignorar un .env existente); fuera el `claude-opus-5` escrito en `config.py` y en el proveedor. Un 404 del API (`NotFoundError`) da «Modelo de Claude no válido: <id>. Revisa CLAUDE_MODEL en .env.» en interpretar y en extraer. Hermano: la estimación de coste de Resultados usaba la tarifa de Opus 5 fuera cual fuera el modelo; ahora va por modelo y, sin tarifa conocida, no se inventa. Documentado en README y `.env.example`. Guardas: tests de configuración, del 404 y de la tarifa.
- [x] **1.12** Límites de plausibilidad del tipo de cambio — estado: hecho · commit: `02e6fc3` · nota: las bandas ya existían (`fx.BANDAS_POR_USD`, Ronda 2) pero solo se miraban al convertir, con la serie ya en caché: una serie del revés se rechazaba en cada lectura sin probar otra fuente. Ahora `validacion.py` la rechaza al recibirla (`fx.comprobar_serie`, mediana de la serie, la MISMA banda: sin copiarla ni moverla), como un NaN. Bandas sin tocar (las del plan, 0,85–1,75 para CAD, son más estrechas que las vigentes y el plan prohíbe cambiar umbrales). Guardas: serie invertida rechazada, buena aceptada, dato raro suelto aceptado, serie no FX sin mirar, y el router pasa a la siguiente fuente (los dos clave fallan con el código anterior).
- [x] **1.13** Validación con datos reales — estado: hecho · commit: `0e0c3df` · nota: `./start.sh validar` (no arranca servidores; pasa los argumentos al script) y `--informe`: `backend/data/validacion/validacion_AAAAMMDD.md` con cada PASS/FAIL/UNKNOWN, lo comparado y qué mirar a mano, más la lista manual del §13. **No se pudo correr con datos reales aquí** (el contenedor no tiene claves ni salida a los proveedores): queda para Victor, `./start.sh validar`. Comprobado de punta a punta contra una base temporal en modo `--solo-cache` (todo UNKNOWN con su motivo). Guardas: contenido y nombre del informe; `start.sh validar` con un python falso (argumentos y carpeta) y sin entorno.

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
| 0 | `fase-0-inicio` = `e917365` | hecha: 13 hallazgos, 12 arreglados y 1 para Victor (R1–R13, abajo) | no toca pantallas (las capturas de 0.6 se verificaron) | `fase-0-hecha` = `d78926e` |
| 1 | `fase-1-inicio` = `d78926e` | — | — | — |
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
| R6 | `capturas.ts` sale con 0 ante fallos; `scripts/` fuera de ESLint y tsc | hecho: lista de fallos y código 1 (botón ausente o «Cargando…» a los 15 s cuentan); `tsconfig.scripts.json` y ESLint con globals de Node | `95d7efb` |
| R7 | La copia de la base se salta en silencio (`backend/.env`, espacios, otros caminos que migran) | hecho: una sola implementación en Python que resuelve la ruta como el backend; copia también `migrar()` y `alembic upgrade`; aviso si no hay base; adiós `copia_base.sh` | `95d7efb` |
| R8 | `?symbol=` vacío y con espacios pasó a 422 sin documentar; validadores duplicados; `client.ts` sin codificar | hecho: los tipos normalizan (vacío = sin filtro, recorte, mayúsculas, «A, B» en listas); un solo validador (`validar_simbolo`), adiós a 9 copias y 13 alias; 28 URLs codificadas y guarda; `related` con varios tickers → el primero | `a0f0255` |
| R9 | Tests de contrato que pasan en vacío; unidades | hecho: datos obligatorios por empresa (falla si se grabó con claves caducadas); unidades por cociente (P/S, BPA, márgenes en fracción, capitalización); `null` grabado; grabación que cruza la medianoche se rechaza | `9a71543` |
| R10 | Casos extremos que no son lo que dicen (`solo_cache_viejo`, `precio_nan`) | hecho: descripciones honestas (el rescate real lo prueba `test_e2e_ciclo`, escenario E); caso nuevo `precio_nan_sin_historico`; el paquete ya no importa de `test_scan` | `9a71543` |
| R11 | Huecos de `test_seguridad.py` (símbolos buenos, rutas tapadas entre routers) | hecho: buenos por query, lista y cuerpo; vacío no es 422; solo 422 (no 404) para los malos; rutas tapadas con el orden real de registro | `a0f0255` |
| R12 | `/api/etfs/recomendar` sin verificación visual; README dice POST | hecho: ETF ficticios en la demo y captura `22b_etfs_recomendar` (1440 y 390, verificada); README con GET | `95d7efb` |
| R13 | El tipo de cambio de la cartera usa la hora real | **necesita a Victor**: anotado abajo (arreglarlo cambia el replay) | — |

## Revisión independiente de la Fase 1

| # | Hallazgo | Estado | Commit |
|---|---|---|---|
| S1 | 23 porcentajes del frontend escritos `${fmtNum(x, 1)} %`, con espacio normal (el «%» puede caer solo en la línea siguiente); visto al preparar la revisión | hecho: `fmtPct(…, { enPuntos })`, con `signo` donde se pintaba el «+» a mano (adiós a un `?? 0` de signo). Hermano: la distancia de «qué la cambiaría» (`falta +3,00 )` sin unidad, espacio normal con ella). Guarda: regla de ESLint (plantillas, JSX y literales que empiezan por « %») y test de render. Hermano en el backend: `experiments.py` («Último 30 % …» con `int()`); la guarda AST ahora ve un «%» con espacio normal tras una interpolación | `cc5ed78`, `492571a` |
| S2 | Códigos en crudo con `replace(/_/g, ' ')` en cinco pantallas: «LOW VOLATILITY» (Cartera), «working capital over assets» (Altman Z), «cfo inicio» / «change receivables» / «cuentas por cobrar_anterior» (Calidad), «Realestate» (sectores de un ETF), «guidance al alza» (Señales); visto al comparar las capturas | hecho: los cinco con `etiqueta()`; 47 etiquetas nuevas; el diccionario se consulta antes de decidir si algo es código (la clave «cuentas por cobrar_anterior» está congelada en el golden y no se toca). Guardas: regla de ESLint contra `replace(/_/g…)` fuera de `etiquetas.ts` (ve los 5); el test exhaustivo cubre las claves de las entradas de calidad, los componentes de Altman, los eventos de noticias y los sectores de yfinance (falla sin las etiquetas) | `e87e67e` |
| S3 | Seis cifras compactas a mano (`fmtNum(x / 1e6, 1) + ' M'`) en Valoración, Qué cambió, Expectativas y Calidad: sin «mil M» y con espacio normal | hecho: `fmtCompacto`. (Con un dato ausente pintarían «0 M», pero el backend ya responde 422 antes; no llegaba a pasar.) Guarda: regla de ESLint contra dividir por un literal ≥ 100.000 fuera de `formato.ts` (ve los seis) | `105d39f` |
| S4 | Recuentos sin `plural()` (revisor D1, C2, C7): «1 empresas cumplen», «aquí están las 1», «queda 1 puntos», «comprada hace 1 días», «1 minutos», «vez/veces», «1 operaciones seguidas», «0 de 1 parejas», «publicado hace None días» y «último trimestre (None)» en la confianza; en pantalla «+1 sobre 1 evaluables», «1 años», «1 empresas puntuadas», «1 observaciones», «hace 0 días» (Tesis) y «hace 10 min · hace 0 días» (Vigilancia); CAGR de BPA y FCF sin su ventana | hecho: `plural()` en los dos lados; «hoy» para 0 días; Tesis y Vigilancia con `fmtAntiguedad`; la ventana en los tres CAGR. Guardas: patrón `uno_plural` en los dos trinquetes de fugas (encontró «0 de 1 parejas» en el dimensionador, que nadie había visto) y test de los recuentos en `test_gramatica.py` (fallan sin el arreglo) | `7fe1398` |
| S5 | (revisor A1) El stop de una idea nueva salía «+12,8 %» en la tarjeta y «-12,8 %» en el disparador: `stop_pct` tiene dos convenios (distancia en una idea nueva; con signo sobre una posición) | hecho: `distanciaAlStop()` según `owned`; un stop perforado sigue positivo. Tipo documentado. Guarda: test | `940e18f` |
| S6 | (revisor A2) El replay con 0 marcas decía «Sin información posterior: 0 marcas comprobadas»; lo sin fecha verificable no salía | hecho: «No se pudo comprobar…»; lo sin fecha se nombra y quita la garantía. Guarda: test de render | `f21c559` |
| S7 | (revisor A3) Una cartera toda en CAD, o USD con una fila CAD sin tipo, salía sin códigos de moneda y con «no hay nada que convertir» | hecho: mezcla = alguna divisa distinta de la base en pantalla; nota y panel con el recuento real. Guarda: tests de fx y de pantalla. El paquete de casos extremos ya traía el caso (SHOP.TO) | `6dca25a` |

## Etiquetas

El proxy de este entorno deja empujar la rama pero corta los push de etiquetas, así que
las etiquetas viven en local. Cada sesión nueva las recrea desde la tabla de arriba:
`git tag fase-0-inicio e917365`, `git tag fase-0-hecha d78926e`, `git tag fase-1-inicio d78926e` (y así con las
que vengan).

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
- **`?? 0` en el frontend** (`grep -rn "?? 0" frontend/src`): la mayoría solo eligen un color por el
  signo, pero alguno puede pintar un 0 donde falta el dato. En 1.7 se arreglaron los que pintaban una
  cifra (tasa de acierto, minutos de un precio viejo, alertas nuevas); quedan los de color y orden.
  Para 2.1 (estados de dato).
- **El panel de mercado convierte cualquier fallo en «vacío»**: índices, sectores, curva y macro hacen
  `() => setX([])` al fallar, así que un error se pinta como «no hay datos». En 1.10 se arregló el
  calendario (el que llevaba el mensaje desfasado); los otros cuatro, para 2.1 (estados de dato).
- **Las posiciones cerradas no traen su moneda** (`ClosedPosition` en la API): con dos divisas, su P&L
  realizado sale sin código. Arreglarlo cambia el contrato de `/api/portfolio`; para 2.1 o 3.x.
- **El texto de la IA sale con el Markdown en crudo** («\*\*Lectura…\*\*»): `content_md` se pinta con
  `whitespace-pre-wrap`, sin interpretar. Visto en las capturas `con_ia` del ítem 1.3. Para 2.x (o
  pedir texto plano al modelo).
- **El golden congela `levels.objetivo` / `objetivo_pct`** y la pantalla Hoy lo muestra. Choca con
  «sin precios objetivo» (§3). No lo causa esta fase; si una fase lo retira, el golden cambiará y habrá
  que explicarlo.

- **Los sectores de las acciones salen en inglés** («Health Care», «Information Technology»): son los
  nombres GICS del universo, un dato y no un código, así que 1.8 no los tocó; los de un ETF (claves de
  yfinance) ya salen en español. Decidir en 2.x (glosario) si se traducen y con qué nombres.

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
