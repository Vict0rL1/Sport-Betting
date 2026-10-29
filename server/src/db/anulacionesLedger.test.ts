// Revisión data-guardian del 29 de octubre: los interruptores apagados desde Ajustes y los ajustes
// del usuario vivían en `meta`, en history.db. Un `fetch-data -- --force` (una historia nueva) los
// borraba sin decirlo, y el servidor y los scripts volvían a config/features.json: apuestas del
// banco y de las estrategias con interruptores que el dueño había apagado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb, getMeta, setMeta, MIGRACIONES } = await import('../db.ts');
const { LEDGER_SCHEMA } = await import('./layout.ts');
const { CLAVE_ANULACIONES } = await import('../features.ts');
const { CLAVE_AJUSTES } = await import('../ajustes/index.ts');

const db = getDb();
const settings = `${LEDGER_SCHEMA === 'main' ? '' : `${LEDGER_SCHEMA}.`}settings`;
const enMeta = (k: string) => db.prepare('SELECT value FROM main.meta WHERE key = ?').get(k) as { value: string } | undefined;
const enLedger = (k: string) => db.prepare(`SELECT value FROM ${settings} WHERE key = ?`).get(k) as { value: string } | undefined;

test('las anulaciones de Ajustes y los ajustes del usuario se guardan en el libro mayor y sobreviven a una historia nueva', () => {
  setMeta(CLAVE_ANULACIONES, JSON.stringify({ 'estrategias.laboratorio': false }));
  setMeta(CLAVE_AJUSTES, JSON.stringify({ idioma: 'en' }));
  assert.ok(enLedger(CLAVE_ANULACIONES), 'en ledger.settings');
  assert.equal(enMeta(CLAVE_ANULACIONES), undefined, 'no en la meta de la historia');
  assert.ok(enLedger(CLAVE_AJUSTES));
  // Una historia nueva (fetch-data --force) no trae meta del dueño: lo suyo sigue ahí.
  db.exec('DELETE FROM main.meta');
  assert.deepEqual(JSON.parse(getMeta(CLAVE_ANULACIONES) ?? '{}'), { 'estrategias.laboratorio': false });
  assert.deepEqual(JSON.parse(getMeta(CLAVE_AJUSTES) ?? '{}'), { idioma: 'en' });
});

test('la migración lleva al libro mayor lo que ya estaba en meta, no pisa lo que el libro mayor ya tenga, y lo recupera tras restaurar un libro mayor de antes', () => {
  const m = MIGRACIONES.find((x) => x.nombre === 'ajustes-al-ledger');
  assert.ok(m, 'hay una migración que los mueve');
  assert.equal(m?.destino, 'ledger');
  db.exec(`DELETE FROM ${settings} WHERE key IN ('${CLAVE_ANULACIONES}', '${CLAVE_AJUSTES}')`);
  // Como los dejaba el código de antes: en la meta de la historia.
  db.prepare('INSERT OR REPLACE INTO main.meta (key, value) VALUES (?, ?)').run(CLAVE_ANULACIONES, '{"politica.versionada":false}');
  db.prepare('INSERT OR REPLACE INTO main.meta (key, value) VALUES (?, ?)').run(CLAVE_AJUSTES, '{"idioma":"es"}');
  // Un valor más nuevo ya en el libro mayor manda sobre el de meta.
  db.prepare(`INSERT INTO ${settings} (key, value, updated_at) VALUES (?, ?, ?)`).run(CLAVE_AJUSTES, '{"idioma":"en"}', '2026-10-29T00:00:00.000Z');
  const ctx = { ledger: LEDGER_SCHEMA, fichero: 'ledger' as const };
  m!.up(db, ctx);
  m!.up(db, ctx);
  assert.equal(enLedger(CLAVE_ANULACIONES)?.value, '{"politica.versionada":false}');
  assert.equal(enLedger(CLAVE_AJUSTES)?.value, '{"idioma":"en"}', 'lo del libro mayor no se pisa');
  // La copia de meta se queda, dormida (getMeta lee el libro mayor). Si se restaura un libro mayor de
  // antes de la migración (sin la clave), la migración vuelve a correr y la recupera (revisión
  // data-guardian del 29 de octubre: borrarla de meta la perdía para siempre).
  assert.equal(enMeta(CLAVE_ANULACIONES)?.value, '{"politica.versionada":false}');
  db.exec(`DELETE FROM ${settings} WHERE key = '${CLAVE_ANULACIONES}'`);
  assert.equal(getMeta(CLAVE_ANULACIONES), null, 'un libro mayor restaurado de antes, sin la clave');
  m!.up(db, ctx);
  assert.deepEqual(JSON.parse(getMeta(CLAVE_ANULACIONES) ?? '{}'), { 'politica.versionada': false }, 'y vuelve');
});
