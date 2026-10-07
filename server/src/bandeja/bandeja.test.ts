// La bandeja: entra todo lo que la app avisa, solo cambia «leída» y nada se borra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { getDb } = await import('../db.ts');
const { listarBandeja, marcar, noLeidas, urlPartido } = await import('./index.ts');
const { emitirAlerta } = await import('../alerts/engine.ts');
const { notificar } = await import('../notifications/index.ts');

const db = getDb();

test('una alerta y una notificación llegan a la bandeja, aunque no haya ningún canal', async () => {
  db.prepare("INSERT INTO naf_prediction_log (match_key, league, upcoming_id, commence_time, home_id, away_id, home_name, away_name, prob_home, reliability, predicted_at) VALUES ('nfl|kc|lv', 'nfl', 'odds-123', '2026-10-12T17:00:00Z', 'KC', 'LV', 'Chiefs', 'Raiders', 0.7, 'high', '2026-10-07T10:00:00Z')").run();
  assert.ok(emitirAlerta({ type: 'mercado_movido', severity: 'aviso', sport: 'nfl', matchKey: 'nfl|kc|lv', title: 'Chiefs vs Raiders: el mercado se mueve', body: '5 pp' }));
  await notificar('papel_apostada', { titulo: 'Banco de papel: Chiefs vs Raiders', cuerpo: 'Chiefs a 1,6', url: '/apuestas' }, { sport: 'nfl', matchKey: 'nfl|kc|lv' });
  const b = listarBandeja();
  assert.equal(b.avisos.length, 2);
  assert.equal(b.noLeidas, 2);
  const alerta = b.avisos.find((a) => a.origen === 'alerta')!;
  assert.equal(alerta.tipo, 'mercado_movido');
  assert.equal(alerta.severidad, 'aviso');
  assert.ok(alerta.alert_id && alerta.alert_id > 0);
  assert.equal(alerta.url, '/partido/nfl/odds-123?clave=nfl%7Ckc%7Clv', 'enlace a la ficha por el id de próximos');
  assert.equal(b.avisos.find((a) => a.origen === 'notificacion')!.tipo, 'papel_apostada');
});

test('filtros: por leída, tipo y deporte; paginación por cursor', () => {
  assert.equal(listarBandeja({ tipo: 'mercado_movido' }).avisos.length, 1);
  assert.equal(listarBandeja({ sport: 'tennis' }).avisos.length, 0);
  const uno = listarBandeja({ limite: 1 });
  assert.equal(uno.avisos.length, 1);
  assert.equal(uno.hayMas, true);
  assert.equal(listarBandeja({ antesDe: uno.avisos[0].id }).avisos.length, 1);
});

test('marcar: unas, todas, y de vuelta a no leídas', () => {
  const [a] = listarBandeja().avisos;
  assert.equal(marcar({ ids: [a.id] }, true), 1);
  assert.equal(noLeidas(), 1);
  assert.equal(listarBandeja({ leida: false }).avisos.length, 1);
  assert.equal(marcar({ todas: true }, true), 1);
  assert.equal(noLeidas(), 0);
  assert.equal(marcar({ ids: [a.id] }, false), 1);
  assert.equal(noLeidas(), 1);
  assert.equal(marcar({ ids: [] }, true), 0);
});

test('solo cambia «leída»; nada se borra', () => {
  assert.throws(() => db.prepare("UPDATE inbox SET titulo = 'otro'").run(), /solo cambia si se ha leído/);
  assert.throws(() => db.prepare('DELETE FROM inbox').run(), /no se borra/);
});

test('urlPartido sin registro usa la clave; sin datos, nada', () => {
  assert.equal(urlPartido('football', 'epl|a|b'), '/partido/football/epl%7Ca%7Cb?clave=epl%7Ca%7Cb');
  assert.equal(urlPartido(null, 'x'), null);
});
