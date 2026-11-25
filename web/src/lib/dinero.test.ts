// B2: la vista previa del formulario y el servidor calculan el dinero con el MISMO módulo. Este
// fichero es una copia exacta de server/src/dinero.ts (la web se construye sin el servidor); el
// test falla en cuanto las dos copias difieren, y comprueba la tabla común con la vista previa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASOS_DINERO } from './dinero.ts';
import { resultadoApuesta } from './mercado.ts';

const aqui = path.dirname(fileURLToPath(import.meta.url));

test('B2: web/src/lib/dinero.ts es idéntico a server/src/dinero.ts', () => {
  const web = fs.readFileSync(path.join(aqui, 'dinero.ts'), 'utf8');
  const servidor = fs.readFileSync(path.join(aqui, '..', '..', '..', 'server', 'src', 'dinero.ts'), 'utf8');
  assert.equal(web, servidor, 'copia server/src/dinero.ts a web/src/lib/dinero.ts');
});

test('B2: la vista previa da 1,28 por 1,02 a 1,25 y 2,42 por 1,05 a 2,30', () => {
  assert.deepEqual(resultadoApuesta(1.02, 1.25, 'won'), { pago: 1.28, neto: 0.26 });
  assert.deepEqual(resultadoApuesta(1.05, 2.3, 'won'), { pago: 2.42, neto: 1.37 });
});

test('B2: la tabla común se cumple en la vista previa (menos el cashout, que no sale de la cuota)', () => {
  for (const c of CASOS_DINERO) {
    if (c.estado === 'cashout') continue;
    assert.deepEqual(resultadoApuesta(c.stake, c.odds, c.estado), { pago: c.pago, neto: c.neto }, `${c.stake} × ${c.odds} ${c.estado}`);
  }
});
