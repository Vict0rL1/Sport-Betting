// G2 (revisión del PR 17): el cielo y el motivo del clima llegaban en español del servidor y se
// enseñaban tal cual con la interfaz en inglés. Ahora llega un código estable que se traduce aquí.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { es } from '../i18n/es.ts';
import { en } from '../i18n/en.ts';
import { CIELOS, MOTIVOS_CLIMA, claveCielo, claveMotivoClima } from './clima.ts';

test('los cielos de la web son los del servidor', () => {
  const fuente = readFileSync(new URL('../../../server/src/weather/openMeteo.ts', import.meta.url), 'utf8');
  const m = /export const CIELOS = \[([^\]]+)\] as const/.exec(fuente);
  assert.ok(m, 'CIELOS no encontrado en el servidor');
  assert.deepEqual([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), [...CIELOS]);
});

test('cada cielo y cada motivo tienen su texto en los dos catálogos', () => {
  for (const c of CIELOS) {
    const k = claveCielo(c);
    assert.ok(k && k in es && k in en, `cielo ${c}`);
  }
  for (const m of MOTIVOS_CLIMA) {
    const k = claveMotivoClima(m);
    assert.ok(k && k in es && k in en, `motivo ${m}`);
  }
  assert.equal(claveCielo('otro-que-no-existe'), null);
  assert.equal(claveMotivoClima(undefined), null);
});
