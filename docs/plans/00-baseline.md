# Línea base (7 de octubre de 2026, 00:40 UTC)

Commit de partida: `e40abbf` («Pestaña «Destacados»…»), rama `claude/tennis-prediction-app-jlhgxh`.
Entorno: Node v22.22.2, Linux, sin `ODDS_API_KEY`, sin acceso a ESPN ni a la API de la MLB
(bloqueados por la red de este contenedor), con acceso a GitHub (openfootball, nflverse, hoopR).

| Comando | Resultado | Detalle |
| --- | --- | --- |
| `npm run typecheck` | ✅ exit 0 | servidor y web, 0 errores |
| `npm run lint` | ✅ exit 0 | oxlint sobre `server/src`, `web/src`, `scripts` |
| `npm run build` | ✅ exit 0 | Vite, 2,4 s |
| `npm test` | ✅ exit 0 | **202 tests, 202 pasan, 0 fallan**, 9,0 s (29 ficheros, todos del servidor) |
| `npm run verify:data` | ✅ exit 0 | **494 comprobaciones, todas correctas** |
| `npm run doctor -- --sin-red` | ⚠ exit 1 | 1 error y 2 advertencias, **todos esperados aquí**: sin `ODDS_API_KEY` (modo demostración), backend apagado durante la comprobación, y la sección CONFIANZA solo informa (sin partidos con cuota real). |
| `npm run audit` | ⚠ exit 1 | **1 de 4.529 comprobaciones falla**, por estado local de los datos, no por código: ver abajo. |

## La comprobación del audit que falla

`fútbol: nada anterior a la ventana sobrevive a un refresco — más antiguo 2026-10-06T18:30,
ventana desde 2026-10-06T18:40, último refresco 2026-10-07T00:06`.

La ventana de «hoy» es `min(medianoche local, ahora − 6 h)`; en este contenedor (UTC, 00:40) son
las 18:40 del día anterior. Un partido de demostración de las 18:30 sobrevivió a un refresco de
cuotas de las 00:06 (el que disparó `npm run dev` al revisar la pantalla). El audit lo interpreta
como «el pruning no limpia». Es un caso de borde del generador de demostración con la ventana
rodante de 6 h cerca de medianoche; no afecta a datos reales. Se anota para la Fase 2B (corrección
de ingesta), donde se decidirá si el pruning debe usar la misma ventana que la pantalla.

## Cifras de los modelos (sin cambios desde la revisión)

| Deporte | n | Log loss | Brier | ECE |
| --- | --- | --- | --- | --- |
| Tenis | 22.062 | 0,6133 | 0,2132 | 0,64 pp |
| Fútbol | 20.824 | 1,0143 | 0,3037 | 0,78 pp |
| Baloncesto | 85.562 | 0,5919 | 0,2033 | 0,12 pp |
| Béisbol | 14.428 | 0,6756 | 0,2414 | 0,58 pp |
| NFL | 3.781 | 0,6284 | 0,2194 | 0,46 pp (mercado de cierre: 0,6114) |

Fuente: `experiments/backtest_metrics.json`. Toda fase que toque un modelo compara contra esta tabla.

## Estado de los datos en este entorno

| Deporte | Archivo hasta | Nota |
| --- | --- | --- |
| Fútbol | 2026-09-20 | openfootball; football-data.co.uk no se probó aquí |
| Baloncesto | 2026-06-14 | hoopR; ESPN bloqueado |
| Béisbol | 2025-09-28 | Retrosheet; MLB Stats API bloqueada |
| NFL | 2026-10-05 | nflverse, al día |
| Tenis | 2026-01-17 | TML congelado; WTA vacía |

Registro en vivo: 56 predicciones (24 con resultado), 0 apuestas de papel, 64 evaluaciones de
confianza (todas NFL). Es la referencia para «¿Acertó?» y la página de Confianza.

## Cómo repetir la línea base

```bash
npm run typecheck && npm run lint && npm run build && npm test && npm run verify:data
npm run doctor -- --sin-red   # exit 1 sin clave: esperado
npm run audit                  # ver la nota de arriba
```
