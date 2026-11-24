// Que una predicción diga lo mismo en sus frases y en sus códigos (fase C): cada `explicaciones` de la
// respuesta tiene un código del catálogo y, escrito en español, da EXACTAMENTE la frase de al lado. Lo
// usan los tests de cada deporte; devuelve los fallos (vacío si todo casa).

import { EXPLICACIONES } from './catalogo.ts';
import { rellenar, type Explicacion } from './index.ts';

const conocido = (e: Explicacion) => Object.prototype.hasOwnProperty.call(EXPLICACIONES, e.codigo);
const escrita = (e: Explicacion) => rellenar(EXPLICACIONES[e.codigo], e.params);

export function incoherencias(pred: unknown): string[] {
  const out: string[] = [];
  const pareja = (ruta: string, frases: unknown, codigos: unknown) => {
    if (!Array.isArray(frases) || !Array.isArray(codigos)) return out.push(`${ruta}: sin códigos`);
    if (frases.length !== codigos.length) return out.push(`${ruta}: ${frases.length} frases y ${codigos.length} códigos`);
    codigos.forEach((e: Explicacion, i) => {
      if (!conocido(e)) out.push(`${ruta}[${i}]: código desconocido ${e.codigo}`);
      else if (escrita(e) !== frases[i]) out.push(`${ruta}[${i}]: «${escrita(e)}» ≠ «${frases[i]}»`);
    });
  };
  const p = pred as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (p.summary) {
    pareja('summary.bullets', p.summary.bullets, p.summary.explicaciones?.bullets);
    pareja('summary.headline', [p.summary.headline], p.summary.explicaciones ? [p.summary.explicaciones.headline] : null);
  }
  if (p.reliability) pareja('reliability.reasons', p.reliability.reasons, p.reliability.explicaciones);
  if (p.reasoning?.explicaciones) {
    const junto = (p.reasoning.explicaciones as Explicacion[]).map(escrita).join(' ');
    if (junto !== p.reasoning.text) out.push(`reasoning.text: «${junto}» ≠ «${p.reasoning.text}»`);
  }
  if (p.verdict?.explicacion && escrita(p.verdict.explicacion) !== p.verdict.label) out.push(`verdict: «${escrita(p.verdict.explicacion)}» ≠ «${p.verdict.label}»`);
  for (const f of p.reasoning?.factors ?? []) if (f.explicacion && escrita(f.explicacion) !== f.label) out.push(`factor ${f.key}: «${escrita(f.explicacion)}» ≠ «${f.label}»`);
  return out;
}
