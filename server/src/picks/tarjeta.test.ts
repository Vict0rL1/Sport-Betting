// La tarjeta SVG de «Mi selección»: SVG válido, sin inyección y con las cifras de la combinada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../test/setup.ts';

const { tarjetaSvg } = await import('./tarjeta.ts');
const { combinada } = await import('./parlay.ts');

test('tarjetaSvg: escapa el texto, enseña la conjunta y la cuota, y declara su título', () => {
  const patas = [
    { sport: 'football' as const, matchKey: 'a', liga: 'epl', cuando: '2026-10-10T15:00:00Z', seleccion: 'Arsenal <script>', indice: 0, resultados: 3, p: 0.5, cuota: 2.1 },
    { sport: 'nfl' as const, matchKey: 'b', liga: null, cuando: '2026-10-11T17:00:00Z', seleccion: 'Bills & co', indice: 0, resultados: 2, p: 0.6, cuota: 1.8 },
  ];
  const svg = tarjetaSvg(patas, combinada(patas), new Date('2026-10-07T10:00:00Z'));
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!svg.includes('<script>'), 'el texto se escapa');
  assert.match(svg, /Arsenal &lt;script&gt;/);
  assert.match(svg, /Bills &amp; co/);
  assert.match(svg, /<title>Mi selección: 2 partidos, probabilidad conjunta 30,0 %<\/title>/);
  assert.match(svg, /3,78/, 'cuota combinada 2,1 × 1,8');
});
