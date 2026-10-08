# Progreso del plan de correcciones (`docs/FIX_PLAN.md`)

Una línea por ítem. Al cerrar cada commit: marcar, poner estado, hash y una nota de una línea.
Estados: `pendiente` · `en curso` · `hecho` · `parcial` · `necesita a Victor`.

Material de partida: `docs/REVISION_GENERAL.md` (revisión del 8-oct-2026) y sus 25 capturas en
`docs/revision/` (el conjunto «antes»).

## Fase 0 — Red de seguridad

- [x] **0.1** Tests de frontend (Vitest + Testing Library + jsdom, `npm test`) — estado: hecho · commit: `a3aa047` · nota: vitest 5 + jsdom 30; tests junto al código (`*.test.tsx`), también pasan por `tsc -b`.
- [x] **0.2** Integración continua (`.github/workflows/ci.yml`) — estado: hecho · commit: `1fa46c5` · nota: ESLint nuevo (recomendado, pasa limpio); ruff laxo (E9/F63/F7/F82); `tsc -b` en vez de `tsc --noEmit` (el tsconfig raíz no comprueba nada); auditorías solo informan.
- [ ] **0.3** Golden master del motor (`backend/tests/golden/`) — estado: pendiente · commit: — · nota: —
- [ ] **0.4** Paquete de casos extremos (`backend/tests/fixtures/extremos/`) — estado: pendiente · commit: — · nota: —
- [ ] **0.5** Tests contra fugas de texto (backend y frontend) — estado: pendiente · commit: — · nota: —
- [ ] **0.6** Capturas repetibles con un solo comando — estado: pendiente · commit: — · nota: —
- [ ] **0.7** Grabar y reproducir respuestas reales de proveedores — estado: pendiente · commit: — · nota: —
- [ ] **0.8** Copia de seguridad de la base en `start.sh` — estado: pendiente · commit: — · nota: —
- [ ] **0.9** Repaso rápido de seguridad — estado: pendiente · commit: — · nota: —

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

## Etiquetas

El proxy de este entorno deja empujar la rama pero corta los push de etiquetas, así que
las etiquetas viven en local. Cada sesión nueva las recrea desde la tabla de arriba:
`git tag fase-0-inicio e917365` (y así con las demás).

## Dónde me quedé

(Si una sesión termina a mitad de un ítem, aquí va exactamente qué falta.)
