# Informe de correcciones

Se actualiza al cierre de cada fase de `docs/FIX_PLAN.md`. Estados: **hecho** · **parcial** ·
**no hecho** · **necesita a Victor**. Las capturas «antes» están en `docs/revision/`; las de
cada fase, en `docs/revision/despues-faseN/` cuando la fase toca pantallas.

Última actualización: cierre de la Fase 0, tras la revisión independiente y sus arreglos.

## Fallos visuales de la revisión (V1–V18)

| ID | Estado | Causa raíz (una línea) | Commit | Test o guarda | Capturas |
|---|---|---|---|---|---|
| V1 | no hecho (1.2) | Colores del gráfico fijos del tema claro; el lienzo no hereda la paleta invertida | — | — | 03 |
| V2 | no hecho (2.12) | Barra lateral fija de 224 px sin variante móvil | — | — | 24, 25 |
| V3 | no hecho (1.4) — guarda puesta | Campo opcional del dimensionador tratado como obligatorio | — | fugas frontend (PENDIENTE 1.4) | 01 |
| V4 | no hecho (1.7) | Textos del backend formateados con f-strings (punto decimal) | — | — | 14, 04 |
| V5 | no hecho (1.7) | `Intl` es-ES no agrupa números de 4 cifras | — | — | 14 |
| V6 | no hecho (1.8) — guarda puesta | Códigos internos insertados en frases y pintados tal cual | — | fugas backend/frontend (PENDIENTES 1.8) | 08, 09, 11 |
| V7 | no hecho (1.9) — guarda puesta | Plantillas sin plural ni concordancia | — | fugas (PENDIENTES 1.9) | 08, 16 |
| V8 | no hecho (1.7) — guarda puesta | Redondeo a cero sin normalizar el signo | — | fugas frontend (PENDIENTE 1.7) | 10 |
| V9 | no hecho (1.3) | `bg-violet-50` fuera de la inversión de paleta | — | — | con_ia |
| V10 | no hecho (2.6) | 11 pestañas en una fila | — | — | 03 |
| V11 | no hecho (1.5) | — | — | — | 04 |
| V12 | no hecho (2.7) | Tesis leída con trimestre en un sitio y con ejercicio en otro | — | — | 08, 16 |
| V13 | no hecho (1.10) | Mensajes no actualizados al cambiar Finnhub por EDGAR | — | — | 01 |
| V14 | no hecho (2.2) | — | — | — | 14 |
| V15 | no hecho (2.4) | Dos componentes de barra distintos | — | — | 13, 14 |
| V16 | no hecho (2.5) | — | — | — | 13, 09 |
| V17 | no hecho (2.8) | — | — | — | 03 |
| V18 | no hecho (1.6) | — | — | — | 04 |

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
| §11.2 Tema por inversión de paleta | no hecho (1.1, 4.1) | — | — | — |
| §11.3 Ficheros grandes | no hecho (4.2) | — | — | — |
| §11.4 Sin CI ni tests de frontend | **hecho** | No existían | `a3aa047`, `1fa46c5` | CI en cada push y PR |
| §11.5 Modelo de Claude | no hecho (1.11) | — | — | — |
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
| 1.1–4.6 | no hecho | — | — | — |

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

## Lo que no se pudo verificar aquí

- **Datos reales.** El entorno no tiene claves y la red bloquea a los proveedores. El modo
  `--grabar` y los tests de contrato están probados sobre una red simulada con la forma de
  EDGAR, Finnhub, Twelve Data y FRED; la grabación de verdad la tiene que hacer Victor:
  `cd backend && .venv/bin/python scripts/validar_con_datos_reales.py --grabar`, revisar y hacer
  commit de `tests/fixtures/reales/*.json.gz`.
- **Etiquetas de git.** El proxy de este entorno no deja empujar etiquetas; están en local y
  su commit está en `docs/PROGRESS.md`.
- **Notificación de escritorio** de las alertas (sin sesión gráfica; pendiente desde el RC1).

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
