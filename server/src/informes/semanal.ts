// El informe semanal (Fase 6.8): la semana que acaba de terminar (lunes a domingo, hora local).
// Salud del modelo, CLV, banco, deriva, frescura de datos y experimentos. Como el diario, cada
// cifra sale de algo guardado y las que no permiten concluir llevan su aviso de muestra.

import { getDb } from '../db.ts';
import { monitorizacion } from '../monitoring/series.ts';
import { resumen } from '../paper/bankroll.ts';
import { alertas } from '../alerts/engine.ts';
import { avisoMuestra } from '../evaluation/sample.ts';
import { readRegistry, interpretarExperimento } from '../experiments/registry.ts';
import { estadoGlobal } from '../routes/ajustes.ts';
import { SPORT_IDS, type SportId } from '../sports.ts';
import { NOMBRE_DEPORTE } from './diario.ts';
import { fechaLarga, horaCorta, inicioDelDia, local, lunesDe, semanaIso, sumarDias, zonaApp } from './tiempo.ts';
import { conSigno, dinero, pct, tabla } from './formato.ts';

export interface DatosSemanal {
  semana: string;
  desde: string;
  hasta: string;
  zona: string;
  generado: string;
  salud: { sport: string; n: number; logLoss: number | null; brier: number | null; refLogLoss: number | null; refBrier: number | null; psi: number | null; deriva: boolean; motivos: string[]; aviso: string | null }[];
  clv: { n: number; medio: number | null; positivos: number; aviso: string | null };
  banco: { banco: number; beneficioSemana: number; liquidadasSemana: number; pendientes: number };
  estrategias: { nombre: string; beneficio: number; liquidadas: number; clvMedio: number | null }[];
  deriva: { titulo: string; cuerpo: string; cuando: string }[];
  frescura: { cuotas: string; deportes: { sport: string; datosHasta: string | null; ultimaCuota: string | null }[]; resultados: string | null };
  experimentos: { fecha: string; hipotesis: string; veredicto: string; motivo: string; aceptado: boolean }[];
}

/** La semana anterior a la de `ahora`: la última completa. */
export function semanaAnterior(ahora = new Date(), zona = zonaApp()): { semana: string; lunes: string; lunesSiguiente: string } {
  const lunesActual = lunesDe(local(ahora, zona).fecha);
  const lunes = sumarDias(lunesActual, -7);
  return { semana: semanaIso(lunes), lunes, lunesSiguiente: lunesActual };
}

export function datosSemanal(ahora = new Date(), zona = zonaApp()): DatosSemanal {
  const { semana, lunes, lunesSiguiente } = semanaAnterior(ahora, zona);
  const desde = inicioDelDia(lunes, zona);
  const hasta = inicioDelDia(lunesSiguiente, zona);
  const db = getDb();

  const salud = SPORT_IDS.map((sport) => {
    try {
      const m = monitorizacion(sport, ahora);
      return {
        sport,
        n: m.deriva.n,
        logLoss: m.actual?.logLoss ?? null,
        brier: m.actual?.brier ?? null,
        refLogLoss: m.referencia?.logLoss ?? null,
        refBrier: m.referencia?.brier ?? null,
        psi: m.actual?.psi ?? null,
        deriva: m.deriva.hay,
        motivos: m.deriva.motivos,
        aviso: m.deriva.aviso.texto,
      };
    } catch {
      return { sport, n: 0, logLoss: null, brier: null, refLogLoss: null, refBrier: null, psi: null, deriva: false, motivos: [], aviso: null };
    }
  });

  const cierres = db.prepare('SELECT clv FROM paper_bets WHERE clv IS NOT NULL AND closing_observed_at >= ? AND closing_observed_at < ?').all(desde, hasta) as { clv: number }[];
  const clv = {
    n: cierres.length,
    medio: cierres.length ? cierres.reduce((a, x) => a + x.clv, 0) / cierres.length : null,
    positivos: cierres.filter((x) => x.clv > 0).length,
    aviso: avisoMuestra(cierres.length, 'apuestas').texto,
  };

  const r = resumen();
  const sem = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(profit), 0) AS p FROM paper_bets WHERE status <> 'pending' AND settled_at >= ? AND settled_at < ?").get(desde, hasta) as { n: number; p: number };
  const banco = { banco: r.banco, beneficioSemana: sem.p, liquidadasSemana: sem.n, pendientes: r.pendientes };

  let estrategias: DatosSemanal['estrategias'] = [];
  try {
    estrategias = (
      db
        .prepare(
          `SELECT s.nombre, COALESCE(SUM(CASE WHEN b.status <> 'pending' AND b.settled_at >= ? AND b.settled_at < ? THEN b.profit END), 0) AS beneficio,
                  SUM(CASE WHEN b.status <> 'pending' AND b.settled_at >= ? AND b.settled_at < ? THEN 1 ELSE 0 END) AS liquidadas,
                  AVG(CASE WHEN b.closing_observed_at >= ? AND b.closing_observed_at < ? THEN b.clv END) AS clv
             FROM strategies s LEFT JOIN strategy_bets b ON b.strategy_id = s.id
            WHERE s.archived_at IS NULL OR s.archived_at >= ?
            GROUP BY s.id ORDER BY s.id`,
        )
        .all(desde, hasta, desde, hasta, desde, hasta, desde) as { nombre: string; beneficio: number; liquidadas: number | null; clv: number | null }[]
    ).map((x) => ({ nombre: x.nombre, beneficio: x.beneficio, liquidadas: x.liquidadas ?? 0, clvMedio: x.clv }));
  } catch {
    estrategias = [];
  }

  const deriva = alertas({ limit: 1000 })
    .filter((a) => a.type === 'deriva' && a.created_at >= desde && a.created_at < hasta)
    .map((a) => ({ titulo: a.title, cuerpo: a.body, cuando: a.created_at }));

  const g = estadoGlobal(ahora);
  const frescura = {
    cuotas: g.cuotas.modo === 'real' ? 'cuotas reales' : 'modo demostración (sin ODDS_API_KEY)',
    deportes: g.deportes.map((x) => ({ sport: x.sport, datosHasta: x.datosHasta, ultimaCuota: x.ultimaCuota })),
    resultados: g.resultados.ultima,
  };

  let experimentos: DatosSemanal['experimentos'] = [];
  try {
    experimentos = readRegistry()
      .experiments.filter((e) => e.date >= desde && e.date < hasta)
      .map((e) => {
        const i = interpretarExperimento(e);
        return { fecha: e.date, hipotesis: e.hypothesis, veredicto: i.candidato, motivo: i.motivo, aceptado: !!e.accepted };
      });
  } catch {
    experimentos = [];
  }

  return { semana, desde: lunes, hasta: sumarDias(lunesSiguiente, -1), zona, generado: ahora.toISOString(), salud, clv, banco, estrategias, deriva, frescura, experimentos };
}

const f4 = (x: number | null) => (x == null ? '—' : x.toFixed(4).replace('.', ','));

export function markdownSemanal(d: DatosSemanal): { titulo: string; resumen: string; markdown: string } {
  const titulo = `Informe semanal · ${d.semana}`;
  const l: string[] = [
    `# ${titulo}`,
    '',
    `_Del ${fechaLarga(d.desde)} al ${fechaLarga(d.hasta)}. Generado el ${horaCorta(d.generado, d.zona)} (${d.zona}). Lo que no tiene muestra suficiente lleva su aviso; nada aquí cambia una probabilidad del modelo._`,
    '',
    '## Salud del modelo (ventana de 28 días)',
    '',
  ];
  const conDatos = d.salud.filter((s) => s.n > 0);
  if (conDatos.length === 0) l.push('Ninguna predicción en vivo con resultado en la ventana: no hay nada que medir todavía.');
  else {
    l.push(
      tabla(
        ['Deporte', 'Predicciones', 'Log loss', 'Backtest', 'Brier', 'PSI', 'Deriva'],
        conDatos.map((s) => [NOMBRE_DEPORTE[s.sport as SportId] ?? s.sport, s.n, f4(s.logLoss), f4(s.refLogLoss), f4(s.brier), s.psi == null ? '—' : s.psi.toFixed(3).replace('.', ','), s.deriva ? `sí: ${s.motivos.join('; ')}` : 'no']),
      ),
    );
    const avisos = conDatos.filter((s) => s.aviso);
    if (avisos.length) l.push('', ...avisos.map((s) => `- ${NOMBRE_DEPORTE[s.sport as SportId] ?? s.sport}: ${s.aviso}`));
  }

  l.push('', '## CLV del banco de papel', '');
  if (d.clv.n === 0) l.push('Ninguna apuesta de papel cerró esta semana con cuota de cierre observada.');
  else {
    l.push(`- ${d.clv.n} apuesta(s) con cierre: CLV medio ${pct(d.clv.medio, 2)}, ${d.clv.positivos} por encima del cierre.`);
    if (d.clv.aviso) l.push(`- ${d.clv.aviso}`);
  }

  l.push('', '## Banco', '');
  l.push(`- Banco de papel ${dinero(d.banco.banco)} · esta semana ${conSigno(d.banco.beneficioSemana)} en ${d.banco.liquidadasSemana} apuesta(s) liquidada(s) · ${d.banco.pendientes} pendiente(s).`);
  if (d.estrategias.length) {
    l.push('', tabla(['Estrategia', 'Liquidadas', 'Beneficio', 'CLV medio'], d.estrategias.map((e) => [e.nombre, e.liquidadas, conSigno(e.beneficio), pct(e.clvMedio, 2)])));
    l.push('', '_Una semana de una estrategia casi nunca llega a 30 apuestas: compararlas se hace en el laboratorio, con su aviso de muestra._');
  }

  l.push('', '## Alertas de deriva', '');
  if (d.deriva.length === 0) l.push('Ninguna esta semana.');
  else for (const a of d.deriva) l.push(`- **${a.titulo}** (${horaCorta(a.cuando, d.zona)}): ${a.cuerpo}`);

  l.push('', '## Frescura de los datos', '', `- Cuotas: ${d.frescura.cuotas}.`, `- Últimos resultados: ${d.frescura.resultados ? horaCorta(d.frescura.resultados, d.zona) : 'nunca'}.`);
  l.push('', tabla(['Deporte', 'Datos hasta', 'Última cuota real'], d.frescura.deportes.map((x) => [NOMBRE_DEPORTE[x.sport as SportId] ?? x.sport, x.datosHasta?.slice(0, 10) ?? '—', x.ultimaCuota ? horaCorta(x.ultimaCuota, d.zona) : '—'])));

  l.push('', '## Experimentos', '');
  if (d.experimentos.length === 0) l.push('Ningún experimento registrado esta semana.');
  else for (const e of d.experimentos) l.push(`- ${e.hipotesis}: **${e.aceptado ? 'aceptado' : e.veredicto}**. ${e.motivo}`);
  l.push('', '_El holdout final sigue cerrado: ningún experimento se promociona sin él._');

  const conDeriva = d.salud.filter((s) => s.deriva).length;
  const resumenTxt = `${conDeriva ? `deriva en ${conDeriva} deporte(s)` : 'sin deriva'} · CLV ${d.clv.n ? pct(d.clv.medio, 2) : '—'} (${d.clv.n}) · semana ${conSigno(d.banco.beneficioSemana)} · ${d.experimentos.length} experimento(s)`;
  return { titulo, resumen: resumenTxt, markdown: l.join('\n') + '\n' };
}
