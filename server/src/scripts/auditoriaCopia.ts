// `npm run auditoria:copia -- <carpeta-de-la-copia> [--salida <carpeta>] [--raw <carpeta>] [--ahora <ISO>]`
//
// La auditoría del 17 de octubre, punto por punto, sobre una copia de carpeta de `data/` (la del
// 12 de octubre, o cualquier otra). Solo lee, y nunca la copia original:
//
//   1. Consolida la carpeta (db/consolidar.ts): huellas del original antes y después, filas que se
//      perderían restaurando solo el fichero principal, y copias autónomas comprobadas.
//   2. Abre la app sobre una COPIA de trabajo de esas copias (en --salida/app; las migraciones
//      nuevas se aplican ahí, no en la copia) y cuenta, con el código de ahora:
//        · predicciones del registro escritas en o después del inicio, y partidos empezados sin
//          final pre-partido congelada, con el porqué;
//        · predicciones y apuestas vencidas sin resultado, por competición y causa, y hasta dónde
//          llega cada fuente; la aritmética de las apuestas ya liquidadas, comprobada;
//        · partidos de tenis repetidos en la historia y, con --raw, las anomalías de los CSV;
//        · las ejecuciones de cuotas «ok» sin snapshots nuevos, hora a hora;
//        · peleas de la UFC sin id de luchador y por qué, y tablas vacías.
//   3. Escribe informe.json (todo) y resumen.md (lo que hay que leer).
//
// No sale a la red: `fetch` queda bloqueado antes de cargar nada de la app.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const desde = process.env.INIT_CWD ?? process.cwd();
const valor = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const conValor = new Set(['--salida', '--raw', '--ahora']);
const arg = args.find((a, i) => !a.startsWith('--') && !conValor.has(args[i - 1]));
if (!arg) {
  console.log('Uso: npm run auditoria:copia -- <carpeta-de-la-copia> [--salida <carpeta>] [--raw <carpeta con 2025.csv…>] [--ahora <ISO>]');
  process.exit(1);
}
const origen = path.resolve(desde, arg);
const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// Por defecto en la carpeta personal: lleva libros mayores enteros y no puede acabar en un commit.
const salida = valor('--salida') ? path.resolve(desde, valor('--salida')!) : path.join(os.homedir(), `auditoria-copia-${sello}`);
const raw = valor('--raw') ? path.resolve(desde, valor('--raw')!) : null;
if (fs.existsSync(salida) && fs.readdirSync(salida).length) {
  console.error(`${salida} ya existe y no está vacía: elige otra --salida`);
  process.exit(1);
}

globalThis.fetch = (async (u: string | URL | Request) => {
  throw new Error(`la auditoría no sale a la red (${String(u)})`);
}) as typeof fetch;

// 1. Consolidar, sin abrir la app.
const { consolidarCopia, comprobarSalidaFueraDelRepo } = await import('../db/consolidar.ts');
comprobarSalidaFueraDelRepo(salida);
if (!fs.existsSync(path.join(origen, 'ledger.db'))) {
  console.error(`En ${origen} no hay ledger.db: no hay libro mayor que auditar.`);
  process.exit(1);
}
const consolidacion = consolidarCopia(origen, path.join(salida, 'consolidada'), path.join(salida, 'trabajo'));
if (!consolidacion.origenIntacto) {
  console.error('✗ El original cambió durante la consolidación: se para aquí.');
  process.exit(1);
}

// 2. La app, sobre una copia de trabajo de las copias consolidadas.
const app = path.join(salida, 'app');
fs.mkdirSync(app, { recursive: true });
for (const b of consolidacion.bases) fs.copyFileSync(b.salida, path.join(app, b.base));
process.env.DATA_DIR = app;
process.env.BACKUP_DIR = path.join(app, 'backups');
for (const k of ['BACKUP_S3_BUCKET', 'BACKUP_S3_ACCESS_KEY', 'BACKUP_S3_SECRET_KEY', 'BACKUP_S3_ENDPOINT', 'ODDS_API_KEY', 'THE_ODDS_API_KEY']) process.env[k] = '';
process.env.AUTO_REFRESH_MINUTES = '0';

const { getDb, getMeta } = await import('../db.ts');
const { prepartidoSql } = await import('../prematch/tiempo.ts');
const { vencidas, FUENTES, olvidarArchivoAtrasado, motivoArchivoAtrasado, MIN_DIAS_PRUEBA, VENTANA_PRUEBA_DIAS } = await import('../monitoring/vencidas.ts');
const { politica, idPoliticaVigente, politicaPorDefecto } = await import('../staking/policyStore.ts');
const { horasArchivoAtrasado } = await import('../trust/decision.ts');
const { featureEncendida, conLectorDeAnulaciones, CLAVE_ANULACIONES } = await import('../features.ts');
const { liquidador } = await import('../paper/bankroll.ts');
const { leerTml } = await import('../ingest/tmlLectura.ts');
const db = getDb();
// Las anulaciones de Ajustes (`features.anulaciones`, en la copia) cuentan como en el servidor,
// que las instala al arrancar (app.ts): sin esto, la política versionada apagada desde Ajustes se
// leía como encendida (revisión data-guardian y quant del 27 de octubre).
conLectorDeAnulaciones(getMeta);
type Fila = Record<string, unknown>;
const todas = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as Fila[];
const una = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).get(...p) as Fila | undefined;

// «Ahora» es el momento de la copia: lo último que escribió la app, si no se dice otro.
const ultimoEscrito = una(
  `SELECT MAX(t) AS t FROM (
     SELECT MAX(started_at) AS t FROM ingestion_runs UNION ALL
     SELECT MAX(predicted_at) FROM nhl_prediction_log UNION ALL SELECT MAX(predicted_at) FROM fb_prediction_log UNION ALL
     SELECT MAX(predicted_at) FROM prediction_log UNION ALL SELECT MAX(placed_at) FROM paper_bets)`,
)?.t as string | null;
const ahora = new Date(valor('--ahora') ?? ultimoEscrito ?? new Date().toISOString());

// --- Punto 2: pre-partido ----------------------------------------------------------------------
const tardias: Fila[] = [];
const sinFinal: Fila[] = [];
for (const f of FUENTES) {
  const tardiasDe = todas(
    `SELECT '${f.sport}' AS sport, ${f.clave} AS match_key, commence_time, predicted_at,
            ROUND((julianday(predicted_at) - julianday(commence_time)) * 1440, 1) AS minutos_tarde,
            resolved_at IS NOT NULL AS resuelta
       FROM ${f.registro}
      WHERE NOT ${prepartidoSql()} OR julianday(predicted_at) IS NULL OR julianday(commence_time) IS NULL
      ORDER BY commence_time`,
  );
  tardias.push(...tardiasDe);
  // Empezados sin final congelada, con el porqué.
  for (const r of todas(
    `SELECT l.${f.clave} AS match_key, l.commence_time, l.predicted_at, ${prepartidoSql('l.predicted_at', 'l.commence_time')} AS prepartido,
            (SELECT COUNT(*) FROM prediction_snapshots s WHERE s.sport = ? AND s.match_key = l.${f.clave}) AS instantaneas
       FROM ${f.registro} l
       LEFT JOIN prematch_final p ON p.sport = ? AND p.match_key = l.${f.clave}
      WHERE p.match_key IS NULL AND julianday(l.commence_time) <= julianday(?)
      ORDER BY l.commence_time`,
    f.sport,
    f.sport,
    ahora.toISOString(),
  )) {
    sinFinal.push({
      sport: f.sport,
      ...r,
      porque: !r.prepartido
        ? 'la fila del registro se escribió en o después del inicio: no hubo predicción pre-partido que congelar'
        : Number(r.instantaneas) > 0
          ? 'había instantáneas y fila pre-partido: el ciclo no la congeló (¿servidor parado desde el inicio?)'
          : 'fila pre-partido sin instantánea: se congelará desde el registro en el próximo ciclo',
    });
  }
}

// --- Punto 3: vencidas, fuentes y liquidación ----------------------------------------------------
olvidarArchivoAtrasado();
// El freno por fuente atrasada con la política que de verdad se aplica (auditoría del 22 de octubre,
// hallazgo 1). Antes se listaban como frenadas, con el umbral de fábrica, todas las competiciones con
// algo vencido, aunque la política de la copia no tuviera el freno (una v1 anterior a la clave da 0
// en trust/decision.ts y assess.ts no lo calcula) y aunque no hubiera prueba (motivo null). La
// política se lee por el mismo camino que el banco, las estrategias y la confianza; si la copia no
// tiene ninguna versión, `politica()` siembra la de fábrica en la copia de trabajo, como haría la app
// al arrancar, y el informe lo dice. La copia original no se toca.
const versionesGuardadas = Number(una('SELECT COUNT(*) AS n FROM policy_versions')?.n ?? 0);
/** El valor de la anulación de Ajustes, si la hay; null si manda config/features.json. */
const interruptorAnulado = ((): boolean | null => {
  try {
    const v = (JSON.parse(getMeta(CLAVE_ANULACIONES) ?? '{}') as Record<string, unknown>)['politica.versionada'];
    return typeof v === 'boolean' ? v : null;
  } catch {
    return null;
  }
})();
const interruptorVersionada = featureEncendida('politica.versionada');
const politicaAplicada = politica();
const versionPolitica = idPoliticaVigente();
const horasFreno = horasArchivoAtrasado();
const frenoActivo = horasFreno > 0;
const claveGuardada = politicaAplicada.abstencion.archivoAtrasadoHoras ?? null;
/**
 * Con el freno apagado, el umbral de referencia de los avisos: el de fábrica. Es el que toma la
 * primera versión nueva si la vigente no tiene la clave; si la tiene a 0, encenderlo pide poner un
 * valor a mano, y el de fábrica es solo una referencia.
 */
const horasDeFabrica = politicaPorDefecto().abstencion.archivoAtrasadoHoras ?? 0;
const umbralFreno = frenoActivo ? horasFreno : horasDeFabrica;
// Las vencidas del informe, a las horas de gracia de siempre (48): el umbral del freno va aparte y
// en cada competición frenada, avisada o sin prueba (revisión quant: no mezclar las dos cuentas).
const venc = vencidas(ahora);
type CompeticionFreno = { sport: string; competicion: string; horas: number; fuenteAtrasada: number; diasConPrueba: number; ultimoResultado: string | null; motivo: string | null };
const candidatasFreno: CompeticionFreno[] =
  umbralFreno > 0
    ? vencidas(ahora, { horas: umbralFreno })
        .competiciones.filter((c) => c.fuenteAtrasada > 0)
        .map((c) => ({ sport: c.sport, competicion: c.competicion, horas: umbralFreno, fuenteAtrasada: c.fuenteAtrasada, diasConPrueba: c.diasConPrueba, ultimoResultado: c.ultimoResultado, motivo: motivoArchivoAtrasado(c.sport, `${c.competicion}|x`, ahora, umbralFreno) }))
    : [];
const conMotivo = candidatasFreno.filter((c) => c.motivo !== null);
/** Versionada y sin versión leída: la guardada no se puede leer y `politica()` cae a la de fábrica, como en el servidor. */
const politicaIlegible = interruptorVersionada && versionPolitica === null;
const frenoFuenteAtrasada = {
  politica: {
    interruptorVersionada,
    /** El valor puesto desde Ajustes (features.anulaciones), o null si manda config/features.json. */
    interruptorAnulado,
    /** null: interruptor apagado, o la versión guardada no se puede leer; en los dos casos, las constantes de fábrica. */
    version: versionPolitica,
    versionesGuardadas,
    sembradaEnLaCopiaDeTrabajo: versionesGuardadas === 0 && versionPolitica !== null,
    /** null: la versión no tiene la clave (es anterior al freno). */
    archivoAtrasadoHoras: claveGuardada,
  },
  horasEfectivas: horasFreno,
  activo: frenoActivo,
  /** Competiciones donde no se apuesta ahora: freno encendido y prueba suficiente. */
  restricciones: frenoActivo ? conMotivo : [],
  /** Con el freno apagado: dónde frenaría con `horas` (las de fábrica). */
  avisos: {
    horas: frenoActivo ? null : horasDeFabrica || null,
    nota: frenoActivo
      ? null
      : claveGuardada === null
        ? `${horasDeFabrica} h es lo que tomará la primera versión de política nueva, que añade la clave con su valor de fábrica.`
        : `La política vigente tiene la clave a 0: encender el freno pide poner un valor en una versión nueva; ${horasDeFabrica} h es solo el de fábrica.`,
    competiciones: frenoActivo ? [] : conMotivo,
  },
  /** Fuente atrasada, pero con pruebas de menos de MIN_DIAS_PRUEBA días distintos: no frena. */
  sinPruebaSuficiente: candidatasFreno.filter((c) => c.motivo === null),
  lectura: !interruptorVersionada
    ? `Política sin versionar (interruptor politica.versionada apagado${interruptorAnulado === false ? ' desde Ajustes' : ''}): se aplican las constantes de fábrica, con el freno a ${horasFreno} h.`
    : politicaIlegible
      ? `No se puede leer la política guardada: como en el servidor, se aplican las constantes de fábrica, con el freno a ${horasFreno} h.`
      : frenoActivo
        ? `Freno encendido: la política v${versionPolitica} pone abstencion.archivoAtrasadoHoras = ${horasFreno} h.`
        : claveGuardada === null
          ? `Freno apagado: la política vigente (v${versionPolitica}) es anterior a abstencion.archivoAtrasadoHoras y no la tiene, así que no frena (trust/decision.ts da 0). Empezará con la primera versión que la diga.`
          : `Freno apagado: la política vigente (v${versionPolitica}) pone abstencion.archivoAtrasadoHoras = 0.`,
};
const apuestasVencidas = todas(
  `SELECT 'papel' AS banco, id, sport, match_key, label, selection, commence_time, placed_at, stake, odds FROM paper_bets
    WHERE status = 'pending' AND julianday(commence_time) <= julianday(?) - ?
   UNION ALL
   SELECT 'estrategias', id, sport, match_key, label, selection, commence_time, placed_at, stake, odds FROM strategy_bets
    WHERE status = 'pending' AND julianday(commence_time) <= julianday(?) - ?
   ORDER BY commence_time`,
  ahora.toISOString(),
  venc.horasGracia / 24,
  ahora.toISOString(),
  venc.horasGracia / 24,
);
// La aritmética de lo ya liquidado, y que el resultado coincida con el del registro.
const resultado = liquidador();
const liquidacionMal: Fila[] = [];
for (const tabla of ['paper_bets', 'strategy_bets']) {
  for (const a of todas(`SELECT id, sport, match_key, selection, status, stake, odds, profit FROM ${tabla} WHERE status != 'pending'`)) {
    const esperado = a.status === 'won' ? Math.round(Number(a.stake) * (Number(a.odds) - 1) * 100) / 100 : a.status === 'lost' ? -Number(a.stake) : 0;
    const ahoraDiria = resultado(a as never);
    const motivos = [
      Math.abs(esperado - Number(a.profit)) > 0.005 ? `beneficio ${a.profit}, debería ser ${esperado}` : '',
      ahoraDiria && ahoraDiria.status !== a.status ? `liquidada ${a.status}; con el registro de hoy sería ${ahoraDiria.status} (${ahoraDiria.resultado})` : '',
      !ahoraDiria && a.status === 'cancelled' ? 'cancelada por tiempo (regla de 14 días, ya retirada); el registro sigue sin resultado' : '',
    ].filter(Boolean);
    if (motivos.length) liquidacionMal.push({ tabla, ...a, motivos });
  }
}

// --- Punto 4: duplicados en la historia y anomalías de los CSV -----------------------------------
const duplicadosTenis = todas(
  `SELECT tour, tourney_id, tourney_date, round, winner_id, loser_id, score, COUNT(*) AS veces,
          COUNT(DISTINCT COALESCE(w_svpt, -1) || '/' || COALESCE(l_svpt, -1)) AS estadisticas_distintas
     FROM matches GROUP BY tour, tourney_id, round, winner_id, loser_id, score HAVING COUNT(*) > 1 ORDER BY tourney_date`,
);
const anomaliasCsv: Fila[] = [];
if (raw) {
  for (const f of fs.readdirSync(raw).filter((x) => /^\d{4}\.csv$/.test(x)).sort()) {
    for (const a of leerTml(fs.readFileSync(path.join(raw, f), 'utf8'), f).anomalias) anomaliasCsv.push({ ...a });
  }
}

// --- Punto 5: cuotas «ok» sin snapshots nuevos --------------------------------------------------
const porHora = todas(
  `WITH h AS (
     SELECT strftime('%Y-%m-%dT%H', started_at) AS hora, COUNT(*) AS ejecuciones, SUM(status = 'ok') AS ok, SUM(status = 'error') AS error,
            SUM(detail = 'fixture' OR detail LIKE 'fixture:%') AS demo, SUM(detail = 'live' OR detail LIKE 'live:%') AS vivas
       FROM ingestion_runs WHERE source LIKE 'odds:%' AND source != 'odds:retention' GROUP BY 1)
   SELECT h.*,
          (SELECT COUNT(*) FROM odds_snapshots s WHERE strftime('%Y-%m-%dT%H', s.observed_at) = h.hora) AS snapshots,
          (SELECT COUNT(*) FROM odds_event_observations o WHERE strftime('%Y-%m-%dT%H', o.observed_at) = h.hora) AS observaciones
     FROM h ORDER BY h.hora`,
);
// Tramos seguidos de horas con ejecuciones ok y ningún snapshot.
const tramos: Fila[] = [];
let tramo: Fila[] = [];
const cerrar = () => {
  if (tramo.length >= 2) {
    const s = (k: string) => tramo.reduce((a, x) => a + Number(x[k] ?? 0), 0);
    const obs = s('observaciones');
    const demo = s('demo');
    const vivas = s('vivas');
    tramos.push({
      desde: tramo[0].hora,
      hasta: tramo.at(-1)!.hora,
      horas: tramo.length,
      ejecuciones_ok: s('ok'),
      demo,
      vivas,
      observaciones: obs,
      lectura:
        obs > 0
          ? 'hubo descargas reales (observaciones guardadas) y ninguna cuota cambió: el histórico guarda solo los cambios'
          : demo > 0 && vivas === 0
            ? 'ejecuciones en modo demostración: no se pidió nada a la API'
            : 'ni observaciones ni snapshots: la API devolvió listas vacías, no se llegó a pedir (presupuesto) o guardar falló; las ejecuciones de antes de este cambio no lo distinguen',
    });
  }
  tramo = [];
};
for (const h of porHora) {
  if (Number(h.ok) > 0 && Number(h.snapshots) === 0) tramo.push(h);
  else cerrar();
}
cerrar();

// --- Punto 6: UFC, NFL y tablas vacías ----------------------------------------------------------
const ufc = una(
  `SELECT COUNT(*) AS sin_id, SUM(ambigua) AS ambiguas, SUM(sin_ficha) AS sin_ficha, SUM(ambigua = 0 AND sin_ficha = 0) AS sin_motivo
     FROM ufc_fights WHERE luchador_a IS NULL OR luchador_b IS NULL`,
);
const ufcNombres = todas(
  `SELECT nombre, COUNT(*) AS peleas, MIN(fecha) AS primera, MAX(fecha) AS ultima FROM (
     SELECT nombre_a AS nombre, fecha FROM ufc_fights WHERE luchador_a IS NULL AND sin_ficha = 1
     UNION ALL SELECT nombre_b, fecha FROM ufc_fights WHERE luchador_b IS NULL AND sin_ficha = 1)
   WHERE nombre NOT IN (SELECT nombre FROM ufc_fighters) GROUP BY nombre ORDER BY peleas DESC`,
);
const fichas = todas('SELECT id, nombre FROM ufc_fighters') as { id: string; nombre: string }[];
const tokens = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);
for (const n of ufcNombres) {
  const t = tokens(String(n.nombre));
  // Candidatos PARA REVISAR, nunca aplicados: los mismos nombres en otro orden, o el mismo con un sufijo.
  n.candidatos_para_revisar = fichas
    .filter((f) => {
      const u = tokens(f.nombre);
      return (u.length === t.length && [...u].sort().join(' ') === [...t].sort().join(' ')) || f.nombre.toLowerCase().startsWith(String(n.nombre).toLowerCase() + ' ');
    })
    .map((f) => `${f.nombre} (${f.id})`);
}
const vacias: Fila[] = [];
for (const esquema of [...new Set(['main', ...(todas('PRAGMA database_list') as { name: string }[]).map((d) => d.name)])].filter((s) => s !== 'temp')) {
  for (const { name } of todas(`SELECT name FROM ${esquema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`) as { name: string }[]) {
    const n = Number(una(`SELECT COUNT(*) AS n FROM ${esquema}."${name}"`)?.n ?? 0);
    if (n === 0) vacias.push({ esquema, tabla: name });
    // La sembrada por `politica()` en la copia de trabajo no estaba en la copia.
    else if (name === 'policy_versions' && versionesGuardadas === 0) vacias.push({ esquema, tabla: name, nota: 'vacía en la copia; la auditoría sembró la de fábrica en la copia de trabajo' });
  }
}

// --- 3. Informe ---------------------------------------------------------------------------------
const informe = {
  origen,
  ahora: ahora.toISOString(),
  ahoraEs: valor('--ahora') ? 'el de --ahora' : ultimoEscrito ? 'lo último que escribió la app en la copia' : 'el reloj de esta máquina',
  consolidacion: consolidacion.bases.map((b) => ({ base: b.base, wal: b.wal, soloBaseError: b.soloBaseError, diferencias: b.diferencias, salida: b.salida, integridad: b.integridad, verificacion: b.verificacion })),
  huellasOriginal: consolidacion.huellasAntes,
  prepartido: { tardias, sinFinal },
  vencidas: venc,
  apuestasVencidas,
  frenoFuenteAtrasada,
  liquidacionMal,
  duplicadosTenis,
  anomaliasCsv,
  cuotas: { porHora, tramosSinSnapshots: tramos },
  ufc: { ...ufc, nombresSinFicha: ufcNombres },
  nfl: 'El registro de la NFL guarda la probabilidad a dos bandas a propósito: el empate anula el moneyline y la probabilidad publicada se renormaliza sin él (nfl/predict.ts). El modelo crudo sí lo tiene.',
  tablasVacias: vacias,
};
fs.writeFileSync(path.join(salida, 'informe.json'), JSON.stringify(informe, null, 1));

// Si el fichero principal solo no se deja leer, lo que se perdería es DESCONOCIDO, no 0.
const perdidas = consolidacion.bases.map((b) =>
  b.soloBaseError
    ? `${b.base}: DESCONOCIDO cuántas filas solo están en el -wal: el fichero principal solo no se deja leer (${b.soloBaseError}); restaurarlo sin su -wal no serviría`
    : `${b.base}: ${b.diferencias.reduce((a, d) => a + ((d.conWal ?? 0) - (d.soloBase ?? 0)), 0)} fila(s) solo en el -wal (${b.diferencias.map((d) => `${d.tabla} ${d.soloBase}→${d.conWal}`).join(', ') || '—'})`,
);
const md = [
  `# Auditoría de la copia ${origen}`,
  '',
  `«Ahora» = ${informe.ahora} (${informe.ahoraEs}). El original no se tocó (mismos SHA-256 antes y después).`,
  '',
  '## 1. Copia y restauración',
  ...perdidas.map((x) => `- ${x}`),
  ...consolidacion.bases.map((b) => `- ${b.base} consolidada: integrity_check ${b.integridad}; manifiesto ${b.verificacion.length ? 'DISTINTO' : 'idéntico'} al de la vista con -wal → ${b.salida}`),
  '',
  '## 2. Pre-partido',
  `- Filas del registro escritas en o después del inicio: ${tardias.length}`,
  ...tardias.slice(0, 50).map((t) => `  - ${t.sport} ${t.match_key}: inicio ${t.commence_time}, predicha ${t.predicted_at} (${t.minutos_tarde} min tarde)`),
  `- Partidos empezados sin final pre-partido congelada: ${sinFinal.length}`,
  ...sinFinal.slice(0, 50).map((s) => `  - ${s.sport} ${s.match_key} (${s.commence_time}): ${s.porque}`),
  '',
  '## 3. Vencidas y liquidación',
  `- Predicciones sin resultado más de ${venc.horasGracia} h después del inicio: ${venc.total.predicciones}; apuestas: ${venc.total.apuestas}`,
  ...venc.competiciones.map((c) => `  - ${c.sport} · ${c.competicion}: ${c.vencidas} (fuente atrasada ${c.fuenteAtrasada}, sin emparejar ${c.sinEmparejar}, sin hora ${c.sinHora}); último resultado de la fuente ${c.ultimoResultado ?? '—'}`),
  ...apuestasVencidas.map((a) => `  - apuesta ${a.banco} #${a.id} ${a.sport} ${a.match_key} «${a.selection}» (inicio ${a.commence_time}): sigue pendiente`),
  `- Freno por fuente atrasada: ${frenoFuenteAtrasada.lectura}${frenoFuenteAtrasada.politica.sembradaEnLaCopiaDeTrabajo ? ' La copia no tenía ninguna versión de política: la de fábrica se sembró en la copia de trabajo, como haría la app al arrancar.' : ''}`,
  frenoActivo
    ? `- Restricciones activas (${horasFreno} h): ${frenoFuenteAtrasada.restricciones.map((c) => `${c.sport}·${c.competicion}`).join(', ') || 'ninguna'}`
    : '- Restricciones activas: ninguna (el freno está apagado)',
  ...frenoFuenteAtrasada.restricciones.map((c) => `  - ${c.sport}·${c.competicion}: ${c.motivo}`),
  ...(frenoActivo ? [] : [`- Avisos, no restricciones (frenarían con ${horasDeFabrica} h): ${conMotivo.map((c) => `${c.sport}·${c.competicion}`).join(', ') || 'ninguno'}. ${frenoFuenteAtrasada.avisos.nota}`]),
  ...frenoFuenteAtrasada.avisos.competiciones.map((c) => `  - ${c.sport}·${c.competicion}: ${c.motivo}`),
  `- Fuente atrasada a más de ${umbralFreno} h sin prueba suficiente (menos de ${MIN_DIAS_PRUEBA} días distintos en ${VENTANA_PRUEBA_DIAS}; no frena): ${frenoFuenteAtrasada.sinPruebaSuficiente.map((c) => `${c.sport}·${c.competicion} (${c.diasConPrueba} día${c.diasConPrueba === 1 ? '' : 's'})`).join(', ') || 'ninguna'}`,
  `- Apuestas liquidadas con aritmética o resultado que no cuadra: ${liquidacionMal.length}`,
  ...liquidacionMal.slice(0, 50).map((l) => `  - ${l.tabla} #${l.id} ${l.sport} ${l.match_key}: ${(l.motivos as string[]).join('; ')}`),
  '',
  '## 4. Duplicados y CSV',
  `- Partidos de tenis repetidos en la historia (torneo, ronda, los dos y el marcador): ${duplicadosTenis.length} grupo(s)`,
  ...duplicadosTenis.slice(0, 30).map((d) => `  - ${d.tourney_id} ${d.round} ${d.winner_id}–${d.loser_id} ${d.score}: ×${d.veces}${Number(d.estadisticas_distintas) > 1 ? ', con estadísticas distintas' : ''}`),
  raw ? `- Anomalías en los CSV de ${raw}: ${anomaliasCsv.length}` : '- CSV: no se pasó --raw',
  ...anomaliasCsv.map((a) => `  - ${a.fichero}:${a.linea} ${a.tipo} → ${a.accion} (partido ${a.idFuente ?? '—'}): ${a.detalle}`),
  '',
  '## 5. Cuotas',
  `- Tramos de 2 h o más con ejecuciones ok y ningún snapshot: ${tramos.length}`,
  ...tramos.map((t) => `  - ${t.desde} → ${t.hasta} (${t.horas} h, ${t.ejecuciones_ok} ok, ${t.observaciones} observaciones, demo ${t.demo}, vivas ${t.vivas}): ${t.lectura}`),
  '',
  '## 6. Cobertura',
  `- UFC: ${ufc?.sin_id ?? 0} peleas sin id de luchador: ${ufc?.ambiguas ?? 0} por nombre ambiguo, ${ufc?.sin_ficha ?? 0} por nombre que no está en la lista de luchadores, ${ufc?.sin_motivo ?? 0} sin motivo`,
  ...ufcNombres.map((n) => `  - «${n.nombre}»: ${n.peleas} pelea(s) ${n.primera}–${n.ultima}; candidatos para revisar (no aplicados): ${(n.candidatos_para_revisar as string[]).join(', ') || 'ninguno'}`),
  `- NFL: ${informe.nfl}`,
  `- Tablas vacías: ${vacias.map((v) => `${v.esquema}.${v.tabla}`).join(', ') || 'ninguna'}`,
  '',
].join('\n');
fs.writeFileSync(path.join(salida, 'resumen.md'), md);
console.log(md);
console.log(`\nInforme completo: ${path.join(salida, 'informe.json')}`);
