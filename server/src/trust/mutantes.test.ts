// Pruebas de mutación de las reglas de abstención (Fase 7.4).
//
// Un test que pasa no dice que vigile nada: dice que el código hace lo que el test mira. Para saber
// si los casos frontera de abajo VIGILAN cada regla, se rompe la regla a propósito y se comprueba
// que algún caso lo nota («mata al mutante»). Dos familias de mutantes:
//
//   · de código: en `decidir` (trust/decision.ts) se cambia cada operador de comparación de las
//     condiciones (< ↔ <=, > ↔ >=, === ↔ !==, && → ||), se niega cada `grave`, y se quita cada
//     `razones.push` y cada `recortes.push`. Cada mutante es una copia del módulo en un directorio
//     temporal, importada aparte.
//   · de umbral: cada número de la política que usa la regla (ventaja mínima, calidad mínima,
//     desaparición máxima, horas de precio viejo y los seis recortes) se desplaza un poco mediante
//     una versión nueva de la política, como lo haría alguien desde Ajustes.
//
// Un mutante vivo es una regla o un umbral que ningún caso vigila: el test lo nombra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../test/setup.ts';

const { decidir, familiaDeMotivo } = await import('./decision.ts');
const { nuevaVersion, politicaVigente } = await import('../staking/policyStore.ts');
type Contexto = Parameters<typeof decidir>[0];
type Decidir = typeof decidir;

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.dirname(AQUI);
const AHORA = new Date('2026-10-07T12:00:00Z');
const H = 3_600_000;

// La ventaja mínima pasa a 0,25 (exacta en binario) para que las fronteras sean exactas: con
// p = 0,625 y cuota 2,0 la ventaja es 0,25 justo, y con ±12,5 pp de incertidumbre el peor caso es 0.
nuevaVersion({ staking: { minEdge: 0.25 } }, 'pruebas de mutación: fronteras exactas en binario', 'cli');
const BASE = politicaVigente().config;

function contexto(over: { evento?: Partial<Contexto['evento']> } & Partial<Omit<Contexto, 'evento'>> = {}): Contexto {
  const { evento, ...resto } = over;
  return {
    evento: {
      sport: 'tennis', matchKey: 'm', eventId: 'e', commence: new Date(AHORA.getTime() + 24 * H).toISOString(),
      outcomes: ['A', 'B'], probs: [0.625, 0.375], odds: [2, 2.2], oddsAt: new Date(AHORA.getTime() - H).toISOString(),
      demo: false, ood: [], componentes: [], ...evento,
    } as Contexto['evento'],
    calidad: { puntuacion: 90, items: [] } as unknown as Contexto['calidad'],
    incertidumbre: { totalPp: 5, sesgoCalibracionPp: 0, ruidoRatingPp: 1, nTramo: 100 } as unknown as Contexto['incertidumbre'],
    estabilidad: { nivel: 'ALTA', p10: 0.6, p90: 0.65, anchoPp: 5 } as unknown as Contexto['estabilidad'],
    desacuerdo: { nivel: 'BAJO', rangoPp: 1 } as unknown as Contexto['desacuerdo'],
    mercado: { calidad: 'ALTA', dispersion: 'BAJA', casas: 10, motivos: [] } as unknown as Contexto['mercado'],
    desapareceDe: () => 0,
    now: AHORA,
    ...resto,
  } as Contexto;
}

const inc = (totalPp: number) => ({ totalPp, sesgoCalibracionPp: 0, ruidoRatingPp: 1, nTramo: 100 }) as unknown as Contexto['incertidumbre'];
const est = (nivel: string) => ({ nivel, p10: 0.5, p90: 0.7, anchoPp: 20 }) as unknown as Contexto['estabilidad'];
const des = (nivel: string) => ({ nivel, rangoPp: 9 }) as unknown as Contexto['desacuerdo'];
const mer = (calidad: string, dispersion = 'BAJA') => ({ calidad, dispersion, casas: 3, motivos: ['pocas casas'] }) as unknown as Contexto['mercado'];
const hace = (ms: number) => new Date(AHORA.getTime() - ms).toISOString();

/** Los casos frontera: [nombre, contexto, decisión, familias de motivo esperadas, factor]. */
const CASOS: [string, Contexto, string, string[], number][] = [
  ['base', contexto(), 'BET', [], 1],
  ['ventaja justo en el mínimo', contexto(), 'BET', [], 1],
  ['ventaja por debajo del mínimo', contexto({ evento: { odds: [1.99, 2.2] } }), 'NO BET', ['sin ventaja mínima'], 0],
  ['peor caso justo en cero', contexto({ incertidumbre: inc(12.5) }), 'BET', [], 1],
  ['peor caso negativo', contexto({ incertidumbre: inc(13) }), 'NO BET', ['no sobrevive a la incertidumbre'], 0],
  ['desaparece justo en el máximo', contexto({ desapareceDe: () => 0.5 }), 'BET', [], 1],
  ['desaparece por encima', contexto({ desapareceDe: () => 0.51 }), 'NO BET', ['desaparece en la sensibilidad'], 0],
  ['calidad justo en el mínimo', contexto({ calidad: { puntuacion: 60, items: [] } as never }), 'BET', [], 1],
  ['calidad por debajo', contexto({ calidad: { puntuacion: 59, items: [{ estado: 'aviso', texto: 'x' }] } as never }), 'NO BET', ['calidad de datos'], 0],
  ['OOD grave', contexto({ evento: { ood: [{ grave: true, texto: 'jugador nuevo' }] } }), 'NO BET', ['fuera de distribución'], 0],
  ['OOD leve recorta', contexto({ evento: { ood: [{ grave: false, texto: 'liga rara' }] } }), 'BET', [], 0.5],
  ['estabilidad baja', contexto({ estabilidad: est('BAJA') }), 'NO BET', ['predicción inestable'], 0],
  ['estabilidad media recorta', contexto({ estabilidad: est('MEDIA') }), 'BET', [], 0.5],
  ['desacuerdo alto con un componente en contra', contexto({ desacuerdo: des('ALTO'), evento: { componentes: [{ nombre: 'Elo', probs: [0.4, 0.6] }] } }), 'NO BET', ['componentes en contra'], 0],
  ['desacuerdo alto sin nadie en contra recorta', contexto({ desacuerdo: des('ALTO'), evento: { componentes: [{ nombre: 'Elo', probs: [0.6, 0.4] }] } }), 'BET', [], 0.5],
  ['desacuerdo medio recorta', contexto({ desacuerdo: des('MEDIO') }), 'BET', [], 0.75],
  ['mercado de calidad baja', contexto({ mercado: mer('BAJA') }), 'NO BET', ['mercado de calidad baja'], 0],
  ['casas dispersas recorta', contexto({ mercado: mer('MEDIA', 'ALTA') }), 'BET', [], 0.75],
  ['precio justo en el máximo de horas', contexto({ evento: { oddsAt: hace(6 * H) } }), 'BET', [], 1],
  ['precio viejo', contexto({ evento: { oddsAt: hace(6 * H + 60_000) } }), 'NO BET', ['precio viejo'], 0],
  ['registrada desfasada justo en la incertidumbre', contexto({ incertidumbre: inc(12.5), pRegistrada: [0.75, 0.25] }), 'BET', [], 1],
  ['registrada desfasada de más', contexto({ incertidumbre: inc(12.5), pRegistrada: [0.76, 0.24] }), 'NO BET', ['predicción desfasada'], 0],
  ['deriva recorta', contexto({ deriva: 'log loss +0,05' }), 'BET', [], 0.5],
  ['recortes se multiplican', contexto({ estabilidad: est('MEDIA'), mercado: mer('MEDIA', 'ALTA') }), 'BET', [], 0.375],
  ['partido de demostración', contexto({ evento: { demo: true } }), 'SIN MERCADO', ['sin mercado'], 0],
  ['sin cuotas', contexto({ evento: { odds: null } as never }), 'SIN MERCADO', ['sin mercado'], 0],
];

/** Lo que dice un decidir sobre un caso, en una forma comparable. */
function huella(f: Decidir, c: Contexto): string {
  try {
    const d = f(c);
    const familias = [...new Set(d.razones.filter((r) => !r.startsWith('importe ×')).map((r) => familiaDeMotivo(r).familia))].sort();
    return `${d.decision}|${familias.join(',')}|${d.factorStake.toFixed(6)}`;
  } catch (e) {
    return `lanza: ${(e as Error).message}`;
  }
}

test('los casos frontera describen la regla tal como está', () => {
  for (const [nombre, c, decision, familias, factor] of CASOS) {
    assert.equal(huella(decidir, c), `${decision}|${familias.sort().join(',')}|${factor.toFixed(6)}`, nombre);
  }
});

/** El cuerpo de `decidir` y dónde empieza, para mutar solo ahí. */
function mutantesDeCodigo(fuente: string): { descripcion: string; codigo: string }[] {
  const ini = fuente.indexOf('export function decidir(');
  const cabeza = fuente.slice(0, ini);
  const cuerpo = fuente.slice(ini);
  const lineas = cuerpo.split('\n');
  const out: { descripcion: string; codigo: string }[] = [];
  const con = (i: number, nueva: string, que: string) => {
    const ls = [...lineas];
    ls[i] = nueva;
    out.push({ descripcion: `línea ${cabeza.split('\n').length + i}: ${que} · ${lineas[i].trim().slice(0, 90)}`, codigo: cabeza + ls.join('\n') });
  };
  const OPS: [RegExp, string, string][] = [
    [/ < /g, ' <= ', '< → <='],
    [/ <= /g, ' < ', '<= → <'],
    [/ > /g, ' >= ', '> → >='],
    [/ >= /g, ' > ', '>= → >'],
    [/ === /g, ' !== ', '=== → !=='],
    [/ !== /g, ' === ', '!== → ==='],
    [/ && /g, ' || ', '&& → ||'],
  ];
  lineas.forEach((l, i) => {
    const t = l.trim();
    // Solo las condiciones de las reglas: la parte entre «if (» y el final de la condición.
    const m = /^(\s*)if \((.*)\)( \{| razones\.push| recortes\.push| for| return)/.exec(l) ?? /^(\s*)if \((.*)\)\s*$/.exec(l);
    if (m) {
      const cond = m[2];
      for (const [re, por, que] of OPS) {
        for (const x of cond.matchAll(re)) {
          const mutada = cond.slice(0, x.index) + por + cond.slice(x.index! + x[0].length);
          con(i, l.replace(cond, mutada), que);
        }
      }
    }
    if (/\.filter\(\(x\) => x\.grave\)/.test(t)) con(i, l.replace('(x) => x.grave', '(x) => !x.grave'), 'niega grave');
    if (/\.some\(\(o\) => !o\.grave\)/.test(t)) con(i, l.replace('(o) => !o.grave', '(o) => o.grave'), 'niega leve');
    if (/^(if \(.*\) )?razones\.push\(/.test(t)) con(i, l.replace(/razones\.push\(/, 'void (').replace(/^(\s*)if \(.*?\) void/, '$1void'), 'quita la regla');
    if (/recortes\.push\(/.test(t)) con(i, l.replace(/recortes\.push\(/, 'void ('), 'quita el recorte');
  });
  return out;
}

test('cada mutante de código de `decidir` cae ante algún caso frontera', async () => {
  const fuente = fs.readFileSync(path.join(AQUI, 'decision.ts'), 'utf8')
    .replace(/from '\.\.\//g, `from '${pathToFileURL(SRC).href}/`)
    .replace(/from '\.\//g, `from '${pathToFileURL(AQUI).href}/`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutantes-'));
  const mutantes = mutantesDeCodigo(fuente);
  assert.ok(mutantes.length >= 30, `${mutantes.length} mutantes: el generador dejó de encontrar las condiciones`);
  const vivos: string[] = [];
  try {
    for (const [i, m] of mutantes.entries()) {
      const f = path.join(dir, `decision.${i}.ts`);
      fs.writeFileSync(f, m.codigo);
      const mod = (await import(pathToFileURL(f).href)) as { decidir: Decidir };
      const muerto = CASOS.some(([, c]) => huella(mod.decidir, c) !== huella(decidir, c));
      if (!muerto) vivos.push(m.descripcion);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(vivos, [], `mutantes vivos (reglas que ningún caso vigila) de ${mutantes.length}`);
});

test('cada umbral de la política, desplazado un poco, cambia algún caso frontera', () => {
  const original = CASOS.map(([, c]) => huella(decidir, c));
  const mutaciones: [string, Parameters<typeof nuevaVersion>[0]][] = [
    ['staking.minEdge +0,01', { staking: { minEdge: BASE.staking.minEdge + 0.01 } }],
    ['staking.minEdge −0,01', { staking: { minEdge: BASE.staking.minEdge - 0.01 } }],
    ['abstencion.calidadDatosMin +1', { abstencion: { calidadDatosMin: BASE.abstencion.calidadDatosMin + 1 } }],
    ['abstencion.calidadDatosMin −1', { abstencion: { calidadDatosMin: BASE.abstencion.calidadDatosMin - 1 } }],
    ['abstencion.desapareceMax −0,01', { abstencion: { desapareceMax: BASE.abstencion.desapareceMax - 0.01 } }],
    ['abstencion.desapareceMax +0,02', { abstencion: { desapareceMax: BASE.abstencion.desapareceMax + 0.02 } }],
    ['abstencion.precioViejoHoras −0,1', { abstencion: { precioViejoHoras: BASE.abstencion.precioViejoHoras - 0.1 } }],
    ['abstencion.precioViejoHoras +0,1', { abstencion: { precioViejoHoras: BASE.abstencion.precioViejoHoras + 0.1 } }],
    ...(Object.keys(BASE.recortes) as (keyof typeof BASE.recortes)[]).map(
      (k) => [`recortes.${k} −0,05`, { recortes: { [k]: BASE.recortes[k] - 0.05 } }] as [string, Parameters<typeof nuevaVersion>[0]],
    ),
  ];
  const vivos: string[] = [];
  for (const [nombre, cambio] of mutaciones) {
    nuevaVersion(cambio, `mutante: ${nombre}`, 'cli');
    const ahora = CASOS.map(([, c]) => huella(decidir, c));
    if (ahora.every((x, i) => x === original[i])) vivos.push(nombre);
    // De vuelta a la base: una versión nueva (la tabla es append-only; nada se reescribe).
    nuevaVersion({ staking: { ...BASE.staking }, abstencion: { ...BASE.abstencion }, recortes: { ...BASE.recortes } }, 'vuelta a la base', 'cli');
  }
  assert.deepEqual(vivos, [], 'umbrales que ningún caso vigila');
});
