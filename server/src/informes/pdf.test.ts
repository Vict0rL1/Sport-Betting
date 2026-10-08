// El PDF a mano: estructura válida (xref con desplazamientos exactos), texto en WinAnsi y páginas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfDeMarkdown, winAnsi, enLinea } from './pdf.ts';

test('winAnsi: tildes, ñ, comillas latinas y raya caben; lo demás se sustituye; se escapan paréntesis', () => {
  assert.equal(winAnsi('Año «sí» — 1€'), 'A\xf1o \xabs\xed\xbb \x97 1\x80');
  assert.equal(winAnsi('≥ 2 − 1'), '>= 2 - 1');
  assert.equal(winAnsi('(a\\b)'), '\\(a\\\\b\\)');
  assert.equal(winAnsi('漢'), '?');
});

test('enLinea quita negrita, cursiva, código y enlaces', () => {
  assert.equal(enLinea('**Hola** [Bills](/partido/x) `c` _nota_.'), 'Hola Bills c nota.');
});

test('el PDF es válido: cabecera, objetos donde dice la tabla xref, final y una página por cada ~50 líneas', () => {
  const md = ['# Informe semanal · 2026-W40', '', '## Salud', '', '| A | B |', '|---|---|', '| 1 | 2 |', '', ...Array.from({ length: 140 }, (_, i) => `- Línea ${i} con tildes: áéíóú ñ «»`)].join('\n');
  const b = pdfDeMarkdown('Informe semanal · 2026-W40', md);
  const s = b.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const tabla = s.slice(xref).split('\n');
  const n = Number(tabla[1].split(' ')[1]);
  for (let i = 1; i < n; i++) {
    const off = Number(tabla[2 + i].slice(0, 10));
    assert.equal(s.slice(off, off + `${i} 0 obj`.length), `${i} 0 obj`, `objeto ${i}`);
  }
  const paginas = Number(/\/Count (\d+)/.exec(s)![1]);
  assert.ok(paginas >= 2, `${paginas} páginas`);
  assert.match(s, /\(Informe semanal \x95?/);
  assert.match(s, /p\xe1gina 1 de \d/);
  assert.match(s, /Helvetica-Bold/);
});
