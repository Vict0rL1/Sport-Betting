# Informe de correcciones

Se actualiza al cierre de cada fase de `docs/FIX_PLAN.md`. Estados: **hecho** · **parcial** ·
**no hecho** · **necesita a Victor**. Las capturas «antes» están en `docs/revision/`; las de
cada fase, en `docs/revision/despues-faseN/` cuando la fase toca pantallas.

Última actualización: cierre de la Fase 1, tras la revisión independiente y sus arreglos.
Capturas «después» de la Fase 1: `docs/revision/despues-fase1/<escenario>/<pantalla>_<ancho>.png`.

## Fallos visuales de la revisión (V1–V18)

| ID | Estado | Causa raíz (una línea) | Commit | Test o guarda | Capturas |
|---|---|---|---|---|---|
| V1 | **hecho** (1.2) | Colores del gráfico fijos del tema claro; el lienzo no hereda la paleta invertida. Revisión: ejes y cruz en formato inglés; SMA 200 y RSI con el color de la IA | `bfba8f9`, `d97b44a`, `f3e1427` | ningún hexadecimal en `src/`; test de `LOCALIZACION`; el color de IA solo en ContenidoIA | 03 |
| V2 | no hecho (2.12) | Barra lateral fija de 224 px sin variante móvil | — | — | 24, 25 |
| V3 | **hecho** (1.4) | Campo opcional del dimensionador tratado como obligatorio | `fc7e0d6` | ESLint `restrict-template-expressions` sin nulos; fugas | 01 |
| V4 | **hecho** (1.7) | Cada sitio formateaba a su manera (f-strings, `toFixed`). Revisión: 23 «%» con espacio normal, cifras en millones a mano, numpy como «—», ~30 fechas ISO | `00c5b77`, `4796384`, `cc5ed78`, `492571a`, `105d39f`, `f6f3d59`, `1aeb8f0` | tabla compartida pytest/Vitest; guarda AST; ESLint (`toFixed`, `Intl`, «%», `/1e6`); fugas `decimal_punto` y `fecha_iso` | 14, 04 |
| V5 | **hecho** (1.7) | `Intl` es-ES no agrupa números de 4 cifras | `00c5b77` | casos de 4 cifras en la tabla compartida; test de Portafolio | 14 |
| V6 | **hecho** (1.8) | Códigos internos insertados en frases y pintados tal cual. Revisión: `replace(/_/g)` en cinco pantallas, siglas («Bpa»), diccionarios paralelos | `2ad459b`, `e87e67e`, `8ffec21` | test exhaustivo (enums, claves y claves de diccionario); ESLint contra `replace(/_/g)`; paridad de los gemelos | 08, 09, 11 |
| V7 | **hecho** (1.9) | Plantillas sin plural ni concordancia. Revisión: «1 empresas», «hace 1 días», «0 de 1 parejas»… | `5a4f217`, `7fe1398` | fugas `plural_parentesis` y `uno_plural`; `test_gramatica.py` | 08, 16 |
| V8 | **hecho** (1.7) | Redondeo a cero sin normalizar el signo | `00c5b77`, `4796384` | casos −0 en la tabla compartida; fugas `menos_cero` | 10 |
| V9 | **hecho** (1.3) | `bg-violet-50` fuera de la inversión de paleta | `9c68e0f` | tokens `--ai`/`--ai-bg` y contraste medido | con_ia |
| V10 | no hecho (2.6) | 11 pestañas en una fila | — | — | 03 |
| V11 | **hecho** (1.5) | La lectura de «Deuda y solidez» solo miraba dos de cuatro datos | `62f3b08` | test de la lectura con datos parciales | 04 |
| V12 | no hecho (2.7) | Tesis leída con trimestre en un sitio y con ejercicio en otro | — | — | 08, 16 |
| V13 | **hecho** (1.10) | Mensajes no actualizados al cambiar Finnhub por EDGAR. Revisión: «¿falta FRED_API_KEY?», «cuota agotada» adivinada | `17d0b76`, `aadd0d7` | tests del motivo real por tipo de fallo | 01 |
| V14 | no hecho (2.2) | — | — | — | 14 |
| V15 | no hecho (2.4) | Dos componentes de barra distintos | — | — | 13, 14 |
| V16 | no hecho (2.5) | — | — | — | 13, 09 |
| V17 | no hecho (2.8) | — | — | — | 03 |
| V18 | **hecho** (1.6) | «5A» en tasas calculadas con los años que hubiera | `e70f3a8`, `7fe1398` | `<Ventana>` con test; también en los CAGR de BPA y FCF | 04 |

## Producto y navegación (§10 de la revisión)

| ID | Estado | Causa raíz | Commit | Test o guarda |
|---|---|---|---|---|
| §10.1 Portafolio y Cartera | no hecho (3.1) | — | — | — |
| §10.2 Dos DCF | no hecho (3.3) | — | — | golden `dcf_ficha` y `dcf_modulo` |
| §10.3 Cuatro rankings | no hecho (3.4) | — | — | — |
| §10.4 Tesis y Vigilancia | no hecho (3.2) | — | — | — |
| §10.5 Acciones básicas | no hecho (2.10) | — | — | — |
| §10.6 «Qué cambió» global | no hecho (2.11) | — | — | — |
| §10.7 Carga cognitiva | no hecho (2.9) | — | — | — |

## Deuda técnica (§11 de la revisión)

| ID | Estado | Causa raíz | Commit | Test o guarda |
|---|---|---|---|---|
| §11.1 Sin validar con datos reales | **necesita a Victor** | Sin claves ni red en el entorno de desarrollo | `4f6042e` | grabación y contrato listos; falta grabar con claves |
| §11.2 Tema por inversión de paleta | parcial (1.1 hecho; 4.1) | Colores escritos a mano que no se invierten | `90924e9` | tokens semánticos y test de contraste |
| §11.3 Ficheros grandes | no hecho (4.2) | — | — | — |
| §11.4 Sin CI ni tests de frontend | **hecho** | No existían | `a3aa047`, `1fa46c5` | CI en cada push y PR |
| §11.5 Modelo de Claude | **hecho** (1.11) | `claude-opus-5` escrito en el código; un id inválido daba «404» | `34b23d3`, `aadd0d7` | `tests/test_modelo_claude.py` |
| §11.6 Limitaciones de dato | fuera de alcance | Necesitan fuentes nuevas | — | documentadas en TODO.md |
| §11.7 README largo | no hecho (4.3) | — | — | — |

## Ítems del plan

| ID | Estado | Causa raíz / qué se hizo | Commit | Test o guarda |
|---|---|---|---|---|
| 0.1 | hecho | El frontend no tenía tests | `a3aa047` | `npm test` (Vitest + jsdom) |
| 0.2 | hecho | No había CI | `1fa46c5` | `.github/workflows/ci.yml`; en verde en GitHub |
| 0.3 | hecho | Nada demostraba que un arreglo no cambiara decisiones | `9439108`, `0c6ec32`, `4742548` | `tests/test_golden.py`: 11 componentes; inventario automático de 117 umbrales del motor, 95 cubiertos con prueba de sensibilidad y 22 exentos con motivo |
| 0.4 | hecho | Datos raros dispersos por cada test | `1c99295`, `9a71543` | `tests/test_extremos.py` (+ `precio_nan_sin_historico`) |
| 0.5 | hecho | Ningún test miraba el texto que ve la persona | `0c6ec32`, `e7cc849` | fugas backend y frontend con trinquete por sitio y recuento |
| 0.6 | hecho | Capturas hechas a mano fuera del repositorio | `399d9eb`, `3807b51`, `95d7efb` | `npm run capturas -- <salida>` (sale con 1 ante cualquier fallo); `tests/test_servidor_demo.py` |
| 0.7 | hecho · **falta grabar (Victor)** | Sin forma de probar datos reales en la suite | `4f6042e`, `9a71543` | `tests/test_contrato_reales.py` (datos obligatorios y unidades por cociente) |
| 0.8 | hecho | Migración al arrancar sin copia previa | `7b8994f`, `13aefc3` | `tests/test_copia_base.py` (también `migrar()` y `alembic upgrade`) |
| 0.9 | hecho | Validación de ticker copiada a mano; 6 rutas sin ella; una ruta tapada | `5eee473`, `a0f0255` | `tests/test_seguridad.py`; `frontend/src/api/client.test.ts` |
| 1.1 | hecho | Colores a mano que no siguen el tema | `90924e9` | test de contraste que lee `index.css` |
| 1.2 | hecho | V1 | `bfba8f9` | ningún hexadecimal en `src/` |
| 1.3 | hecho | V9; 4 copias de la etiqueta de IA | `9c68e0f` | guardas de fondos y textos de bajo contraste |
| 1.4 | hecho | V3 | `fc7e0d6` | ESLint con tipos |
| 1.5 | hecho | V11 | `62f3b08` | test de la lectura |
| 1.6 | hecho | V18 | `e70f3a8` | test de `<Ventana>` |
| 1.7 | hecho | V4, V5, V8 | `00c5b77`, `4796384` | tabla compartida, guarda AST, ESLint |
| 1.8 | hecho | V6 | `2ad459b` | test exhaustivo de etiquetas; `test_glosario.py` |
| 1.9 | hecho | V7 | `5a4f217` | `test_gramatica.py`; fugas |
| 1.10 | hecho | V13 | `17d0b76` | tests de la API y del calendario |
| 1.11 | hecho | Modelo escrito en el código | `34b23d3` | `test_modelo_claude.py` |
| 1.12 | hecho | Banda del tipo de cambio mirada solo al convertir | `02e6fc3` | `test_fx_validacion.py` |
| 1.13 | hecho · **falta correrlo con claves (Victor)** | Sin informe de validación | `0e0c3df` | test del informe y de `./start.sh validar` |
| 2.1–4.6 | no hecho | — | — | — |

## Revisión independiente de la Fase 0

Un revisor sin contexto previo leyó `git diff fase-0-inicio..HEAD` contra `CLAUDE.md` y §3 del plan.
Veredicto: «no se puede cerrar tal cual». No había violaciones que cambiaran decisiones, pero sí
agujeros en la red de seguridad. Encontró 13 hallazgos: 12 están arreglados y uno necesita a Victor
(el tipo de cambio con la hora real). Detalle, uno por uno y con su commit, en `docs/PROGRESS.md`
(«Revisión independiente de la Fase 0»). Lo más grave:

- El golden **no cumplía su criterio de hecho**: 14 umbrales se podían mover sin que fallara, y
  descartaba decisiones dichas con palabras («posición», «puntuación»).
- El trinquete de fugas contaba por token: una fuga nueva de un tipo conocido pasaba sin fallar.
- La demo de las capturas **inventaba** precio y PER para la empresa «sin datos». Al quitarlo
  apareció un fallo real: sin cotización, la ficha entera desaparece (anotado para 2.1).
- La copia de la base se podía saltar en silencio, y algunos caminos migraban sin copia.

## Revisión independiente de la Fase 1

Un revisor nuevo leyó `git diff fase-1-inicio..HEAD` contra `CLAUDE.md` y §3. No encontró tests
debilitados (comparó las 14 aserciones cambiadas: iguales o más estrictas) ni umbrales, reglas,
límites de tamaño o factores de confianza tocados; el golden pasa. Sí encontró fallos que la fase
había dejado. Los arreglé todos menos tres que necesitan a Victor o a la Fase 2; detalle por
hallazgo (S1–S14) en `docs/PROGRESS.md`. Lo más importante:

- **El stop de una idea nueva salía «+12,8 %»** en la tarjeta y «-12,8 %» en su disparador: dos
  convenios de `stop_pct` (`940e18f`). Un stop perforado de una posición sigue saliendo positivo.
- **El replay presentaba «0 marcas comprobadas» como garantía** de que no había información
  posterior, y lo que no tenía fecha verificable no salía (`f21c559`).
- **Una cartera toda en CAD**, o USD con una fila CAD sin tipo de cambio, salía **sin códigos de
  moneda** y con «no hay nada que convertir» (`6dca25a`). El paquete de casos extremos ya traía el caso.
- El SMA 200 y el RSI usaban **el color de la IA** (`f3e1427`).
- Hermanos de los ítems: 23 «%» con espacio normal, cifras en M a mano, códigos en crudo en cinco
  pantallas, siglas como «Bpa», unos 30 sitios con fechas ISO, recuentos sin plural, mensajes que
  adivinaban causas y ejes del gráfico en inglés. Cada familia tiene ahora una guarda que la
  habría visto (ESLint o un patrón de los trinquetes de fugas).

## Lo que no se pudo verificar aquí

- **Datos reales.** El entorno no tiene claves y la red bloquea a los proveedores. El modo
  `--grabar` y los tests de contrato están probados sobre una red simulada con la forma de
  EDGAR, Finnhub, Twelve Data y FRED; la grabación de verdad la tiene que hacer Victor:
  `cd backend && .venv/bin/python scripts/validar_con_datos_reales.py --grabar`, revisar y hacer
  commit de `tests/fixtures/reales/*.json.gz`.
- **Etiquetas de git.** El proxy de este entorno no deja empujar etiquetas; están en local y
  su commit está en `docs/PROGRESS.md`.
- **Notificación de escritorio** de las alertas (sin sesión gráfica; pendiente desde el RC1).
- **`./start.sh validar` con datos reales** (1.13): probado de punta a punta en modo `--solo-cache`
  contra una base temporal; con claves lo tiene que correr Victor.

## Qué cambió en el comportamiento

Ninguna decisión del motor. El golden master es idéntico desde su grabación en todo lo que
ya grababa. Sus ampliaciones solo añadieron cosas, comprobado campo a campo contra la grabación
anterior:

- veredictos largos y Hoy con cartera;
- los códigos con tilde que antes se descartaban;
- dos componentes nuevos, confianza y riesgo de cartera;
- casos al borde de cada umbral.

Cambios de comportamiento que NO son decisiones, todos en la frontera de la API:

- Un ticker inválido es ahora un 422 en todas las rutas (antes, seis lo aceptaban) y el patrón
  exige empezar por letra o número. Lo que ya funcionaba sigue igual: un `?symbol=` vacío es «sin
  filtro», los espacios de los extremos se recortan, el ticker llega en mayúsculas y «AAPL, MSFT»
  vale en las listas. El frontend codifica todo símbolo que pone en una URL.
- «¿Por qué importa?» en Noticias manda el primer ticker de `related` cuando Finnhub trae varios.
- `GET /api/etfs/recomendar` llega por fin a su manejador (antes lo tapaba `/api/etfs/{symbol}`):
  el botón «Analizar y recomendar» de ETFs empieza a funcionar.
- `start.sh` copia la base antes de arrancar y no arranca si la copia falla. El backend también
  copia antes de aplicar cualquier migración pendiente (también un `alembic upgrade` a mano), y no
  migra si la copia falla. Las copias van a `copias/` junto a la base (por defecto
  `backend/data/copias/`); las que hubiera en `backups/` se quedan donde están.

Fase 1, también sin decisiones (golden idéntico en cada commit). Cambia lo que se lee:

- Cifras, fechas, códigos y plurales con el formato de `formato.py`/`formato.ts` y las etiquetas de
  `etiquetas.py`, en pantalla y en las frases del backend (también las que congela una instantánea
  nueva; las viejas no se tocan).
- `mezcla_de_divisas` (`/api/portfolio`) es cierto si en pantalla hay alguna divisa distinta de la
  base, no solo si hay dos convertidas.
- `unavailable[].reason` de la lista diaria dice el motivo del router (no existe en ninguna fuente,
  sin cuota, ninguna configurada o fallando) en vez de «sin fundamentales o cuota agotada».
- `CLAUDE_MODEL` elige el modelo (por defecto `claude-sonnet-5-5`); un id inválido se dice con su
  nombre también al estimar el coste. Una serie de tipo de cambio fuera de su banda se rechaza al
  recibirla y se prueba la siguiente fuente.
- La deuda se llama «deuda a corto/largo plazo» en todo el diccionario.

## Riesgos o dudas para revisar

- **`thesis_watch.evaluar_noticia` usa la hora real** para la ventana de noticias, no el momento
  del análisis: un análisis a fecha pasada vigila noticias con la ventana de hoy. Arreglarlo
  cambia decisiones del replay → necesita tu visto bueno antes de tocarlo.
- El patrón de ticker endurecido rechaza símbolos que empiecen por «.» o «-». Ningún ticker real
  lo hace, pero si usas alguno raro, dímelo.
- **El tipo de cambio de la cartera también usa la hora real** (hallazgo del revisor): un análisis a
  fecha pasada convierte con el tipo de hoy. Misma familia que el de la tesis; mismo motivo para
  esperar tu visto bueno.
- **Sin cotización, la ficha entera desaparece** aunque EDGAR tenga datos. Previsto para 2.1.
- **El golden guarda `levels.objetivo`**, que la pantalla Hoy enseña: choca con «sin precios
  objetivo». Si se retira en una fase posterior, el golden cambiará y se explicará.
- **Atribución de los commits** (revisor de la Fase 1): llevan `Co-Authored-By: Claude Opus 5.5`,
  y `CLAUDE.md` dice «sin identificadores de modelo en commits». Es la línea que pide el entorno;
  quitarla de lo publicado exige reescribir el historial del PR. Tú decides.
- **Bandas de tipo de cambio cerca de la paridad**: un EUR, GBP o CHF leído del revés cae dentro de
  su banda (EUR 1,09 dentro de 0,5–1,8). Estrecharlas es cambiar un umbral: necesita tu visto bueno.
- **Hora de un instante sin zona**: el backend la escribe en UTC y la pantalla en la hora del
  navegador. Lo rotulado (replay, informe, dato de mercado en ET) ya es explícito; el resto, en 2.x.
- **Los sectores de las acciones salen en inglés** («Health Care»): son nombres GICS, un dato; los
  de un ETF ya salen en español. Decidir en 2.x si se traducen.
