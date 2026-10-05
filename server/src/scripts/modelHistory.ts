// npm run model:history — cuándo y por qué cambió cada modelo.
//
// Se reconstruye de git, que es el registro que no se puede editar sin que se note: para
// cada commit que toca los ficheros que DEFINEN un modelo (versions.ts → MODEL_FILES), se
// calcula la huella con el contenido de ese commit, exactamente como la calcula la app.
// Cada huella nueva es una versión: se activa con ese commit y se desactiva con el
// siguiente que la cambia. El motivo es el mensaje del commit. Si el registro de
// experimentos tiene una entrada de ese deporte esos días, se enlaza con sus cifras; si no,
// se dice que no hay métricas registradas en vez de inventarlas.
//
// Escribe experiments/model_history.json.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import { MODEL_FILES, fingerprintDe, versionsFor } from '../versions.ts';
import { readRegistry } from '../experiments/registry.ts';
import { SPORT_IDS, type SportId } from '../sports.ts';

const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

export interface VersionModelo {
  version: string;
  activada: string;
  desactivada: string | null;
  motivo: string;
  git_commit: string;
  experimentos: { id: string; veredicto: string; metrica: string; delta: number; ic: [number, number] }[];
  metricas: string;
}

export function historial(sport: SportId): VersionModelo[] {
  const rutas = MODEL_FILES[sport].map((f) => `server/src/${f}`);
  let log = '';
  try {
    log = git(['log', '--reverse', '--format=%H|%cI|%s', '--', ...rutas]);
  } catch {
    return [];
  }
  const { experiments } = readRegistry();
  const out: VersionModelo[] = [];
  for (const linea of log.trim().split('\n').filter(Boolean)) {
    const [hash, fecha, ...asunto] = linea.split('|');
    const entradas = rutas.map((r) => {
      let contenido: string | null = null;
      try {
        contenido = git(['show', `${hash}:${r}`]);
      } catch {
        contenido = null;
      }
      return { nombre: r, contenido };
    });
    const version = `${sport}-${fingerprintDe(entradas)}`;
    if (out.length && out[out.length - 1].version === version) continue;
    if (out.length) out[out.length - 1].desactivada = fecha;
    const dia = Date.parse(fecha);
    const exps = experiments.filter((e) => e.dataset.sport === sport && Math.abs(Date.parse(e.date) - dia) <= 3 * 86_400_000);
    out.push({
      version,
      activada: fecha,
      desactivada: null,
      motivo: asunto.join('|'),
      git_commit: hash.slice(0, 12),
      experimentos: exps.map((e) => ({ id: e.id, veredicto: e.verdict, metrica: e.metric, delta: e.result.delta, ic: [e.result.ciLo, e.result.ciHi] })),
      metricas: exps.length ? `${exps.length} experimento(s) registrados en esos días` : 'sin métricas registradas para este cambio',
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const todo: Record<string, VersionModelo[]> = {};
  for (const sport of SPORT_IDS) {
    const h = historial(sport);
    todo[sport] = h;
    const actual = versionsFor(sport).model_version;
    console.log(`\n${sport.toUpperCase()} — ${h.length} versiones`);
    h.forEach((v, i) => {
      console.log(`  v${i + 1} ${v.version}  ${v.activada.slice(0, 10)} → ${v.desactivada ? v.desactivada.slice(0, 10) : 'activa'}  ${v.git_commit}`);
      console.log(`     ${v.motivo.slice(0, 110)}`);
      if (v.experimentos.length) console.log(`     ${v.metricas}: ${v.experimentos.slice(0, 3).map((e) => `${e.id} (${e.veredicto}, Δ ${e.metrica} ${e.delta.toFixed(4)})`).join('; ')}`);
    });
    const ultima = h[h.length - 1]?.version;
    console.log(ultima === actual ? `  ✓ la versión activa coincide con la del código (${actual})` : `  ⚠ el código tiene cambios sin commit: versión actual ${actual}`);
  }
  const f = path.join(ROOT, 'experiments', 'model_history.json');
  fs.writeFileSync(f, JSON.stringify(todo, null, 1) + '\n');
  console.log(`\nGuardado en ${f}`);
}
