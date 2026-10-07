// Segundo factor TOTP (RFC 6238) con `node:crypto`, sin dependencias.
//
// HMAC-SHA1, pasos de 30 s y 6 dígitos: lo que generan Google Authenticator, Aegis, 1Password
// y el resto. Se aceptan el paso actual y uno a cada lado (±30 s) para absorber relojes
// desfasados. El secreto va en base32 porque es como lo piden las apps al escanear el QR.

import { createHmac, randomBytes } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(s: string): Buffer {
  const limpio = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let valor = 0;
  const out: number[] = [];
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c);
    if (i < 0) throw new Error(`carácter no base32: ${c}`);
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(b: Buffer): string {
  let bits = 0;
  let valor = 0;
  let out = '';
  for (const byte of b) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALFABETO[(valor << (5 - bits)) & 31];
  return out;
}

/** El código de un paso concreto (contador), como cadena de 6 dígitos. */
export function hotp(secreto: Buffer, contador: number, digitos = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(contador));
  const h = createHmac('sha1', secreto).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(bin % 10 ** digitos).padStart(digitos, '0');
}

export function totp(secretoBase32: string, ahoraMs = Date.now(), pasoS = 30, digitos = 6): string {
  return hotp(base32Decode(secretoBase32), Math.floor(ahoraMs / 1000 / pasoS), digitos);
}

/** ¿Vale el código ahora, con una ventana de ±1 paso? */
export function verificarTotp(secretoBase32: string, codigo: string, ahoraMs = Date.now()): boolean {
  const limpio = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) return false;
  const secreto = base32Decode(secretoBase32);
  const paso = Math.floor(ahoraMs / 1000 / 30);
  for (const d of [0, -1, 1]) if (hotp(secreto, paso + d) === limpio) return true;
  return false;
}

/** Un secreto nuevo (20 bytes, lo habitual) y la URL `otpauth://` para el QR. */
export function nuevoSecreto(etiqueta = 'Sports Predictor'): { secreto: string; otpauth: string } {
  const secreto = base32Encode(randomBytes(20));
  const otpauth = `otpauth://totp/${encodeURIComponent(etiqueta)}?secret=${secreto}&issuer=${encodeURIComponent(etiqueta)}&algorithm=SHA1&digits=6&period=30`;
  return { secreto, otpauth };
}
