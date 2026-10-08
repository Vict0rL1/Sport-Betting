// `npm run totp:secreto` — un secreto TOTP nuevo para el segundo factor.
//
// Imprime el secreto (para TOTP_SECRET en el .env o en `fly secrets`) y la URL otpauth://
// que entienden las apps de autenticación; pegándola en un generador de QR cualquiera se
// escanea. No escribe nada en ningún sitio: la decisión de activarlo es tuya.

import { nuevoSecreto, totp } from '../auth/totp.ts';

const { secreto, otpauth } = nuevoSecreto();
console.log('\nSecreto TOTP (base32):\n');
console.log(`  ${secreto}\n`);
console.log('Ponlo en el .env como  TOTP_SECRET=' + secreto + '  (o: fly secrets set TOTP_SECRET=…) y reinicia.');
console.log('\nURL para la app de autenticación (pégala en un generador de QR o añade el secreto a mano):\n');
console.log(`  ${otpauth}\n`);
console.log(`Código de este momento, para comprobar que la app coincide: ${totp(secreto)}\n`);
