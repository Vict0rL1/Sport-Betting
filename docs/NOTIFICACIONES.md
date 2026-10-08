# Notificaciones

Lo que llega **cuando no estás mirando**: el teléfono, Telegram, el correo, Discord o Slack.
Cada canal se configura con variables de entorno (`.env.example`); sin ninguna, todo queda en
«no configurado» y la app no se queja. Interruptor: `notificaciones.canales` en
`config/features.json`.

## Canales

| Canal | Variables | Cómo |
|---|---|---|
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Crea un bot con @BotFather, escríbele, y saca tu chat id (p. ej. con @userinfobot). |
| Webhook | `WEBHOOK_URL` | Una URL de Discord («Integraciones → Webhooks») o Slack; se manda `content` y `text`, cada uno lee el suyo. |
| Correo | `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_TO` | Cualquier SMTP (con 465 va con TLS directo). |
| Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npm run vapid:generar` las crea; después, en la app, Cuenta → Notificaciones → «activar» en cada navegador. El service worker (`web/public/sw.js`) enseña la notificación y abre la app al tocarla. |

En **Cuenta → Notificaciones** se ve cada canal (configurado o qué variable le falta) y un botón
«probar» que envía un mensaje de prueba; el resultado se enseña ahí mismo.

## Eventos

| Evento | Cuándo |
|---|---|
| `senal_valor` | una alerta `edge_umbral`: el modelo ve valor en un partido con precio real |
| `linea_movida` | una alerta `mercado_movido` en un partido seguido |
| `papel_apostada` | el banco de papel ha apostado |
| `papel_liquidada` | una apuesta de papel se ha liquidado (con el resultado y el banco) |
| `trabajo_fallido` | una ingesta envuelta en `conRegistro` ha fallado |
| `deriva` | una alerta de deriva de modelo |
| `digest_listo` | el resumen del día está archivado (Fase 6.7), con enlace a `/informes/:id` |
| `informe_semanal` | el informe de la semana anterior está archivado (Fase 6.8) |

Las alertas internas (`alerts`) siguen existiendo y son la fuente: lo que sale fuera es un
subconjunto. Una notificación que no se puede enviar **nunca** tumba el ciclo que la provocó.

**La bandeja (Fase 6.4).** Cada notificación y cada alerta deja además una fila en `inbox` (libro
mayor), haya o no un canal configurado: es lo que enseñan `/bandeja` y la campana con las no
leídas. De un aviso solo cambia si se ha leído; nada se borra. El enlace de cada uno lleva a la
ficha del partido (`/partido/:sport/:id?clave=…`) o al informe. Ver [PRODUCTO.md](PRODUCTO.md).

## Registro

Cada intento queda en `notification_log` (libro mayor): canal, evento, título, ok/error y
duración. `GET /api/notifications/canales` devuelve los canales y los últimos veinte envíos.
Una suscripción Web Push que falla cinco veces (o que el navegador da de baja: 404/410) se
descarta.

## El asistente por Telegram

Fase 8.3, interruptor `asistente.telegram` (apagado por defecto). Con el mismo bot de las
notificaciones (`TELEGRAM_BOT_TOKEN`), el trabajo `asistente-telegram` pide a Telegram cada minuto
los mensajes nuevos y contesta con **el mismo asistente determinista de la app**: las mismas
plantillas permitidas, ningún modelo de lenguaje y ninguna consulta libre a la base. Lo que no sabe,
lo dice. `/start` o `/ayuda` explican qué se le puede preguntar.

- **Solo contesta a quien debe**: los chats de `TELEGRAM_CHAT_ID` y, si se quieren más, los de
  `TELEGRAM_ASISTENTE_CHATS` (separados por comas). Un mensaje de cualquier otro chat se lee para no
  volver a pedirlo y no se contesta: un bot que responde a cualquiera abre los datos del libro mayor.
- **No contesta dos veces**: el último mensaje leído se guarda en el libro mayor (`telegram:offset`).
- **Texto plano**, sin formato: un nombre con un asterisco no rompe el mensaje.
- **Nunca tumba el servidor**: si Telegram no contesta, el trabajo lo registra y lo vuelve a
  intentar al minuto siguiente.

El doctor dice si está encendido sin token o sin chats permitidos (no contestaría a nadie) y cuál
fue la última actualización leída. Está probado con un Telegram simulado; el entorno donde se
construyó no alcanza `api.telegram.org`.

## API

- `GET /api/notifications/canales`
- `POST /api/notifications/test/:canal`
- `GET /api/notifications/push/clave` · `POST /api/notifications/push/subscribe` · `DELETE /api/notifications/push/subscribe`
