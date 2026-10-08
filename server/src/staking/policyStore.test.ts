// La política versionada: la v1 son las constantes, editar crea versión, nada se reescribe,
// y lo inválido no entra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { politicaVigente, nuevaVersion, historial, politica, idPoliticaVigente, politicaPorDefecto, validarPolitica, olvidarPolitica } = await import('./policyStore.ts');
const { DEFAULT_CONFIG } = await import('./policy.ts');
const { getDb } = await import('../db.ts');

test('la v1 se siembra con las constantes del código y es lo que lee la app', () => {
  olvidarPolitica();
  const v = politicaVigente();
  assert.equal(v.id, 1);
  assert.equal(v.origen, 'seed');
  assert.deepEqual(v.config.staking, DEFAULT_CONFIG);
  assert.deepEqual(politica(), politicaPorDefecto());
  assert.equal(idPoliticaVigente(), 1);
});

test('nuevaVersion: hereda, valida, encadena parent_id e invalida la caché; lo inválido o idéntico no entra', () => {
  const v2 = nuevaVersion({ staking: { minEdge: 0.03 } }, 'más exigente', 'cli');
  assert.equal(v2.id, 2);
  assert.equal(v2.parent_id, 1);
  assert.equal(v2.config.staking.minEdge, 0.03);
  assert.equal(v2.config.staking.kellyFraction, 0.25, 'lo demás se hereda');
  assert.equal(politicaVigente().id, 2);
  assert.equal(politica().staking.minEdge, 0.03);
  assert.throws(() => nuevaVersion({ staking: { minEdge: 0.03 } }, null), /idéntica/);
  assert.throws(() => nuevaVersion({ staking: { kellyFraction: 0.5 as never } }, null), /kellyFraction/);
  assert.throws(() => nuevaVersion({ staking: { maxExposurePerDay: 0.5 } }, null), /maxExposurePerDay/);
  assert.throws(() => nuevaVersion({ staking: { inventada: 1 } as never }, null), /clave desconocida/);
  assert.throws(() => nuevaVersion({ otro: {} } as never, null), /grupo desconocido/);
  assert.throws(() => validarPolitica({ ...politicaPorDefecto(), recortes: { ...politicaPorDefecto().recortes, deriva: 2 } }), /recortes\.deriva/);
  assert.deepEqual(historial().map((h) => h.id), [2, 1]);
});

test('append-only: ni UPDATE ni DELETE en policy_versions', () => {
  const db = getDb();
  assert.throws(() => db.exec('UPDATE policy_versions SET nota = \'x\' WHERE id = 1'), /no se reescribe/);
  assert.throws(() => db.exec('DELETE FROM policy_versions WHERE id = 2'), /no se borra/);
});
