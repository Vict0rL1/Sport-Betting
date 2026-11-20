// G2 (revisión del PR 17): cada código de error que el servidor puede devolver al apuntar una
// apuesta tiene su frase en los dos catálogos. Se leen los códigos del propio código del servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { es } from '../i18n/es.ts';
import { en } from '../i18n/en.ts';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const servidor = (f: string) => fs.readFileSync(path.join(aqui, '..', '..', '..', 'server', 'src', f), 'utf8');

test('G2: los códigos de error de las apuestas tienen frase en es y en', () => {
  const codigos = new Set([...`${servidor('routes/bets.ts')}\n${servidor('bets.ts')}`.matchAll(/'(apuesta\.[a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(codigos.size >= 24, `${codigos.size} códigos`);
  for (const c of codigos) {
    assert.ok(`apiError.${c}` in es, `falta apiError.${c} en es.ts`);
    assert.ok(`apiError.${c}` in en, `falta apiError.${c} en en.ts`);
  }
});
