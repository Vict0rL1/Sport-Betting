// Prueba de carga (Fase 7.3): los endpoints de predicciones y el canal SSE, con percentiles y, si
// se pide, presupuestos que hacen fallar la ejecución.
//
//   node scripts/carga.mjs                         contra http://localhost:7374 (servidor en marcha)
//   node scripts/carga.mjs --url http://host:puerto
//   node scripts/carga.mjs --arrancar              arranca el servidor de e2e (base de demostración)
//   node scripts/carga.mjs --arrancar --presupuesto  y falla si un p95 pasa de config/presupuestos.json
//   node scripts/carga.mjs --json fichero.json     guarda las medidas
//
// Sin dependencias: fetch de Node y un pool de concurrencia. Mide desde fuera, por HTTP, como un
// navegador: lo que importa es lo que tarda en llegar, no lo que tarda el handler.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? d : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};
const PRESUPUESTOS = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'presupuestos.json'), 'utf8'));
const arrancar = !!opt('arrancar');
const BASE = String(opt('url', arrancar ? 'http://localhost:7390' : 'http://localhost:7374')).replace(/\/$/, '');
const N = Number(opt('n', PRESUPUESTOS.peticiones ?? 60));
const CONC = Number(opt('concurrencia', PRESUPUESTOS.concurrencia ?? 6));

function percentil(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

async function esperarServidor(url, ms = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${url}/healthz`);
      if (r.ok) return;
    } catch {
      // todavía arrancando
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`el servidor no contestó en ${ms / 1000} s`);
}

async function medir(ruta) {
  const tiempos = [];
  let errores = 0;
  let siguiente = 0;
  // Una de calentamiento: la primera paga la compilación de consultas y cachés frías.
  await fetch(`${BASE}${ruta}`).then((r) => r.arrayBuffer()).catch(() => undefined);
  const trabajador = async () => {
    while (siguiente < N) {
      siguiente++;
      const t0 = performance.now();
      try {
        const r = await fetch(`${BASE}${ruta}`);
        await r.arrayBuffer();
        if (!r.ok) errores++;
      } catch {
        errores++;
      }
      tiempos.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: CONC }, trabajador));
  return { ruta, n: tiempos.length, errores, p50: percentil(tiempos, 50), p95: percentil(tiempos, 95), max: Math.max(...tiempos) };
}

/** Abre K conexiones SSE a la vez: tiempo hasta el primer byte y si siguen abiertas al final. */
async function medirSse(ruta, k, sostener) {
  const ctl = [];
  const primeros = [];
  let abiertas = 0;
  let fallidas = 0;
  await Promise.all(
    Array.from({ length: k }, async () => {
      const ac = new AbortController();
      ctl.push(ac);
      const t0 = performance.now();
      try {
        const r = await fetch(`${BASE}${ruta}`, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
        if (!r.ok || !r.body) throw new Error(String(r.status));
        const lector = r.body.getReader();
        await lector.read();
        primeros.push(performance.now() - t0);
        abiertas++;
        // Se sigue leyendo en segundo plano hasta que se aborte.
        void (async () => {
          try {
            for (;;) if ((await lector.read()).done) break;
          } catch {
            // abortada
          }
        })();
      } catch {
        fallidas++;
      }
    }),
  );
  // Con las K abiertas, un endpoint normal tiene que seguir respondiendo igual.
  await new Promise((r) => setTimeout(r, sostener));
  const bajoCarga = await medir(PRESUPUESTOS.sse.mientras ?? '/api/meta');
  for (const c of ctl) c.abort();
  return { ruta, conexiones: k, abiertas, fallidas, primerByteP95: percentil(primeros, 95), bajoCarga };
}

let hijo = null;
if (arrancar) {
  hijo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'e2e-server.mjs')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  await esperarServidor(BASE);
}

const resultado = { url: BASE, cuando: new Date().toISOString(), peticiones: N, concurrencia: CONC, endpoints: [], sse: null, fallos: [] };
try {
  for (const e of PRESUPUESTOS.endpoints) {
    const m = await medir(e.ruta);
    resultado.endpoints.push({ ...m, presupuestoP95: e.p95Ms });
    const mal = m.errores > 0 || m.p95 > e.p95Ms;
    if (m.errores > 0) resultado.fallos.push(`${e.ruta}: ${m.errores} respuesta(s) con error`);
    if (m.p95 > e.p95Ms) resultado.fallos.push(`${e.ruta}: p95 ${m.p95.toFixed(0)} ms > ${e.p95Ms} ms`);
    console.log(`${mal ? '✗' : '✓'} ${e.ruta.padEnd(46)} p50 ${m.p50.toFixed(1).padStart(7)} ms · p95 ${m.p95.toFixed(1).padStart(7)} ms (presupuesto ${e.p95Ms}) · máx ${m.max.toFixed(0)} ms`);
  }
  const s = PRESUPUESTOS.sse;
  const sse = await medirSse(s.ruta, s.conexiones, s.sostenerMs ?? 2000);
  resultado.sse = sse;
  if (sse.fallidas > 0) resultado.fallos.push(`SSE: ${sse.fallidas} de ${sse.conexiones} conexiones no abrieron`);
  if ((sse.primerByteP95 ?? Infinity) > s.primerByteP95Ms) resultado.fallos.push(`SSE: primer byte p95 ${sse.primerByteP95?.toFixed(0)} ms > ${s.primerByteP95Ms} ms`);
  if (sse.bajoCarga.p95 > s.bajoCargaP95Ms) resultado.fallos.push(`${sse.bajoCarga.ruta} con ${s.conexiones} SSE abiertas: p95 ${sse.bajoCarga.p95.toFixed(0)} ms > ${s.bajoCargaP95Ms} ms`);
  console.log(
    `${sse.fallidas ? '✗' : '✓'} SSE ${s.ruta}: ${sse.abiertas}/${sse.conexiones} abiertas · primer byte p95 ${sse.primerByteP95?.toFixed(1)} ms (presupuesto ${s.primerByteP95Ms}) · ` +
      `${sse.bajoCarga.ruta} con ellas abiertas p95 ${sse.bajoCarga.p95.toFixed(1)} ms (presupuesto ${s.bajoCargaP95Ms})`,
  );
} finally {
  if (hijo) hijo.kill('SIGTERM');
}

const salida = opt('json');
if (salida && salida !== true) fs.writeFileSync(salida, JSON.stringify(resultado, null, 1) + '\n');
if (opt('presupuesto') && resultado.fallos.length) {
  console.error(`\n✗ Fuera de presupuesto:\n  ${resultado.fallos.join('\n  ')}`);
  process.exit(1);
}
console.log(resultado.fallos.length ? `\n${resultado.fallos.length} medida(s) por encima del presupuesto (sin --presupuesto no falla).` : '\nTodo dentro de presupuesto.');
process.exit(0);
