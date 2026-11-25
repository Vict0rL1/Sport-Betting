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

## Qué garantiza la entrega (seguimiento del PR #18, fase G)

- **«Enviado» quiere decir ACEPTADO por el canal**: Telegram, el webhook, el servidor de correo o el
  servicio de push contestaron que sí. Que la persona lo vea, la app no lo sabe: ningún canal lo
  confirma. El registro (`notification_log`, «Últimos envíos») guarda eso, aceptado o rechazado, con su
  error.
- **Los avisos al momento** se intentan una vez por canal. Un fallo queda en el registro con su error. La
  bandeja de la app los tiene siempre, haya canales o no.
- **Los aplazados por las horas de silencio** (`notification_pending`, en el libro mayor) sobreviven a un
  reinicio y salen al acabar la ventana:
  - Si al menos un canal los acepta, salen de la cola. El rechazo de los demás queda anotado y no se
    reenvía a quien ya lo aceptó.
  - Si ninguno los acepta, no cuentan como enviados: se quedan, con su intento y su error, y se
    reintentan con espera (5, 10, 20 y 40 minutos), hasta 5 intentos o hasta que caduquen.
  - Un rechazo definitivo (un HTTP 4xx que no sea 408 ni 429) no se reintenta.
  - Lo que se descarta, caduca o no cabe en la cola (200 como mucho) queda anotado.
  - Con los canales apagados o sin ninguno configurado, se quedan y caducan con su nota.
- **Al menos una vez, no «exactamente una vez».** Un aviso se envía y DESPUÉS se quita de la cola. Si el
  proceso cae entre medias, o se restaura una copia de seguridad de antes del envío, sale otra vez.
  - Sin un acuse del proveedor esa ventana no se puede cerrar.
  - El webhook lleva la misma cabecera `Idempotency-Key` en cada intento del mismo aviso, para que el
    receptor descarte el duplicado. La clave es un resumen y no lleva el contenido.
  - Telegram, el correo y Web Push no tienen dónde ponerla: allí un duplicado se ve.
- **En desarrollo y en los tests no sale nada a la red.** Los tests usan transportes de mentira, y la
  preparación de los tests bloquea `fetch`.
- **Los errores no guardan secretos.** Antes de anotarlos se quitan los valores de `WEBHOOK_URL`,
  `TELEGRAM_BOT_TOKEN`, `SMTP_PASS`, `SMTP_USER` y `VAPID_PRIVATE_KEY`, y cualquier `usuario:contraseña@`
  de una URL. Un transporte puede meter la URL entera en su mensaje de error.

