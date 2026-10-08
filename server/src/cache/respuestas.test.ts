// La caché de respuestas: sirve lo mismo mientras la firma no cambie y caduca a su hora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { cacheado, firmaDe, olvidarCache, estadoCache, registrarCalentador, calentar, TTL_MS } = await import('./respuestas.ts');
const { getDb } = await import('../db.ts');

test('misma firma y dentro del TTL: no se recalcula', () => {
  olvidarCache();
  let n = 0;
  const calc = () => ({ n: ++n });
  const a = cacheado('x', 'f1', calc, 1000);
  const b = cacheado('x', 'f1', calc, 1000 + TTL_MS - 1);
  assert.equal(a, b);
  assert.equal(n, 1);
  cacheado('x', 'f2', calc, 1000 + 10);
  assert.equal(n, 2, 'firma nueva: se recalcula');
  cacheado('x', 'f2', calc, 1000 + 10 + TTL_MS);
  assert.equal(n, 3, 'caducada: se recalcula');
  const e = estadoCache();
  assert.ok(e.aciertos >= 1 && e.fallos >= 3 && e.invalidadas >= 2);
});

test('la firma cambia con las filas de próximos y no con otra cosa', () => {
  const db = getDb();
  const f0 = firmaDe('naf_upcoming');
  assert.equal(firmaDe('naf_upcoming'), f0, 'estable');
  db.prepare("INSERT INTO naf_upcoming (id, league, commence_time, home_id, away_id, home_name, away_name, source) VALUES ('c1', 'nfl', '2026-10-12T17:00:00Z', 'KC', 'LV', 'Chiefs', 'Raiders', 'live')").run();
  const f1 = firmaDe('naf_upcoming');
  assert.notEqual(f1, f0, 'un partido nuevo');
  db.prepare("UPDATE naf_upcoming SET odds_home = 1.55 WHERE id = 'c1'").run();
  assert.notEqual(firmaDe('naf_upcoming'), f1, 'una cuota nueva');
  assert.match(firmaDe('tabla_que_no_existe'), /^sin-firma-/, 'si no se puede firmar, no se cachea');
});

test('calentar llama a cada calentador y sobrevive a uno que falla', () => {
  let llamado = 0;
  registrarCalentador('bueno', () => llamado++);
  registrarCalentador('malo', () => {
    throw new Error('x');
  });
  const avisos: string[] = [];
  assert.ok(calentar((m) => avisos.push(m)) >= 1);
  assert.equal(llamado, 1);
  assert.ok(avisos.some((m) => m.includes('malo')));
});
