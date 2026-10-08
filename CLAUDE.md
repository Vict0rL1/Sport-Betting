# CLAUDE.md

App personal de análisis de acciones. Backend FastAPI + SQLite (`backend/`),
frontend React + Vite + TypeScript + Tailwind 4 (`frontend/`). Todo en español:
código nuevo, comentarios, mensajes de error, textos de UI, docs y commits.

## Antes de tocar nada

- **Nunca** commitear `.env` (lleva las API keys; está en `.gitignore`).
- **Nunca** borrar ni reiniciar `backend/data/app.db`: son los datos del usuario
  (posiciones, tesis, instantáneas inmutables). Nunca sugerir `git clean -fdx`,
  que borra las dos cosas.
- Los tests **no tocan** la base real: `tests/conftest.py` apunta
  `DATABASE_PATH` a un temporal antes de importar `app`. Mantenerlo así.
- Ramas: trabajar en la rama asignada a la sesión, no empujar a otras y no
  abrir PR salvo que se pida. Commits pequeños que expliquen el porqué; sin
  identificadores de modelo en commits ni en el código.
- Para matar servidores de desarrollo, por PID y excluyendo la propia shell
  (`$$`): un `pkill -f` con un patrón amplio mata la shell que lo ejecuta.

## Principios (completos en README, «Principios de diseño»)

- **Ausente ≠ cero.** Un dato que falta viaja como `None` y se dice; nunca se
  rellena con 0, con un supuesto no declarado ni con `x or valor` (un 0,0 real es
  *falsy*: usar `is None`). Si se cuenta algo como cero, se marca (`parcial`).
- **UNKNOWN / STALE / ERROR nunca se convierten en PASS.** «No se pudo
  comprobar» es su propio estado.
- **Controles de riesgo fail-safe.** Ante la duda, avisar: un stop perforado no
  se calla por falta de un dato.
- Una señal es una regla escrita (`analysis/decision.py`); toda cifra lleva
  fuente y fecha; sin precios objetivo ni predicciones puntuales; lo calculado y
  lo generado por IA van separados y etiquetados.

## Convenciones que el código ya sigue

- **Fechas con zona, siempre.** UTC en el backend; SQLite pierde la zona al
  guardar, así que se sirve con `snapshots.iso_utc`.
- **Cifras para una persona:** solo con `app/formato.py` / `src/lib/formato.ts`
  (`fmt_num`, `fmt_pct`, `fmt_dinero`, `fmt_compacto`, `fmt_fecha`, `fmt_antiguedad`),
  gemelos probados contra la misma tabla (`formato.casos.json`). Nada de `{x:.1f}`
  ni `toFixed`: un test y ESLint lo impiden. Con varias monedas, cada importe lleva
  su código.
- **Punto en el tiempo:** toda reconstrucción del pasado pregunta a
  `app/punto_en_el_tiempo.py` (`disponible_en`, `barra_disponible`, `filtrar`).
  No comparar fechas a mano. Un dato fechado por día el mismo día de una
  decisión con hora no está disponible salvo prueba (`obtenido_en`).
- **El motor de decisión** es una lista de reglas con prioridad; su traza
  (`reglas`, `cambiaria`) ES la explicación. No crear sistemas de explicación
  paralelos. El tamaño se decide en `analysis/sizing.py`, no en `decision.py`.
- **Una sola versión de cada cosa:** si algo existe a medias, se mejora; no se
  crea otro módulo paralelo. Varios lotes del mismo símbolo se agregan con
  `contexto_cartera.posiciones_para_decidir`.
- **Lógica de dominio pura** (en `app/analysis/` y módulos de `app/`),
  independiente de los routers y de la UI; los routers solo ensamblan.
- **Base de datos:** migraciones Alembic en `backend/migrations/versions/`,
  nunca destructivas; `init_db()` migra al arrancar. `decision_snapshots` y
  `expectations` son inmutables (eventos ORM + triggers): una corrección es una
  fila nueva.
- Los comentarios explican por qué existe el código y qué fallo evita, citando
  el caso. Mantener esa densidad y ese tono.

## Comandos

```bash
cd backend && python -m pytest -q -p no:cacheprovider     # suite completa (~30 s)
cd frontend && npx tsc -b && npm run build                 # type-check + build
cd backend && python scripts/validar_con_datos_reales.py   # coherencia con datos reales (necesita claves)
```

Dobles de prueba: `session_factory` (SQLite en memoria) y
`tests/fakes_empresa.py` (`ServicioFalso`, `periodo`, `trimestre`, `barras`).
Un test nuevo debe fallar sin el arreglo: comprobarlo.

Verificación en navegador: Playwright está instalado globalmente; cargarlo con
`createRequire` desde `npm root -g` y servir la app con un servicio falso
inyectado, nunca con datos del usuario.

## Documentación

`docs/DECISION_REPLAY.md`, `docs/EXPECTATION_TRACKING.md`,
`docs/PORTFOLIO_RISK.md`, `docs/RC1_CHECKLIST.md` y el README. Si un cambio
altera una regla, un umbral o un contrato de la API, actualizar el documento
que lo describe en el mismo commit.
