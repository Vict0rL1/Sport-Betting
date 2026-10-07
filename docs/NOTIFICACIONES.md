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

## API

- `GET /api/notifications/canales`
- `POST /api/notifications/test/:canal`
- `GET /api/notifications/push/clave` · `POST /api/notifications/push/subscribe` · `DELETE /api/notifications/push/subscribe`
