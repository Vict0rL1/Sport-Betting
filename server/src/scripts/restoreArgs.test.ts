import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opcionesComidasPorNpm, opcionesDesconocidas, restauracionConfirmada } from './restoreArgs.ts';

test('restore: una opción con errata para antes de restaurar; --verificar, --confirmar y el fichero pasan', () => {
  assert.deepEqual(opcionesDesconocidas(['--verificar', 'copia.db']), []);
  assert.deepEqual(opcionesDesconocidas(['copia.db', '--confirmar']), []);
  assert.deepEqual(opcionesDesconocidas(['copia.db']), []);
  assert.deepEqual(opcionesDesconocidas(['--verify', 'copia.db']), ['--verify']);
  assert.deepEqual(opcionesDesconocidas(['--verficar', 'copia.db']), ['--verficar']);
  assert.deepEqual(opcionesDesconocidas(['—verificar', 'copia.db']), ['—verificar'], 'la raya larga del corrector');
});

// Revisión data-guardian (20 de octubre): sin `--`, npm se queda la opción (`npm run restore
// --verificar copia.db` le da al script solo «copia.db» y pone npm_config_verificar). Restaurar de
// verdad pide `--confirmar`: si npm se lo come, el script no restaura.
test('restore: sin --confirmar no restaura, y una opción que npm se comió para antes de tocar nada', () => {
  assert.equal(restauracionConfirmada(['copia.db']), false);
  assert.equal(restauracionConfirmada(['copia.db', '--confirmar']), true);
  assert.deepEqual(opcionesComidasPorNpm({ npm_config_verificar: 'true' }), ['--verificar']);
  assert.deepEqual(opcionesComidasPorNpm({ npm_config_confirmar: 'true' }), ['--confirmar']);
  assert.deepEqual(opcionesComidasPorNpm({ npm_config_cache: '/x' }), [], 'las de npm de siempre no cuentan');
});
