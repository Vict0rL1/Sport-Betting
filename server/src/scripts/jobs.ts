// `npm run jobs` — el registro de trabajos programados tal como lo ve el servidor en marcha
// (GET /api/scheduler), leído de la base: cadencia, última ejecución, estado y si está encendido.
import { getDb } from '../db.ts';
import { cicloMonitorizacion } from '../monitoring/series.ts';
import { cicloSimulacion } from '../simulation/season.ts';
import { generarDiario, generarSemanal } from '../informes/index.ts';

// `npm run jobs -- ejecutar <nombre>`: los trabajos que no necesitan el servidor en marcha se
// pueden correr a mano (Fases 4–5). El resto, con el servidor: POST /api/scheduler/<nombre>/ejecutar.
const A_MANO: Record<string, (log: (m: string) => void) => Promise<unknown> | unknown> = {
  monitorizacion: (log) => cicloMonitorizacion(log),
  'simulacion-temporada': (log) => cicloSimulacion(log),
  // A mano no se espera a las 7:00: se genera el del periodo actual si falta (Fase 6).
  'resumen-diario': (log) => {
    const r = generarDiario();
    log(r.nuevo ? `Resumen diario ${r.informe.periodo} archivado (#${r.informe.id}).` : `El resumen de ${r.informe.periodo} ya existía (#${r.informe.id}): un informe archivado no se rehace.`);
  },
  'informe-semanal': (log) => {
    const r = generarSemanal();
    log(r.nuevo ? `Informe semanal ${r.informe.periodo} archivado (#${r.informe.id}).` : `El informe de ${r.informe.periodo} ya existía (#${r.informe.id}): un informe archivado no se rehace.`);
  },
};
const args = process.argv.slice(2);
if (args[0] === 'ejecutar') {
  const fn = A_MANO[args[1] ?? ''];
  if (!fn) {
    console.log(`Sin servidor se pueden ejecutar: ${Object.keys(A_MANO).join(', ')}. El resto: POST /api/scheduler/<nombre>/ejecutar con el servidor en marcha.`);
    process.exit(1);
  }
  await fn((m) => console.log(m));
  process.exit(0);
}

const C = { bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', off: '\x1b[0m' };
const filas = getDb().prepare('SELECT * FROM scheduler_jobs ORDER BY name').all() as { name: string; cadence_minutes: number; enabled: number; last_run_at: string | null; last_duration_ms: number | null; last_status: string | null; last_error: string | null; next_run_at: string | null; runs_ok: number; runs_error: number }[];
if (filas.length === 0) {
  console.log(`${C.dim}Todavía no hay trabajos registrados: se registran al arrancar el servidor (npm run dev).${C.off}`);
  process.exit(0);
}
console.log(`${C.bold}Trabajos programados${C.off}`);
for (const f of filas) {
  const marca = f.enabled ? (f.last_status === 'error' ? `${C.amber}⚠${C.off}` : `${C.green}✓${C.off}`) : `${C.dim}·${C.off}`;
  console.log(`${marca} ${f.name.padEnd(20)} cada ${String(f.cadence_minutes).padStart(5)} min  ${f.enabled ? 'encendido ' : 'APAGADO   '} última ${f.last_run_at?.slice(0, 16).replace('T', ' ') ?? '—'} ${f.last_status ?? ''} ${f.last_duration_ms != null ? `${(f.last_duration_ms / 1000).toFixed(1)} s` : ''} ok ${f.runs_ok} / error ${f.runs_error}${f.last_error ? `\n    ${C.red}${f.last_error}${C.off}` : ''}`);
}
console.log(`\n${C.dim}Encender/apagar: PATCH /api/scheduler/<nombre> {"enabled": false} o desde Ajustes › Trabajos programados. Ejecutar sin servidor: npm run jobs -- ejecutar monitorizacion | simulacion-temporada | resumen-diario | informe-semanal.${C.off}`);
