// Piezas de Markdown para los informes: tablas, porcentajes y dinero en español, y el texto de
// los avisos de muestra. Sin HTML: la página lo pinta con su propio lector y el PDF lo escribe
// como texto.

/**
 * x en %, con `d` decimales y el signo menos (U+2212), como `pp()` y `dinero()`; lo que redondea a 0
 * no lleva signo. Con coma o, para los textos que ya escriben las cuotas con punto, con punto
 * (revisión ui-tester del 31 de octubre: «CLV -1,25 %» junto a «−151,25»).
 */
export function porcentaje(x: number, d = 1, coma = true): string {
  const r = (x * 100).toFixed(d);
  const abs = r.replace('-', '');
  return `${r.startsWith('-') && Number(r) !== 0 ? '−' : ''}${coma ? abs.replace('.', ',') : abs}`;
}

export const pct = (x: number | null | undefined, d = 1): string => (x == null || !Number.isFinite(x) ? '—' : `${porcentaje(x, d)} %`);

export const pp = (x: number | null | undefined, d = 1): string =>
  x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d).replace('.', ',')} pp`;

export const dinero = (x: number): string => {
  const s = Math.abs(x).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${x < 0 ? '−' : ''}${s}`;
};

export const conSigno = (x: number): string => `${x > 0 ? '+' : ''}${dinero(x)}`;

/** Una celda no puede romper la tabla: sin barras ni saltos de línea. */
const celda = (s: string | number | null | undefined): string => String(s ?? '—').replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');

export function tabla(cabecera: string[], filas: (string | number | null | undefined)[][]): string {
  if (filas.length === 0) return '';
  return [
    `| ${cabecera.map(celda).join(' | ')} |`,
    `|${cabecera.map(() => '---').join('|')}|`,
    ...filas.map((f) => `| ${f.map(celda).join(' | ')} |`),
  ].join('\n');
}
