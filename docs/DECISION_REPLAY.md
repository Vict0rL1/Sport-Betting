# Decision Replay, «Qué cambió» y atribución

Tres preguntas comparten la misma pieza: **¿qué sabía el sistema cuando decidió?**,
**¿qué cambió desde la última vez?** y **¿por qué decidió esto?** Las tres se
contestan con un documento congelado, versionado y comparable: el análisis de
empresa.

## Las piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Regla común anti-anticipación | `backend/app/punto_en_el_tiempo.py` | `disponible_en(publicado, decision, obtenido_en)` → True / False / None |
| Análisis de empresa | `backend/app/analisis_empresa.py` | Reúne precio, EDGAR con linaje, DCF inverso, tesis, noticias, señal, posición, decisión, riesgo, calidad, expectativas, confianza y coste de oportunidad |
| Traza de reglas | `backend/app/analysis/decision.py` | Cada decisión trae `reglas` (resultado, valor, umbral, papel) y `cambiaria` |
| Congelar y reproducir | `backend/app/snapshots.py` | `congelar_analisis`, `anterior_comparable`, `reproducir` |
| Diff material | `backend/app/analysis/cambios.py` | `comparar(anterior, actual)` con `MATERIALIDAD` |
| Confianza por evidencia | `backend/app/analysis/confianza.py` | 10 factores, regla de agregación escrita |
| API | `backend/app/routers/empresa.py`, `routers/snapshots.py` | `GET /api/empresa/{s}/analisis`, `/historial`, `/cambios/{id}`, `/materialidad`; `GET /api/snapshots/{id}/replay` |

## El registro: `DecisionSnapshot`, el mismo de siempre

No hay tabla nueva. El análisis se congela en `decision_snapshots` —inmutable por
ORM, triggers de SQLite (migración 0004) y huella SHA-256— con:

- `origen = "analisis:HH:MM:SS"` (la lista diaria sigue siendo `hoy:<mercado>`);
- `contexto = {esquema: 2, analisis, reglas, huella_material}`.

**Cuándo se crea una instantánea nueva.** La lista diaria congela la *primera*
decisión del día (es un experimento de forward testing). El análisis de empresa
se congela cuando cambia algo **material**: otra acción, otro resultado en alguna
regla, un filing nuevo, la tesis editada, otro estado de calidad, de riesgo o de
expectativas. Si solo se movió el precio, no: diez aperturas de la misma empresa
en una tarde no son diez decisiones. Al día siguiente siempre hay instantánea del día.

`evaluar_instantaneas.py` sigue midiendo solo **afirmaciones** (comprar, vender,
reducir, evitar): un «mantener» se congela para poder reconstruirlo, pero no es
una apuesta.

## La regla anti-anticipación

```
information_available_at <= decision_timestamp
```

Un solo helper, usado por el análisis, el replay, las expectativas y el backtest.
Tres respuestas:

- **True / False** cuando se puede decidir;
- **None** cuando no se puede probar: un dato sin fecha, o un dato fechado por
  DÍA (EDGAR) el mismo día de una decisión con hora. Un 8-K «del 12» pudo llegar
  a las 21:00; a las 14:35 no se conocía. Solo cuenta si el sistema lo obtuvo
  antes (`obtenido_en`).

Cada sección del análisis la aplica: un análisis a una fecha pasada no ve
cotizaciones, ejercicios o trimestres publicados después, tesis creadas o
editadas después (si se editó, su texto de entonces es **desconocido**: no se
enseña el de hoy), posiciones abiertas después, señales de listas posteriores ni
backtests ejecutados después.

## El replay

`reproducir(snap)` solo lee la instantánea:

1. Recorre `marcas` (cada dato fechado del documento: qué es, cuándo se publicó,
   cuándo se obtuvo) y **retira** lo fechado después de la decisión, listándolo.
2. Declara `no_congelado` (secciones que no existían en esa versión del esquema)
   e `incompletas` (secciones que entonces eran desconocidas). Nunca rellena con
   datos de hoy.
3. Comprueba la huella.

Una instantánea de la lista diaria (esquema 1) se reproduce también, pero dice que
solo congeló la señal, el precio y el tamaño.

## La atribución: la traza del propio motor

`decide()` no suma puntos: es una lista de reglas con prioridad y la primera que
se cumple decide. Por eso la atribución es su traza, no un segundo sistema:

```
comprar → vigilar
«Precio ≥ media de 200 sesiones + 2 %»: cumple (110.00 frente a 101.14) → no cumple (99.00 frente a 100.66)
papel: puntuacion_favorable  decide → a_favor   (sigue cumpliendo; ya no basta)
```

`cambiaria` lista, para cada acción alternativa, las condiciones con su umbral y
la distancia actual (en puntos o en %). Sale de los mismos umbrales que deciden.

Se comprobó contra la versión anterior del motor con 60 000 casos aleatorios: la
acción, las razones, los niveles y los disparadores son idénticos.

## Materialidad

`MATERIALIDAD` (en `cambios.py`) fija, por métrica, si el umbral es absoluto
(0,01 = 1 pp en una fracción) o relativo (0,03 = 3 %). Viaja versionado en cada
diff y se puede sobrescribir por llamada. La aparición o la pérdida de un dato se
enseñan siempre: perder un dato es un deterioro, no un «sin cambios».

La tesis se lee en cuatro listas —confirmados, deteriorados, invalidaciones,
riesgos nuevos— y, si entre los dos análisis se resolvió un evento de resultados,
incorpora su impacto en la tesis marcado como **trimestral**: la vigilancia de la
tesis mira ratios anuales y un trimestre que cruza el umbral llega antes por ahí.

El resumen en prosa por IA es opcional (`POST /api/empresa/{s}/cambios/resumen-ia`),
recibe solo el diff y va marcado como generado por IA.

## Confianza por evidencia

No es convicción: mide si hay base para decidir. Diez factores (completitud,
frescura del precio y de los fundamentales, contraste entre proveedores,
histórico, sensibilidad de la valoración al WACC, distancia a los umbrales,
reglas sin evaluar, resultados inminentes, validación de las reglas). Regla:
algún crítico → BAJA; ≥3 débiles o desconocidos → BAJA; 1–2 → MEDIA; ninguno →
ALTA. Un factor desconocido cuenta como débil.

El dimensionador la usa como entrada **declarada**: evidencia baja = mitad del
peso bruto, visible en `controles` y en los recortes (`FACTOR_EVIDENCIA_BAJA`,
dentro de la versión de reglas).
