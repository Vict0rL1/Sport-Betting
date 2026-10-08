// Las cinco consultas más calientes pasan por índice. EXPLAIN QUERY PLAN no puede decir
// «SCAN» de una tabla grande: eso es leerla entera en cada petición.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { CONSULTAS_CALIENTES, planDe } = await import('./hot.ts');

test('ninguna consulta caliente hace SCAN de su tabla principal', () => {
  const db = getDb();
  for (const c of CONSULTAS_CALIENTES) {
    const plan = planDe(db, c.sql);
    const texto = plan.map((p) => p.detail).join(' | ');
    for (const t of c.tablasConIndice) {
      // «SCAN tabla» (o «SCAN alias») sin «USING INDEX» es lo que no puede pasar.
      const scan = plan.find((p) => new RegExp(`^SCAN (${t}|\\w+ AS ${t}|\\w+)\\b`).test(p.detail) && p.detail.includes(t) && !/USING (COVERING )?INDEX/.test(p.detail));
      assert.equal(scan, undefined, `${c.nombre}: ${t} se recorre entera → ${texto}`);
    }
    assert.ok(/SEARCH|USING (COVERING )?INDEX/.test(texto), `${c.nombre}: ni SEARCH ni índice → ${texto}`);
  }
});
