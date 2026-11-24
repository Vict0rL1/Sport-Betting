// Fase C (5): «Lo que usó el modelo». Las entradas de cada instantánea se guardaron con su etiqueta en
// español (filas inmutables). Se escriben en el idioma elegido por su CLAVE y los nombres del partido,
// sin leer la frase guardada; y solo si el código dice exactamente lo que se guardó.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entradasConCodigo } from './entradas.ts';
import { rellenar, EXPLICACIONES } from './index.ts';

const escrita = (e: { codigo: string; params: Record<string, never> } | null) => (e ? rellenar(EXPLICACIONES[e.codigo as keyof typeof EXPLICACIONES], e.params) : null);

test('cada entrada de la NFL lleva su código, y el código escrito es la etiqueta guardada', () => {
  const guardadas = {
    eloLocal: { etiqueta: 'rating de Kansas City Chiefs', valor: 1650.2 },
    eloVisit: { etiqueta: 'rating de Buffalo Bills', valor: 1620 },
    qbLocal: { etiqueta: 'QB de Kansas City Chiefs', valor: 'P. Mahomes' },
    qbVisit: { etiqueta: 'QB de Buffalo Bills', valor: null },
    techo: { etiqueta: 'techo del estadio', valor: 'outdoors' },
  };
  const r = entradasConCodigo('nfl', guardadas, ['Kansas City Chiefs', 'Buffalo Bills']);
  assert.deepEqual(r.map((x) => x.clave), ['eloLocal', 'eloVisit', 'qbLocal', 'qbVisit', 'techo']);
  for (const x of r) assert.equal(escrita(x.explicacion as never), x.etiqueta, x.clave);
  assert.equal(r[3].valor, null, 'lo que no se sabía sigue sin saberse');
});

test('el tenis nombra a cada jugador; el fútbol, al local y al visitante (con el empate en medio)', () => {
  const t = entradasConCodigo('tennis', { eloP2: { etiqueta: 'Elo efectivo de Rune', valor: 1800 }, superficie: { etiqueta: 'superficie', valor: 'Clay' } }, ['Sinner', 'Rune']);
  assert.deepEqual(t.map((x) => escrita(x.explicacion as never)), ['Elo efectivo de Rune', 'superficie']);
  const f = entradasConCodigo('football', { onceVisit: { etiqueta: 'alineación de Chelsea publicada', valor: false } }, ['Arsenal', 'Empate', 'Chelsea']);
  assert.equal(escrita(f[0].explicacion as never), 'alineación de Chelsea publicada');
});

test('una etiqueta guardada que el código no reproduce, o una clave desconocida, se queda sin código: se enseña tal cual', () => {
  const r = entradasConCodigo('nfl', { eloLocal: { etiqueta: 'Elo de Kansas City Chiefs', valor: 1 }, nueva: { etiqueta: 'algo nuevo', valor: 2 } }, ['Kansas City Chiefs', 'Buffalo Bills']);
  assert.deepEqual(r.map((x) => x.explicacion), [null, null]);
  assert.deepEqual(r.map((x) => x.etiqueta), ['Elo de Kansas City Chiefs', 'algo nuevo']);
});
