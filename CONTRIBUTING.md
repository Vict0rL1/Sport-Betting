# Contribuir

Cómo se trabaja en este repositorio. Lo que hay aquí no son preferencias de estilo: son las reglas
que hacen que un número de la app se pueda creer. Si un cambio necesita saltarse alguna, el cambio
está mal planteado.

## Por fases

El trabajo grande va por fases (`docs/plans/`), y cada una sigue el mismo ciclo:

1. **Plan primero**: `docs/plans/phase-N.md` con lo que se va a hacer, en lotes pequeños, antes de
   escribir código. Se adapta lo que ya existe; no se duplica.
2. **Implementar por lotes**, un commit por lote, cada uno revisable por separado.
3. **Cada función de cara a la persona** va detrás de un interruptor en `config/features.json`
   (encendido por defecto salvo lo opcional), y no está terminada sin las cuatro piezas: API y
   pantalla, un test, una comprobación del doctor si deja estado, y un párrafo en `docs/`.
4. **Cerrar la fase**: la sección «Lo que salió» del plan (lo que no se hizo y por qué, también) y
   la entrada de `CHANGELOG.md` con las cifras de antes y después cuando cambian.

## Antes de cada commit

```sh
npm run lint
npm run typecheck
npm test                 # servidor + unitarios de la web
npm run build
npm run e2e              # Playwright, tras la build
npm run verify:data      # la base cumple sus invariantes
npm run doctor           # sin errores nuevos (sin ODDS_API_KEY sale uno esperado: el modo demo)
npm run carga:ci         # si tocas endpoints de predicciones o el canal SSE (presupuestos en config/presupuestos.json)
```

Los commits pasan por `.githooks/pre-commit` (`git -c core.hooksPath=.githooks commit`), que busca
secretos en lo que se sube. Nunca se sube `.env` ni se escribe una clave en el código, los tests o
la documentación; los tests no usan la red ni claves reales.

## No inventar datos

- Lo que no se sabe es **DESCONOCIDO**, no un cero ni una media. Un CLV que sería cero por
  construcción (se apostó al cierre) es desconocido; una cuota que no hay no se rellena.
- Las cuotas de demostración existen solo en el modo demo, etiquetadas, y nada que mida al modelo
  (banco de papel, estrategias, registro, CLV) las usa jamás.
- **Umbrales de muestra**: por debajo de 30 apuestas o de 100 predicciones no se saca ninguna
  conclusión ni se ordena nada por rendimiento; la cifra va con su aviso (`evaluation/sample.ts`).
- Ninguna pantalla presenta un backtest como si fuera rendimiento en vivo.

## Tablas inmutables

`paper_bets`, `strategy_bets`, los cinco `*_prediction_log`, `odds_snapshots`, `edge_signals`,
`alerts`, `policy_versions`, `strategies` y `reports` son append-only con triggers en la base: lo
que se escribió al apostar, predecir u observar no se reescribe ni se borra. Las correcciones son
filas nuevas. Si un test o una migración necesita tocar una fila existente, el test o la migración
están mal.

## El modelo y sus experimentos

- **Ninguna probabilidad publicada ni ningún parámetro del modelo cambia fuera del registro de
  experimentos** (`experiments/registry.jsonl`, `docs/EXPERIMENTOS.md`) y del versionado de modelos.
  Un cambio que se cree mejor entra como experimento, con su hipótesis, su conjunto, su métrica, su
  baseline y su veredicto; lo que no gana fuera de muestra se queda como sombra.
- **El holdout final no se toca**: fútbol 2026 en adelante y NFL 2024 en adelante. Nunca `--unlock`.
  `experiments/holdout.ts` lanza si alguien puntúa una temporada reservada.
- Correr un backtest de referencia escribe en `experiments/` (walk-forward, métricas, ensembles) y
  añade entradas al registro. Si solo hacía falta otra salida, se restauran los ficheros que no se
  querían cambiar: una entrada duplicada en el registro infla la familia de comparaciones.
- La política de apuestas (umbrales, topes, Kelly) se cambia creando una versión en
  `policy_versions`, nunca editando las constantes en el sitio.

## La interfaz

- Todo el texto, en español; el inglés llega por el catálogo (`web/src/i18n/`, español como fuente).
- Los colores salen de los tokens (`web/src/index.css`, `web/src/lib/theme.ts`); nada de hex sueltos
  nuevos.
- Sin CDN: fuentes y dependencias en `node_modules`, empaquetadas por Vite.
- Ningún fichero de `web/src/lib/` ni componente por encima de ~400 líneas: se parte por piezas sin
  cambiar las importaciones públicas.
- Cada ruta nueva pasa por el barrido de Playwright a 1.280 y 390 px sin desbordar.
- Las capturas de Playwright (`web/e2e/rutas.spec.ts-snapshots/`) solo se comparan con el mismo
  build de Chromium con el que se hicieron (`chromium.txt` al lado). Con otro, el test corre igual
  pero sin comparar píxeles, y lo anota. Para rehacerlas: `npx playwright test --update-snapshots`
  y la versión nueva en `chromium.txt`.

## Dónde mirar

| Para | Lee |
|---|---|
| El mapa del código | `docs/plans/00-codebase-map.md`, `docs/ARQUITECTURA.md` |
| La API | `docs/API.md` (y `/docs` con el servidor en marcha) |
| Los modelos y su evaluación | `docs/MODEL.md`, `docs/EXPERIMENTOS.md` |
| El dinero y el riesgo | `docs/DINERO_Y_RIESGO.md`, `docs/CONFIANZA.md` |
| Operación y scripts | `docs/OPERACION.md`, `npm run help` |
| Rendimiento | `docs/RENDIMIENTO.md` |
