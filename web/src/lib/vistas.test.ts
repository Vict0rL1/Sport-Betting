// E2 (revisión del PR 17): vistas guardadas de Partidos. Nombre, aplicar, renombrar y quitar; una
// fecha relativa («hoy», «mañana») sigue siendo relativa, y el panel abierto no forma parte de la vista.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const almacen = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => void almacen.set(k, v),
  removeItem: (k: string) => void almacen.delete(k),
};
const { leerVistas, guardarVista, renombrarVista, quitarVista, consultaDeVista } = await import('./vistas.ts');

test('E2: guardar, renombrar y quitar; el nombre se limpia y no se repite', () => {
  const a = guardarVista('  NHL de hoy  ', new URLSearchParams('deporte=nhl&dia=hoy&panel=nhl:1&panelClave=x'));
  assert.equal(a.nombre, 'NHL de hoy');
  assert.equal(a.consulta, 'deporte=nhl&dia=hoy', 'sin el panel abierto');
  assert.throws(() => guardarVista('nhl de hoy', new URLSearchParams('deporte=nhl')), /nombre-repetido/);
  assert.throws(() => guardarVista('   ', new URLSearchParams('')), /nombre-vacio/);
  renombrarVista(a.id, 'Hockey');
  assert.equal(leerVistas()[0].nombre, 'Hockey');
  quitarVista(a.id);
  assert.deepEqual(leerVistas(), []);
});

test('E2: una vista con «hoy» sigue diciendo «hoy» (no la fecha del día en que se guardó)', () => {
  const v = guardarVista('Mañana fútbol', new URLSearchParams('deporte=football&dia=manana'));
  assert.equal(consultaDeVista(v).get('dia'), 'manana');
  const fija = guardarVista('Un día', new URLSearchParams('dia=2026-11-30'));
  assert.equal(consultaDeVista(fija).get('dia'), '2026-11-30', 'una fecha elegida a mano se queda fija');
});

test('E2: un almacén estropeado no rompe', () => {
  almacen.set('predictor.vistas', '{no es json');
  assert.deepEqual(leerVistas(), []);
});
