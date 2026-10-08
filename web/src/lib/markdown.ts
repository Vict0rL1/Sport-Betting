// Un lector de Markdown pequeño para los informes (Fase 6.9): solo lo que escriben
// server/src/informes (títulos, párrafos, viñetas, tablas, notas en cursiva, negrita y enlaces
// internos). Devuelve bloques; los pinta React, sin innerHTML.

export type Trozo = { t: 'texto'; v: string } | { t: 'negrita'; v: string } | { t: 'enlace'; v: string; href: string };
export type Bloque =
  | { tipo: 'h1' | 'h2' | 'h3' | 'p' | 'nota'; trozos: Trozo[] }
  | { tipo: 'ul'; items: Trozo[][] }
  | { tipo: 'tabla'; cabecera: Trozo[][]; filas: Trozo[][][] };

/** Negrita y enlaces. Un enlace que no empieza por «/» se queda en texto: los informes solo enlazan dentro de la app. */
export function enLinea(s: string): Trozo[] {
  const out: Trozo[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let i = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > i) out.push({ t: 'texto', v: s.slice(i, m.index) });
    if (m[1] != null) out.push({ t: 'negrita', v: m[1] });
    else if (m[3].startsWith('/') && !m[3].startsWith('//')) out.push({ t: 'enlace', v: m[2], href: m[3] });
    else out.push({ t: 'texto', v: m[2] });
    i = m.index! + m[0].length;
  }
  if (i < s.length) out.push({ t: 'texto', v: s.slice(i) });
  return out;
}

const celdas = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => enLinea(c.trim()));

export function leerMarkdown(md: string): Bloque[] {
  const out: Bloque[] = [];
  const lineas = md.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trimEnd();
    if (!l.trim()) continue;
    const h = /^(#{1,3}) (.*)$/.exec(l);
    if (h) {
      out.push({ tipo: (['h1', 'h2', 'h3'] as const)[h[1].length - 1], trozos: enLinea(h[2]) });
    } else if (/^[-*] /.test(l)) {
      const items: Trozo[][] = [];
      for (; i < lineas.length && /^[-*] /.test(lineas[i]); i++) items.push(enLinea(lineas[i].slice(2).trimEnd()));
      i--;
      out.push({ tipo: 'ul', items });
    } else if (l.startsWith('|')) {
      const cabecera = celdas(l);
      const filas: Trozo[][][] = [];
      for (i++; i < lineas.length && lineas[i].startsWith('|'); i++) if (!/^\|(\s*-{3,}\s*\|)+\s*$/.test(lineas[i])) filas.push(celdas(lineas[i]));
      i--;
      out.push({ tipo: 'tabla', cabecera, filas });
    } else if (/^_.*_$/.test(l)) {
      out.push({ tipo: 'nota', trozos: enLinea(l.slice(1, -1)) });
    } else {
      out.push({ tipo: 'p', trozos: enLinea(l) });
    }
  }
  return out;
}
