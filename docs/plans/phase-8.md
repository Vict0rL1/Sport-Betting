# Fase 8 — Ampliaciones (stretch)

Solo después de que las fases 1–7 estuvieran en verde, y cada pieza detrás de un interruptor
**apagado por defecto**. Ninguna publica una probabilidad sin la misma evidencia que los cinco
deportes actuales.

**Antes de empezar, un límite del entorno.** La política de red de este entorno rechaza las
fuentes que necesitan dos de las cuatro piezas: `api-web.nhle.com` y `api.nhle.com` (NHL),
`stats.nba.com` y `cdn.nba.com` (box scores de la NBA) y `api.telegram.org`. Lo que depende de
bajar datos se construye y se prueba con datos de test, pero no se puede validar aquí; se dice en
cada pieza.

## 8.1 NHL como sexto deporte, en sombra (`deportes.nhl`)

- Modelo: Elo con margen de goles y ventaja de campo, y goles por Poisson a partir del Elo (tasa
  de liga dividida según la diferencia); empate a 60 minutos resuelto en la prórroga/tanda con
  probabilidad ligada al Elo. Salidas: gana local / visitante (moneyline, prórroga incluida) y total
  de goles.
- Ingesta: lector de la API web de la NHL (`/v1/schedule/{fecha}` y `/v1/score/{fecha}`) a tablas
  propias de historia (`nhl_games`); `npm run update-data:nhl`. Falla con un mensaje claro si la
  fuente no contesta, y no escribe nada inventado.
- Backtest: flujo cronológico con el walk-forward común (Elo básico como baseline), fiabilidad y
  métricas; holdout final de la NHL reservado desde la temporada 2025 (`experiments/holdout.ts`).
- Registro de deportes: `DEPORTES_SOMBRA` en `sports.ts`. La NHL **no** entra en `SPORT_IDS` (ni en
  las pestañas, ni en Destacados, ni en el banco) hasta que su backtest esté en el registro de
  experimentos con la misma evidencia que los demás. Aquí no se puede correr: sin datos.

## 8.2 Props de jugador NBA: evaluación (`apuestas.propsNba`, sin modelo)

La hoja de ruta pide evaluar primero si hay box scores gratuitos. Resultado: **no es viable aquí**.
`stats.nba.com` y `cdn.nba.com` están bloqueados por la red de este entorno; además
`stats.nba.com` exige cabeceras de navegador y sus condiciones de uso no permiten una ingesta
automática, `balldontlie` pide clave y limita el plan gratuito, y Basketball-Reference prohíbe el
rastreo. Sin una fuente legítima y alcanzable no se construye un modelo de jugador: se documenta y
el interruptor queda reservado.

## 8.3 Asistente por Telegram (`asistente.telegram`)

El asistente determinista que ya existe (`ask/agent.ts`, las mismas plantillas permitidas) por un
bot de Telegram, con el token de las notificaciones (`TELEGRAM_BOT_TOKEN`). Trabajo programado que
pide `getUpdates` con desplazamiento guardado en el libro mayor, responde solo a los chats de
`TELEGRAM_CHAT_ID` (y de `TELEGRAM_ASISTENTE_CHATS`, si se quieren más) y deja todo lo demás sin
contestar. Probado con un `fetch` simulado; no se puede probar contra Telegram desde aquí.

## 8.4 Tenis en vivo punto a punto (`tenis.enVivo`)

El panel en vivo de la tarjeta de tenis ya deja teclear el marcador. Esto añade el modo punto a
punto: botones «punto para…», deshacer, el saque y el marcador avanzando con la MISMA regla del
servidor (`advancePoint`, expuesta en `POST /api/live/avanzar`), y el recuento de puntos al saque y
el último juego (¿fue break?) sacados del registro de puntos para la actualización bayesiana. Sin
fuente de marcador en vivo gratuita y fiable, no se conecta ninguna: se dice en la pantalla.

## Lo que salió

Las cuatro piezas, cada una detrás de su interruptor apagado. Tests: 442 → 464 (390 del servidor,
17 unitarios de la web, 57 de Playwright). Nada cambia con los interruptores en su valor por
defecto: el doctor da lo mismo que antes y la prueba de carga sigue dentro de presupuesto.

- **8.1 NHL en sombra**: modelo, ingesta, backtest con holdout desde la 2025-26, migración v12
  (`nhl_games`), `npm run update-data:nhl` y `npm run backtest:nhl`, `GET /api/nhl/sombra`, bloque en
  Diagnóstico y líneas del doctor. Probado con respuestas de la API simuladas y una liga sintética
  (el Elo predice antes de cada partido, el holdout no se puntúa, la ingesta no duplica y falla con
  un mensaje claro). **Sin cifras reales**: la red no alcanza `api-web.nhle.com`, la tabla está
  vacía y los parámetros siguen siendo de partida. Documentado en [NHL.md](../NHL.md).
- **8.2 Props de la NBA**: evaluados y **descartados por ahora**; sin fuente legítima y alcanzable no
  hay modelo. El interruptor queda reservado y el doctor avisa si se enciende.
- **8.3 Asistente por Telegram**: trabajo `asistente-telegram`, solo chats permitidos, desplazamiento
  en el libro mayor, texto plano, nunca lanza. Probado con un Telegram simulado; sin red hacia
  `api.telegram.org` no se ha probado de verdad.
- **8.4 Tenis punto a punto**: `POST /api/live/avanzar` con la regla del servidor, botones «Punto
  para…» y «Deshacer», recuento al saque y último juego (con break) hacia la actualización bayesiana.
  Probado en Playwright de punta a punta. Sin fuente de marcador en vivo: se teclea.

Las pantallas de la Fase 8 que dependen de un interruptor apagado no salen en el barrido de rutas;
sus pruebas de Playwright encienden el interruptor, comprueban y lo devuelven a su valor.
