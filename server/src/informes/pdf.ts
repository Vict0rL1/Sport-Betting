// El PDF de un informe (Fase 6.8), escrito a mano: sin dependencias ni servicios externos.
//
// Es un PDF 1.4 de texto: A4, Helvetica (las tres variantes que todo lector trae, así que no hay
// que incrustar fuentes) con WinAnsiEncoding, que cubre las tildes, la ñ, «», —, … y €. Lo que
// esa codificación no tiene se sustituye por su equivalente (≥ → >=, − → -) o por «?»; nunca se
// rompe el fichero. Interpreta el Markdown de los informes: títulos, viñetas, tablas, cursiva y
// negrita (sin marcas), y enlaces (se queda el texto).

const ANCHO = 595;
const ALTO = 842;
const MARGEN = 50;
const UTIL = ANCHO - 2 * MARGEN;

const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const SUSTITUTOS: Record<string, string> = { '−': '-', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '☆': '*', '★': '*', '⚠': '(!)', ' ': ' ', ' ': ' ', '✓': 'v', '✗': 'x' };

/** Texto → cadena de bytes WinAnsi (un carácter por byte), escapada para un literal de PDF. */
export function winAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const sust = SUSTITUTOS[ch];
    if (sust !== undefined) {
      out += sust;
      continue;
    }
    const c = ch.codePointAt(0) as number;
    if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c >= 0xa0 && c <= 0xff) out += String.fromCharCode(c);
    else if (CP1252[c] !== undefined) out += String.fromCharCode(CP1252[c]);
    else out += '?';
  }
  return out.replace(/[\\()]/g, (m) => `\\${m}`);
}

/** Quita las marcas en línea del Markdown: **negrita**, _cursiva_, [texto](url), `código`. */
export function enLinea(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:])/g, '$1$2');
}

type Fuente = 'F1' | 'F2' | 'F3';
interface Linea {
  texto: string;
  fuente: Fuente;
  tam: number;
  x: number;
  antes: number;
}

/** Corte por palabras con un ancho medio de carácter de 0,5 em (Helvetica). */
function partir(texto: string, tam: number, ancho: number): string[] {
  const max = Math.max(10, Math.floor(ancho / (tam * 0.5)));
  const out: string[] = [];
  let actual = '';
  for (const palabra of texto.split(/\s+/)) {
    if (!palabra) continue;
    if ((actual ? actual.length + 1 : 0) + palabra.length > max && actual) {
      out.push(actual);
      actual = palabra;
    } else actual = actual ? `${actual} ${palabra}` : palabra;
    while (actual.length > max) {
      out.push(actual.slice(0, max));
      actual = actual.slice(max);
    }
  }
  if (actual) out.push(actual);
  return out.length ? out : [''];
}

function lineasDe(markdown: string): Linea[] {
  const out: Linea[] = [];
  const add = (texto: string, fuente: Fuente, tam: number, x = MARGEN, antes = 0) => {
    partir(texto, tam, UTIL - (x - MARGEN)).forEach((t, i) => out.push({ texto: t, fuente, tam, x, antes: i === 0 ? antes : 0 }));
  };
  let filaTabla = 0;
  for (const cruda of markdown.split('\n')) {
    const l = cruda.trimEnd();
    if (!l.startsWith('|')) filaTabla = 0;
    if (!l.trim()) {
      out.push({ texto: '', fuente: 'F1', tam: 5, x: MARGEN, antes: 0 });
      continue;
    }
    if (l.startsWith('# ')) add(enLinea(l.slice(2)), 'F2', 16, MARGEN, 4);
    else if (l.startsWith('## ')) add(enLinea(l.slice(3)), 'F2', 13, MARGEN, 8);
    else if (l.startsWith('### ')) add(enLinea(l.slice(4)), 'F2', 11, MARGEN, 4);
    else if (/^\|(-{3,}\|)+$/.test(l.replace(/\s/g, ''))) continue;
    else if (l.startsWith('|')) {
      const celdas = l.split('|').slice(1, -1).map((c) => enLinea(c.trim()));
      add(celdas.join('  ·  '), filaTabla === 0 ? 'F2' : 'F1', 9, MARGEN + 6);
      filaTabla++;
    } else if (/^[-*] /.test(l)) add(`• ${enLinea(l.slice(2))}`, 'F1', 10, MARGEN + 8);
    else if (/^_.*_$/.test(l)) add(enLinea(l.slice(1, -1)), 'F3', 9);
    else add(enLinea(l), 'F1', 10);
  }
  return out;
}

/** El PDF entero, como Buffer. */
export function pdfDeMarkdown(titulo: string, markdown: string, pie = 'Sports Predictor'): Buffer {
  const lineas = lineasDe(markdown);
  const paginas: string[][] = [];
  let pagina: string[] = [];
  let y = ALTO - MARGEN;
  for (const l of lineas) {
    const alto = l.tam * 1.35 + l.antes;
    if (y - alto < MARGEN + 20) {
      paginas.push(pagina);
      pagina = [];
      y = ALTO - MARGEN;
    }
    y -= alto;
    if (l.texto) pagina.push(`BT /${l.fuente} ${l.tam} Tf ${l.x} ${y.toFixed(1)} Td (${winAnsi(l.texto)}) Tj ET`);
  }
  paginas.push(pagina);

  const objetos: string[] = [];
  const n = paginas.length;
  // 1 catálogo, 2 páginas, 3–5 fuentes, 6 info; después, por página: la página y su contenido.
  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objetos[2] = `<< /Type /Pages /Kids [${paginas.map((_, i) => `${7 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`;
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objetos[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objetos[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';
  objetos[6] = `<< /Title (${winAnsi(titulo)}) /Producer (${winAnsi(pie)}) >>`;
  paginas.forEach((cuerpo, i) => {
    const pieTxt = `BT /F3 8 Tf ${MARGEN} 30 Td (${winAnsi(`${pie} · ${titulo} · página ${i + 1} de ${n}`)}) Tj ET`;
    const flujo = [...cuerpo, pieTxt].join('\n');
    objetos[7 + 2 * i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${8 + 2 * i} 0 R >>`;
    objetos[8 + 2 * i] = `<< /Length ${Buffer.byteLength(flujo, 'latin1')} >>\nstream\n${flujo}\nendstream`;
  });

  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let i = 1; i < objetos.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objetos[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objetos.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
