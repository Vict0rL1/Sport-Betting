import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLOSARIO, GLOSARIO_EN, terminoDe, terminoEn } from './glosario';

test('el glosario tiene su versión inglesa completa y cae al español si falta', () => {
  for (const t of GLOSARIO) assert.ok(GLOSARIO_EN[t.clave], `sin inglés: ${t.clave}`);
  const clv = terminoDe('clv')!;
  assert.match(terminoEn(clv, 'en').corta, /closing odds/);
  assert.equal(terminoEn(clv, 'es').corta, clv.corta);
  assert.equal(terminoDe('no-existe'), null);
});
