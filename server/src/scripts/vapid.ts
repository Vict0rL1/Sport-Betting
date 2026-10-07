// `npm run vapid:generar` — un par de claves VAPID para Web Push. Pégalas en el .env (o en los
// secretos de Fly) como VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY, y pon VAPID_SUBJECT=mailto:tu@correo.
import webpush from 'web-push';

const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:tu@correo\n\n(no las subas a git: el .env está ignorado)`);
