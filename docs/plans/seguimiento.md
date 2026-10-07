# Seguimiento tras la hoja de ruta

Lo que las fases dejaron anotado y se puede arreglar sin decisiones nuevas de política. Mismo
método que las fases: plan, commits pequeños, todo en verde antes de cada uno.

## 1. El banco de papel mira sus propias pérdidas

Hallazgo de la Fase 6: el corte por pérdida diaria (5 % del banco) y semanal (10 %) del banco de
papel lee el registro **personal** (`bets`), que en la práctica está vacío. Es decir, el banco de
papel **no tiene límite de pérdida**. Los umbrales son los de la política vigente y no cambian; lo
que cambia es de dónde salen las pérdidas: de `paper_bets` liquidadas hoy y esta semana, con la
misma regla que ya usan las estrategias (día local de la liquidación, semana desde el lunes). Es
más conservador, nunca menos: solo puede hacer que el banco deje de apostar antes.

## 2. Topes por grupo de correlación en las estrategias

Las estrategias aplicaban el tope por partido y el total, pero no los de equipo y jugador, porque
sus apuestas no guardaban sus grupos. Migración v13: `strategy_bets.correlation_groups` (columna
nueva, congelada desde el INSERT como el resto; los triggers se rehacen con ella). Las apuestas
anteriores a la migración cuentan solo con el grupo de su partido, que se deduce exacto del
deporte y el id; sus equipos o jugadores no se inventan. Los límites: el tope por partido de la
estrategia y los de equipo y jugador de la política vigente, sobre el banco de cada estrategia.

## 3. CI

`ubuntu-latest` pasa a Ubuntu 26 el 19 de octubre de 2026; `playwright install --with-deps` puede
no soportarlo el primer día. Los trabajos se fijan a `ubuntu-24.04`. Las acciones (`checkout`,
`setup-node`, artefactos) siguen en su versión: GitHub ya las corre con Node 24 y desde aquí no se
puede comprobar qué versión nueva hay.

## Fuera

- Apostar a la mejor línea en vez de al consenso: es política, no un fallo.
- Esquemas de respuesta para las rutas de cada deporte: decenas de formas largas; se harían con
  su propio plan.
