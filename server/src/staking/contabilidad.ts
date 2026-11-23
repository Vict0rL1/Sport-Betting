// LA CONTABILIDAD DEL RIESGO (contrato 'riesgo-v1', seguimiento del PR #18, fase B).
//
// Qué se cuenta, en qué moneda, en qué día y qué pasa cuando falta un dato, para los límites de
// pérdida y los topes de exposición. La DECISIÓN (cuánto apostar) sigue en policy.ts; aquí solo se
// cuenta. Los porcentajes de los límites no cambian (DEFAULT_CONFIG y la política versionada).
//
// ===========================================================================
// EL CONTRATO
// ===========================================================================
//   Banco          Un banco es dinero de UNA moneda (EUR, USD o GBP) y unas apuestas: el registro
//                  personal (`bets`) en esa moneda, el banco de papel (`paper_bets`) o una
//                  estrategia (`strategy_bets`). Nunca se mezclan entre sí (los dos últimos pasan
//                  sus propias pérdidas y exposición a policy.ts).
//   Moneda         Una apuesta personal es del banco si su moneda es la del banco. Una de OTRA
//                  moneda no es suya. Una SIN moneda (anterior a la v29) no se sabe: puede serlo o
//                  no, y se trata así (abajo). Sin tipos de cambio: nunca se suma una moneda a otra.
//                  Un banco sin moneda tampoco sabe cuáles son suyas.
//   Qué mide       La PÉRDIDA NETA REALIZADA: la suma de los beneficios (negativos y positivos) de
//                  las apuestas liquidadas en el periodo, con el dinero exacto de dinero.ts (el
//                  mismo pago que el registro y la exportación). Una nula o un push suman 0.
//   Día            El día en que se LIQUIDÓ, en la zona de la política. Es el día en que el dinero
//                  se perdió; la colocación no (una apuesta del domingo perdida el lunes es del
//                  lunes). `settled_at` es cuándo la app registró la liquidación:
//                    · pasó de pendiente a liquidada en la app → ese día;
//                    · entró YA liquidada (a mano o por CSV; `settled_at` = `created_at`) → se liquidó
//                      algún día entre la colocación y el registro: si son el mismo día, ese; si no,
//                      el día no se sabe y NO se inventa (ni la colocación ni el registro);
//                    · liquidada sin `settled_at` (solo editando la base a mano) → algún día desde la
//                      colocación: no se sabe.
//   Zona           APP_TIMEZONE; sin ella, la del servidor (la misma que los informes). Una
//                  APP_TIMEZONE mal escrita NO cae a otra zona en silencio: los límites quedan sin
//                  evaluar. La zona de visualización de la web es otra cosa y no mueve un límite.
//   Semana         De lunes a domingo, en esa zona. Hoy = el día de hoy en esa zona.
//   Límite         −⌈banco × porcentaje⌉, en céntimos, redondeado una vez. Con pérdidas en céntimos
//                  enteros, «pérdida ≥ ⌈banco × %⌉» es exactamente «pérdida ≥ banco × %», la
//                  comparación de antes (revisión quant): ni un céntimo más estricto ni más laxo. Se
//                  alcanza con una pérdida neta IGUAL o mayor.
//   Exposición     Lo apostado en apuestas pendientes del banco, en céntimos, por moneda. Por día,
//                  el día del PARTIDO, el mismo que el de las candidatas (la fecha UTC de su inicio):
//                  el de la instantánea enlazada, si la hay. Sin ella no se sabe (las apuestas
//                  personales no guardan la hora del partido, y colocarla el viernes no dice que se
//                  juegue el viernes): va a `sinDia`, que cuenta en el tope de CUALQUIER día (cota de
//                  arriba; revisión quant, R9). Por liga, su liga o el cubo «(sin liga)».
//
// ===========================================================================
// LO QUE NO SE SABE, CON COTAS
// ===========================================================================
// Cada apuesta con un dato desconocido (moneda, día o importe) aporta un INTERVALO, no un número:
// lo menos y lo más que puede sumar. Con todo, el periodo tiene un neto mínimo y uno máximo, y:
//
//   alcanzado     incluso en el mejor caso, la pérdida llega al límite;
//   por-debajo    incluso en el peor caso, no llega;
//   sin-evaluar   depende de lo que no se sabe. No se dice «por debajo» y policy.ts no apuesta.
//
// Así un dato que falta nunca se convierte en 0 y, cuando no cambia el veredicto, tampoco lo bloquea.
// Lo desconocido se cuenta y se enseña (`incidencias`).

import { apuestaCentimos, cuotaRacional, pagoBrutoCentimos } from '../dinero.ts';
import { local, sumarDias } from '../informes/tiempo.ts';
import { getDb } from '../db.ts';
import { BET_CURRENCIES } from '../bets.ts';

export const CONTRATO_RIESGO = 'riesgo-v1' as const;

export type Moneda = (typeof BET_CURRENCIES)[number];

export const esMoneda = (x: unknown): x is Moneda => typeof x === 'string' && (BET_CURRENCIES as readonly string[]).includes(x);

/** La zona de la política: APP_TIMEZONE, o la del servidor si no está. `zona` null: APP_TIMEZONE no es una zona. */
export function zonaPolitica(entorno: NodeJS.ProcessEnv = process.env): { zona: string | null; origen: 'APP_TIMEZONE' | 'servidor' } {
  const z = entorno.APP_TIMEZONE?.trim();
  if (z) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: z });
      return { zona: z, origen: 'APP_TIMEZONE' };
    } catch {
      return { zona: null, origen: 'APP_TIMEZONE' };
    }
  }
  return { zona: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', origen: 'servidor' };
}

/** El día (YYYY-MM-DD) de un instante en una zona, o null si el instante no se puede leer. */
export function diaEn(iso: string | Date, zona: string): string | null {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isFinite(d.getTime()) ? local(d, zona).fecha : null;
}

/** Hoy y el lunes de esta semana, en la zona de la política. */
export function periodosEn(now: Date, zona: string): { hoy: string; lunes: string } {
  const l = local(now, zona);
  return { hoy: l.fecha, lunes: sumarDias(l.fecha, -(l.diaSemana - 1)) };
}

export type Veredicto = 'por-debajo' | 'alcanzado' | 'sin-evaluar';

export type Incidencia =
  | 'banco-sin-moneda'
  | 'moneda-sin-indicar'
  | 'liquidacion-sin-fecha'
  | 'liquidacion-sin-dia'
  | 'resultado-desconocido'
  | 'importe-invalido'
  | 'zona-invalida'
  | 'banco-invalido';

export interface Periodo {
  desde: string | null;
  hasta: string | null;
  /** Céntimos de lo que se sabe seguro (del banco, del periodo y con importe conocido). */
  conocido: number;
  /** Cotas del neto del periodo, en céntimos. null: sin cota (puede ser cualquier cosa). */
  minimo: number | null;
  maximo: number | null;
  /** El límite en céntimos (negativo), o null si no se puede calcular. */
  limite: number | null;
  veredicto: Veredicto;
}

export interface EstadoPerdidas {
  contrato: typeof CONTRATO_RIESGO;
  base: 'liquidacion';
  zona: string | null;
  semanaEmpieza: 'lunes';
  moneda: Moneda | null;
  hoy: Periodo;
  semana: Periodo;
  /** Apuestas liquidadas que cuentan o pueden contar esta semana. 0 = no hay nada que contar. */
  apuestas: number;
  /** Lo que no se sabe, con cuántas apuestas. */
  incidencias: { codigo: Incidencia; apuestas: number }[];
}

/** Una apuesta liquidada, como la lee la contabilidad. */
export interface Liquidada {
  placed_on: string;
  created_at: string;
  settled_at: string | null;
  status: string;
  stake: number;
  odds: number;
  payout: number | null;
  currency: string | null;
}

const NUNCA = '9999-12-31';
const SIEMPRE = '0000-01-01';
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Un porcentaje (0.05) como fracción exacta. */
function fraccion(x: number): { n: bigint; d: bigint } | null {
  if (x === 0) return { n: 0n, d: 1n };
  return cuotaRacional(x);
}

/** −⌈banco × porcentaje⌉ en céntimos, o null si el banco o el porcentaje no se pueden leer. */
export function limiteCentimos(banco: number, porcentaje: number): number | null {
  const b = apuestaCentimos(banco);
  const f = fraccion(porcentaje);
  if (b == null || b <= 0 || !f) return null;
  return -Number((BigInt(b) * f.n + f.d - 1n) / f.d);
}

/** Lo que puede sumar una apuesta liquidada, en céntimos: [mínimo, máximo] (±Infinity si no hay cota). */
export function beneficioCentimos(r: Pick<Liquidada, 'stake' | 'odds' | 'status' | 'payout'>): { min: number; max: number; incidencia: Incidencia | null } {
  const s = apuestaCentimos(r.stake);
  if (s == null) return { min: -Infinity, max: Infinity, incidencia: 'importe-invalido' };
  switch (r.status) {
    case 'won':
    case 'lost':
    case 'void':
    case 'push':
    case 'half_won':
    case 'half_lost': {
      const p = pagoBrutoCentimos(r.stake, r.odds, r.status);
      return p == null ? { min: -s, max: Infinity, incidencia: 'importe-invalido' } : { min: p - s, max: p - s, incidencia: null };
    }
    case 'cashout': {
      // Un cashout de 0 es un 0 conocido; uno sin importe no se sabe (entre perderlo todo y cualquier cosa).
      if (r.payout == null) return { min: -s, max: Infinity, incidencia: 'resultado-desconocido' };
      const p = pagoBrutoCentimos(r.stake, r.odds, 'cashout', r.payout);
      return p == null ? { min: -s, max: Infinity, incidencia: 'importe-invalido' } : { min: p - s, max: p - s, incidencia: null };
    }
    default:
      return { min: -s, max: Infinity, incidencia: 'resultado-desconocido' };
  }
}

/** Los días en que pudo liquidarse, [desde, hasta], en la zona. Ver «Día» arriba. */
export function diasDeLiquidacion(r: Pick<Liquidada, 'placed_on' | 'created_at' | 'settled_at'>, zona: string): { desde: string; hasta: string; incidencia: Incidencia | null } {
  const colocada = DIA_RE.test(r.placed_on) ? r.placed_on : SIEMPRE;
  if (!r.settled_at) return { desde: colocada, hasta: NUNCA, incidencia: 'liquidacion-sin-fecha' };
  const liquidada = diaEn(r.settled_at, zona);
  if (!liquidada) return { desde: colocada, hasta: NUNCA, incidencia: 'liquidacion-sin-fecha' };
  if (r.settled_at !== r.created_at) return { desde: liquidada, hasta: liquidada, incidencia: null };
  // Entró ya liquidada: no antes de colocarse ni después de registrarse.
  const desde = colocada < liquidada ? colocada : liquidada;
  return { desde, hasta: liquidada, incidencia: desde === liquidada ? null : 'liquidacion-sin-dia' };
}

type Cuenta = 'si' | 'no' | 'quizas';

const dentro = (a: string, b: string, desde: string, hasta: string): Cuenta => (b < desde || a > hasta ? 'no' : a >= desde && b <= hasta ? 'si' : 'quizas');

function alcance(moneda: Moneda | null, de: string | null): { cuenta: Cuenta; incidencia: Incidencia | null } {
  if (moneda == null) return { cuenta: 'quizas', incidencia: 'banco-sin-moneda' };
  if (de === moneda) return { cuenta: 'si', incidencia: null };
  if (de == null) return { cuenta: 'quizas', incidencia: 'moneda-sin-indicar' };
  return { cuenta: 'no', incidencia: null };
}

function veredicto(minimo: number, maximo: number, limite: number | null): Veredicto {
  if (limite == null) return 'sin-evaluar';
  if (Number.isFinite(maximo) && maximo <= limite) return 'alcanzado';
  if (Number.isFinite(minimo) && minimo > limite) return 'por-debajo';
  return 'sin-evaluar';
}

const cota = (x: number): number | null => (Number.isFinite(x) ? x : null);

/**
 * El estado de los límites de un banco a partir de sus apuestas liquidadas. Puro: la fila, el banco,
 * la moneda, los porcentajes, la hora y la zona entran; nada se lee de fuera.
 */
export function evaluarPerdidas(
  filas: readonly Liquidada[],
  banco: number,
  moneda: Moneda | null,
  cfg: { dailyLossLimit: number; weeklyLossLimit: number },
  now: Date,
  zona: string | null,
): EstadoPerdidas {
  const limiteDia = limiteCentimos(banco, cfg.dailyLossLimit);
  const limiteSemana = limiteCentimos(banco, cfg.weeklyLossLimit);
  const incid = new Map<Incidencia, number>();
  const anota = (c: Incidencia | null) => c && incid.set(c, (incid.get(c) ?? 0) + 1);
  if (limiteDia == null || limiteSemana == null) anota('banco-invalido');

  if (!zona) {
    // Sin zona no hay «hoy» ni «lunes». Sin nada liquidado reciente no hay nada que contar en ningún
    // día; con algo, no se sabe en qué día cae.
    anota('zona-invalida');
    const nada = filas.length === 0;
    const sinZona = (limite: number | null): Periodo => ({
      desde: null,
      hasta: null,
      conocido: 0,
      minimo: nada ? 0 : null,
      maximo: nada ? 0 : null,
      limite,
      veredicto: nada && limite != null ? 'por-debajo' : 'sin-evaluar',
    });
    return {
      contrato: CONTRATO_RIESGO,
      base: 'liquidacion',
      zona: null,
      semanaEmpieza: 'lunes',
      moneda,
      hoy: sinZona(limiteDia),
      semana: sinZona(limiteSemana),
      apuestas: filas.length,
      incidencias: [...incid].map(([codigo, apuestas]) => ({ codigo, apuestas })),
    };
  }

  const { hoy, lunes } = periodosEn(now, zona);
  const acum = { hoy: { c: 0, min: 0, max: 0 }, semana: { c: 0, min: 0, max: 0 } };
  let apuestas = 0;
  const incidFila = new Map<Incidencia, number>();
  for (const r of filas) {
    const a = alcance(moneda, r.currency);
    if (a.cuenta === 'no') continue;
    const dias = diasDeLiquidacion(r, zona);
    const b = beneficioCentimos(r);
    const enSemana = dentro(dias.desde, dias.hasta, lunes, hoy);
    if (enSemana === 'no') continue;
    apuestas++;
    for (const c of [a.incidencia, dias.incidencia, b.incidencia]) if (c) incidFila.set(c, (incidFila.get(c) ?? 0) + 1);
    for (const [clave, desde] of [['hoy', hoy], ['semana', lunes]] as const) {
      const p = dentro(dias.desde, dias.hasta, desde, hoy);
      const cuenta: Cuenta = p === 'no' ? 'no' : p === 'si' && a.cuenta === 'si' ? 'si' : 'quizas';
      if (cuenta === 'no') continue;
      const t = acum[clave];
      if (cuenta === 'si') {
        t.min += b.min;
        t.max += b.max;
        if (b.min === b.max) t.c += b.min;
      } else {
        t.min += Math.min(0, b.min);
        t.max += Math.max(0, b.max);
      }
    }
  }
  for (const [c, n] of incidFila) incid.set(c, (incid.get(c) ?? 0) + n);
  const periodo = (desde: string, t: { c: number; min: number; max: number }, limite: number | null): Periodo => ({
    desde,
    hasta: hoy,
    conocido: t.c,
    minimo: cota(t.min),
    maximo: cota(t.max),
    limite,
    veredicto: veredicto(t.min, t.max, limite),
  });
  // «banco-sin-moneda» solo importa si hay algo que no se pudo atribuir.
  if (apuestas === 0) incid.delete('banco-sin-moneda');
  return {
    contrato: CONTRATO_RIESGO,
    base: 'liquidacion',
    zona,
    semanaEmpieza: 'lunes',
    moneda,
    hoy: periodo(hoy, acum.hoy, limiteDia),
    semana: periodo(lunes, acum.semana, limiteSemana),
    apuestas,
    incidencias: [...incid].map(([codigo, apuestas]) => ({ codigo, apuestas })),
  };
}

/** Desde cuándo leer liquidaciones: nueve días cubren cualquier semana en cualquier zona. */
const desdeLectura = (now: Date) => new Date(now.getTime() - 9 * 86_400_000).toISOString();

/** Las apuestas personales liquidadas que pueden caer en esta semana (las sin fecha, todas). */
export function liquidadasPersonales(now: Date): Liquidada[] {
  return getDb()
    .prepare(
      `SELECT placed_on, created_at, settled_at, status, stake, odds, payout, currency FROM bets
        WHERE status <> 'pending' AND (settled_at IS NULL OR settled_at >= ?)`,
    )
    .all(desdeLectura(now)) as unknown as Liquidada[];
}

/** El estado de los límites del registro personal para un banco de `moneda`. */
export function estadoPerdidasPersonales(
  banco: number,
  moneda: Moneda | null,
  cfg: { dailyLossLimit: number; weeklyLossLimit: number },
  now = new Date(),
  zona: string | null = zonaPolitica().zona,
): EstadoPerdidas {
  return evaluarPerdidas(liquidadasPersonales(now), banco, moneda, cfg, now, zona);
}

/** Una cota de exposición en céntimos: lo seguro del banco y lo más que puede ser (Infinity sin cota). */
export interface CotaExposicion {
  seguro: number;
  maximo: number;
}

export interface Exposicion {
  contrato: typeof CONTRATO_RIESGO;
  moneda: Moneda | null;
  total: CotaExposicion;
  /** Por día del partido (YYYY-MM-DD, la fecha UTC de su inicio). */
  porDia: Map<string, CotaExposicion>;
  /** Lo pendiente cuyo día de partido no se sabe: puede caer en cualquier día. */
  sinDia: CotaExposicion;
  porLiga: Map<string, CotaExposicion>;
  /** Pendientes que cuentan o pueden contar. */
  apuestas: number;
  incidencias: { codigo: Incidencia; apuestas: number }[];
}

export interface Pendiente {
  placed_on: string;
  league: string | null;
  stake: number;
  currency: string | null;
  /** El inicio del partido, si se sabe (la instantánea enlazada). */
  commence_time?: string | null;
}

/** La exposición de un banco a partir de sus apuestas pendientes. Pura. */
export function evaluarExposicion(filas: readonly Pendiente[], moneda: Moneda | null): Exposicion {
  const total: CotaExposicion = { seguro: 0, maximo: 0 };
  const porDia = new Map<string, CotaExposicion>();
  const sinDia: CotaExposicion = { seguro: 0, maximo: 0 };
  const porLiga = new Map<string, CotaExposicion>();
  const incid = new Map<Incidencia, number>();
  let apuestas = 0;
  const suma = (m: Map<string, CotaExposicion>, k: string, seguro: number, maximo: number) => {
    const c = m.get(k) ?? { seguro: 0, maximo: 0 };
    c.seguro += seguro;
    c.maximo += maximo;
    m.set(k, c);
  };
  for (const r of filas) {
    const a = alcance(moneda, r.currency);
    if (a.cuenta === 'no') continue;
    apuestas++;
    if (a.incidencia) incid.set(a.incidencia, (incid.get(a.incidencia) ?? 0) + 1);
    const s = apuestaCentimos(r.stake);
    if (s == null) incid.set('importe-invalido', (incid.get('importe-invalido') ?? 0) + 1);
    const maximo = s ?? Infinity;
    const seguro = a.cuenta === 'si' && s != null ? s : 0;
    total.seguro += seguro;
    total.maximo += maximo;
    const dia = r.commence_time && /^\d{4}-\d{2}-\d{2}/.test(r.commence_time) ? r.commence_time.slice(0, 10) : null;
    if (dia) suma(porDia, dia, seguro, maximo);
    else {
      sinDia.seguro += seguro;
      sinDia.maximo += maximo;
    }
    // Sin liga van a un cubo propio y no se reparten: meterlas en «todas» inventaría exposición donde
    // no la hay, y descartarlas la escondería.
    suma(porLiga, r.league ?? '(sin liga)', seguro, maximo);
  }
  return { contrato: CONTRATO_RIESGO, moneda, total, porDia, sinDia, porLiga, apuestas, incidencias: [...incid].map(([codigo, apuestas]) => ({ codigo, apuestas })) };
}

/** La exposición del registro personal para un banco de `moneda`. */
export function exposicionPersonal(moneda: Moneda | null): Exposicion {
  const filas = getDb()
    .prepare(
      `SELECT b.placed_on, b.league, b.stake, b.currency, s.commence_time
         FROM bets b LEFT JOIN prediction_snapshots s ON s.id = b.snapshot_id
        WHERE b.status = 'pending'`,
    )
    .all() as unknown as Pendiente[];
  return evaluarExposicion(filas, moneda);
}

/** Un importe en unidades (puede ser negativo, con decimales de más) en céntimos, redondeado una vez. */
export function centimosConSigno(x: number): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) >= 1e15) return null;
  if (x === 0) return 0;
  // Con doce decimales fijos y no con String(x): 1,2e-7 se escribiría con exponente.
  const [ent, frac] = Math.abs(x).toFixed(12).split('.');
  const n = BigInt(ent + frac);
  const d = 10n ** 12n;
  return Math.sign(x) * Number((2n * n * 100n + d) / (2n * d));
}
