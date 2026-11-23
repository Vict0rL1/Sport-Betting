// La decisión: cuánto se arriesga, y cuándo no se arriesga nada.
//
// ===========================================================================
// SEPARADO DEL MODELO A PROPÓSITO
// ===========================================================================
// El modelo dice una probabilidad. Este fichero decide un dinero. Son responsabilidades
// distintas y aquí no entra ni un Elo: entran p, cuota, deporte y banco.
//
// La consecuencia práctica de separarlas es la que importa: se puede mejorar el modelo
// sin tocar el riesgo, y —más importante— se puede APRETAR EL RIESGO SIN TOCAR EL
// MODELO. Cuando las dos cosas viven en la misma función, subir un límite y mejorar una
// predicción se parecen demasiado.
//
// ===========================================================================
// LAS SEIS PUERTAS, EN ORDEN
// ===========================================================================
// Una apuesta tiene que pasar por todas. Se evalúan en este orden porque las primeras
// son las más baratas y las que más apuestas descartan:
//
//   1. ¿Hay ventaja al precio ofrecido?      → si no, cero
//   2. ¿Está el modelo lo bastante calibrado? → multiplica el tamaño, puede ser cero
//   3. Kelly fraccional (1/4 o 1/5)           → el tamaño base
//   4. Tope duro por evento                   → recorta
//   5. Límite de pérdida diario y semanal     → corta la operativa entera
//   6. Exposición total simultánea            → recorta hasta lo que quepa
//
// El paso 5 no recorta: CORTA. Un límite que reduce el tamaño en vez de parar es un
// límite que se puede cruzar apostando más veces, y entonces no es un límite.
//
// La puerta 6 se añadió DESPUÉS, al medir: 25 candidatas al 2 % sumaban el 50 % del
// banco expuesto de golpe, y cada una decía «2 %, prudente». Kelly y el tope por evento
// dimensionan cada apuesta como si fuera la única, y en un sábado no lo es.
//
// Y una regla que no es una puerta sino una forma de entrar: `decideEvent` elige UNA
// selección por partido. Los tres lados de un 1X2 son mutuamente excluyentes y
// dimensionarlos por separado —lo que esto hacía— construía tres posiciones sobre el
// mismo partido con una rama que pierde con certeza.

import {
  fractionalKelly,
  expectedValue,
  expectedLogGrowth,
  type KellyFraction,
} from './kelly.ts';
import { calibrationMultiplier, type CalibrationFile, readCalibration } from './calibration.ts';
import {
  CONTRATO_RIESGO,
  centimosConSigno,
  diaEn,
  estadoPerdidasPersonales,
  exposicionPersonal,
  limiteCentimos,
  periodosEn,
  zonaPolitica,
  type EstadoPerdidas,
  type Moneda,
} from './contabilidad.ts';

export interface StakingConfig {
  /** Un cuarto o un quinto. El tipo no admite Kelly completo. */
  kellyFraction: KellyFraction;
  /** Tope duro por evento, como fracción del banco. */
  maxPerEvent: number;
  /** Pérdida diaria que corta la operativa, como fracción del banco. */
  dailyLossLimit: number;
  /** Pérdida semanal que corta la operativa, como fracción del banco. */
  weeklyLossLimit: number;
  /** Ventaja mínima al precio ofrecido para molestarse. */
  minEdge: number;
  /**
   * Tope de dinero EN RIESGO A LA VEZ, como fracción del banco.
   *
   * Kelly y el tope por evento dimensionan cada apuesta como si fuera la única, y en un
   * sábado no lo es. Sin esto, 25 candidatas al 2 % suman el 50 % del banco expuesto de
   * golpe — medido, no supuesto — y el sizing de cada una decía «2 %, prudente».
   */
  maxTotalExposure: number;
  /**
   * Tope de exposición por DÍA, como fracción del banco.
   *
   * Distinto del tope total y no redundante con él: el total gobierna todo lo que está
   * vivo a la vez, incluidas las apuestas de un torneo que se resuelve el jueves. Este
   * gobierna lo que se juega EN UNA TARDE, que es la unidad en la que llega una mala
   * racha — quince partidos del sábado se liquidan juntos y su resultado es un solo
   * salto del banco, no quince pasos.
   */
  maxExposurePerDay: number;
  /**
   * Tope de exposición por LIGA, como fracción del banco.
   *
   * Existe por un motivo que la medición NO respalda y hay que decirlo: se midió la
   * correlación entre partidos de una misma liga y jornada y salió indistinguible de
   * cero (ver staking/correlation.ts). Así que esto no protege de una dependencia
   * medida, protege del RIESGO DE MODELO: si el Dixon-Coles de una liga concreta está
   * roto —datos mal cargados, un ascenso mal sembrado, una temporada corta— el fallo es
   * de esa liga entera y se lleva todas sus posiciones por delante a la vez. La
   * correlación de resultados es cero; la de «que mi modelo esté equivocado» no lo es, y
   * esa no se puede estimar con los mismos datos que produjeron el modelo.
   */
  maxExposurePerLeague: number;
}

/**
 * Los valores por defecto, y por qué cada uno.
 *
 * kellyFraction 0.25 — un cuarto. Aguanta un error de estimación grande sin cambiar el
 *   signo del crecimiento esperado.
 *
 * maxPerEvent 0.02 — el 2 % del banco. Kelly fraccional YA limita, pero limita en
 *   función de p, y p es justo lo que puede estar mal. El tope es la red que no depende
 *   del modelo: con una p disparatada, Kelly pediría el 30 % del banco y esto lo corta
 *   en el 2 % sin necesidad de saber que la p estaba mal.
 *
 * dailyLossLimit 0.05 / weeklyLossLimit 0.10 — un mal día se aguanta; una mala semana
 *   se para. Los dos existen porque protegen de cosas distintas: el diario, de una tarde
 *   de mala suerte; el semanal, de que el modelo se haya roto sin avisar.
 *
 * minEdge 0.02 — dos puntos porcentuales. Por debajo, la diferencia entre la p del
 *   modelo y la del precio está dentro del error de las dos estimaciones.
 */
export const DEFAULT_CONFIG: StakingConfig = {
  kellyFraction: 0.25,
  maxPerEvent: 0.02,
  dailyLossLimit: 0.05,
  weeklyLossLimit: 0.1,
  minEdge: 0.02,
  // 10 %: cinco apuestas al tope simultáneas. Por encima de eso, una mala jornada deja
  // de ser una mala jornada.
  maxTotalExposure: 0.1,
  // 6 % en un día: tres apuestas al tope. Es menos que el total a propósito — el total
  // puede repartirse entre varios días, y el día es donde una racha se concentra.
  maxExposurePerDay: 0.06,
  // 5 % por liga: la mitad del total. Con seis ligas configuradas, obliga a que el
  // banco no dependa de que el modelo de UNA de ellas esté bien.
  maxExposurePerLeague: 0.05,
};

export interface StakeRequest {
  sport: string;
  /** Probabilidad del modelo para ESTA selección. */
  p: number;
  /** Cuota decimal ofrecida, con el margen de la casa dentro. */
  odds: number;
  bankroll: number;
  /**
   * Dinero ya comprometido y sin resolver, incluyendo lo que se acaba de decidir en
   * esta misma tanda. Por defecto se lee de las apuestas pendientes en la base.
   *
   * Se pasa explícitamente porque al dimensionar una lista hay que ir acumulando: si
   * cada llamada consultara solo la base, las veinte apuestas de la lista se
   * dimensionarían todas como si fueran la primera.
   */
  openExposure?: number;
  /**
   * Pérdidas realizadas de HOY y de ESTA SEMANA del banco que apuesta (negativas si se pierde).
   *
   * Sin ellas, los límites leen el registro personal (`bets`), que es lo que han hecho siempre.
   * Las pasa el laboratorio de estrategias (Fase 6.1): cada banco tiene que mirar sus propias
   * pérdidas, no las de otro.
   */
  perdidas?: { hoy: number | null; semana: number | null };
  /**
   * La moneda del banco, para leer del registro personal solo sus apuestas (contabilidad.ts). Sin
   * ella, ninguna apuesta personal se puede atribuir al banco y, si hay alguna, los límites quedan sin
   * evaluar. No se usa cuando se pasan `perdidas` y `openExposure`.
   */
  moneda?: Moneda | null;
  /** Los límites ya evaluados por quien llama (`decideBook` los lee una vez para toda la cartera). */
  limites?: LossState;
}

export interface StakeDecision {
  /** Dinero a arriesgar. 0 significa no apostar. */
  stake: number;
  /** El mismo número como fracción del banco, que es como se piensa el riesgo. */
  fraction: number;
  /** Valor esperado por unidad al precio ofrecido. */
  edge: number;
  /** Cada paso, con lo que hizo. Es la explicación de por qué salió ese número. */
  steps: { gate: string; result: string }[];
  /** Qué paso lo dejó en cero, si alguno. */
  blockedBy: string | null;
}

export interface LossState {
  /** Lo que se sabe seguro de hoy y de la semana, en unidades de la moneda del banco. */
  today: number;
  week: number;
  /** Los límites en unidades (negativos), o null si el banco no se puede leer. */
  dayLimit: number | null;
  weekLimit: number | null;
  /** Alcanzado SEGURO: también en el mejor caso de lo que no se sabe. */
  dayBreached: boolean;
  weekBreached: boolean;
  /** false: falta algo para saber si se está por debajo (staking/contabilidad.ts). No se apuesta. */
  evaluable: boolean;
  /** El detalle: contrato, zona, moneda, cotas y lo que no se sabe. */
  estado: EstadoPerdidas;
}

/** De un estado de la contabilidad a lo que leen la decisión y la pantalla. */
export function aLossState(e: EstadoPerdidas): LossState {
  const u = (c: number | null) => (c == null ? null : c / 100);
  return {
    today: e.hoy.conocido / 100,
    week: e.semana.conocido / 100,
    dayLimit: u(e.hoy.limite),
    weekLimit: u(e.semana.limite),
    dayBreached: e.hoy.veredicto === 'alcanzado',
    weekBreached: e.semana.veredicto === 'alcanzado',
    evaluable: e.hoy.veredicto !== 'sin-evaluar' && e.semana.veredicto !== 'sin-evaluar',
    estado: e,
  };
}

/**
 * Cuánto se lleva perdido hoy y esta semana en el registro PERSONAL, para un banco de `moneda`.
 *
 * El contrato (qué se cuenta, en qué día y zona, y qué pasa cuando falta un dato) está en
 * staking/contabilidad.ts. Antes: coma flotante, un cashout sin importe valía 0, se sumaban todas las
 * monedas y se contaba por día de COLOCACIÓN con la hora del servidor (seguimiento del PR #18, R1–R7).
 *
 * Resueltas y no pendientes: una apuesta abierta no es una pérdida, y contarla como tal cortaría la
 * operativa por partidos que todavía se están jugando. El riesgo vivo es otra cosa y no es lo que
 * estos límites gobiernan.
 *
 * La semana empieza el lunes, que es la convención con la que la gente piensa una semana. No es
 * arbitrario que esté escrito: con una ventana móvil de 7 días, el límite se «renueva» un poco cada día
 * y se puede sangrar indefinidamente sin llegar a cruzarlo nunca.
 */
export function lossState(bankroll: number, cfg: StakingConfig, now = new Date(), moneda: Moneda | null = null): LossState {
  return aLossState(estadoPerdidasPersonales(bankroll, moneda, cfg, now));
}

/**
 * Lo realizado HOY y ESTA SEMANA (lunes a domingo, en la zona de la política) por fecha de
 * liquidación, a partir de las apuestas liquidadas de un banco, en unidades. Lo usan el banco de papel
 * y cada estrategia: cada banco mira sus propias pérdidas, no las del registro personal.
 *
 * Se suma en céntimos (cada beneficio guardado, redondeado una vez). null: no se puede saber (zona de la
 * política mal escrita, o una liquidación de la semana sin beneficio o sin fecha legible). Antes, un
 * beneficio que faltaba contaba 0 y el día lo decidía la hora del servidor.
 */
export function perdidasRealizadas(
  filas: { settled_at: string; profit: number | null }[],
  now = new Date(),
  zona: string | null = zonaPolitica().zona,
): { hoy: number | null; semana: number | null } {
  if (!zona) return filas.length === 0 ? { hoy: 0, semana: 0 } : { hoy: null, semana: null };
  const { hoy, lunes } = periodosEn(now, zona);
  let h = 0;
  let s = 0;
  let hDesconocido = false;
  let sDesconocido = false;
  for (const f of filas) {
    const d = diaEn(f.settled_at, zona);
    const c = f.profit == null ? null : centimosConSigno(f.profit);
    if (d == null) {
      // No se sabe el día: puede ser de hoy.
      hDesconocido = sDesconocido = true;
      continue;
    }
    if (d < lunes || d > hoy) continue;
    if (c == null) {
      sDesconocido = true;
      if (d === hoy) hDesconocido = true;
      continue;
    }
    s += c;
    if (d === hoy) h += c;
  }
  return { hoy: hDesconocido ? null : h / 100, semana: sDesconocido ? null : s / 100 };
}

/** Desde cuándo pedir liquidaciones para `perdidasRealizadas`: ocho días cubren cualquier semana. */
export const desdeParaPerdidas = (now = new Date()) => new Date(now.getTime() - 8 * 86_400_000).toISOString();

/**
 * El mismo estado que `lossState`, con unas pérdidas ya calculadas por quien llama (banco de papel,
 * estrategias). Se compara en céntimos con el mismo límite que el registro personal; null en una
 * pérdida es «no se sabe» y deja el límite sin evaluar.
 */
export function estadoDePerdidas(bankroll: number, cfg: StakingConfig, p: { hoy: number | null; semana: number | null }): LossState {
  const periodo = (x: number | null, limite: number | null): EstadoPerdidas['hoy'] => {
    const c = x == null ? null : centimosConSigno(x);
    const v = limite == null || c == null ? 'sin-evaluar' : c <= limite ? 'alcanzado' : 'por-debajo';
    return { desde: null, hasta: null, conocido: c ?? 0, minimo: c, maximo: c, limite, veredicto: v };
  };
  const hoy = periodo(p.hoy, limiteCentimos(bankroll, cfg.dailyLossLimit));
  const semana = periodo(p.semana, limiteCentimos(bankroll, cfg.weeklyLossLimit));
  return aLossState({
    contrato: CONTRATO_RIESGO,
    base: 'liquidacion',
    zona: zonaPolitica().zona,
    semanaEmpieza: 'lunes',
    moneda: null,
    hoy,
    semana,
    apuestas: 0,
    incidencias: [],
  });
}

/**
 * Cuánto arriesgar en una selección, y por qué.
 *
 * Devuelve SIEMPRE los pasos, también cuando el resultado es apostar. Un número sin la
 * cadena que lo produjo no se puede auditar, y esta es la parte del sistema donde un
 * error no se manifiesta como una excepción sino como dinero.
 */
export function decideStake(
  req: StakeRequest,
  cfg: StakingConfig = DEFAULT_CONFIG,
  cal: CalibrationFile = readCalibration(),
  now = new Date(),
): StakeDecision {
  const steps: StakeDecision['steps'] = [];
  const edge = expectedValue(req.p, req.odds);
  const zero = (gate: string): StakeDecision => ({
    stake: 0,
    fraction: 0,
    edge,
    steps,
    blockedBy: gate,
  });

  // --- 1. ¿Hay ventaja al precio ofrecido? ---
  steps.push({
    gate: '1 · ventaja al precio',
    result: `p ${(req.p * 100).toFixed(1)} % × cuota ${req.odds.toFixed(2)} = ${(edge >= 0 ? '+' : '') + (edge * 100).toFixed(2)} %`,
  });
  if (edge < cfg.minEdge) {
    steps.push({
      gate: '1 · ventaja al precio',
      result: `por debajo del mínimo de ${(cfg.minEdge * 100).toFixed(1)} % → no se apuesta`,
    });
    return zero('ventaja insuficiente');
  }

  // --- 2. Calibración del modelo ---
  const calib = calibrationMultiplier(req.sport, cal);
  steps.push({ gate: '2 · calibración', result: `×${calib.multiplier.toFixed(2)} — ${calib.reason}` });
  if (calib.multiplier <= 0) return zero('calibración insuficiente');

  // --- 3. Kelly fraccional ---
  const kelly = fractionalKelly(req.p, req.odds, cfg.kellyFraction);
  const sized = kelly * calib.multiplier;
  steps.push({
    gate: `3 · Kelly ${cfg.kellyFraction === 0.25 ? '1/4' : '1/5'}`,
    result: `${(kelly * 100).toFixed(2)} % del banco, ajustado a ${(sized * 100).toFixed(2)} % por calibración`,
  });

  // --- 4. Tope por evento ---
  const capped = Math.min(sized, cfg.maxPerEvent);
  steps.push({
    gate: '4 · tope por evento',
    result:
      capped < sized
        ? `RECORTADO del ${(sized * 100).toFixed(2)} % al ${(capped * 100).toFixed(2)} %`
        : `${(capped * 100).toFixed(2)} %, por debajo del tope del ${(cfg.maxPerEvent * 100).toFixed(1)} %`,
  });

  // --- 5. Límites de pérdida ---
  const loss = req.limites ?? (req.perdidas ? estadoDePerdidas(req.bankroll, cfg, req.perdidas) : lossState(req.bankroll, cfg, now, req.moneda ?? null));
  const lim = (x: number | null) => (x == null ? '—' : x.toFixed(2));
  steps.push({
    gate: '5 · límites de pérdida',
    result:
      `hoy ${loss.today.toFixed(2)} (límite ${lim(loss.dayLimit)}) · ` +
      `semana ${loss.week.toFixed(2)} (límite ${lim(loss.weekLimit)})` +
      (loss.evaluable ? '' : ' · sin evaluar: falta información (moneda, fecha o importe)'),
  });
  // Alcanzado antes que «sin evaluar»: si incluso en el mejor caso se llega al límite, eso es lo que es.
  if (loss.dayBreached) return zero('límite de pérdida DIARIA alcanzado');
  if (loss.weekBreached) return zero('límite de pérdida SEMANAL alcanzado');
  if (!loss.evaluable) return zero('límites de pérdida sin evaluar: falta información');

  // --- 6. Exposición total simultánea ---
  const open = req.openExposure ?? pendingExposure(req.moneda ?? null);
  if (!Number.isFinite(open)) {
    steps.push({ gate: '6 · exposición total', result: 'sin evaluar: hay apuestas pendientes con un importe ilegible' });
    return zero('exposición sin evaluar: falta información');
  }
  const room = Math.max(0, cfg.maxTotalExposure * req.bankroll - open);
  const wanted = capped * req.bankroll;
  // Se REDONDEA HACIA ABAJO a céntimos, no al más cercano: redondear al más cercano
  // puede subir la apuesta por encima del tope que se acaba de aplicar, que es una
  // forma pequeña y tonta de que un límite no sea un límite.
  const stake = Math.floor(Math.min(wanted, room) * 100) / 100;
  steps.push({
    gate: '6 · exposición total',
    result:
      `${open.toFixed(2)} ya en riesgo de ${(cfg.maxTotalExposure * req.bankroll).toFixed(2)} · ` +
      (stake < wanted ? `RECORTADO de ${wanted.toFixed(2)} a ${stake.toFixed(2)}` : 'cabe entera'),
  });
  if (stake <= 0) return zero('sin margen de exposición: ya hay demasiado en juego');

  return {
    stake,
    fraction: stake / req.bankroll,
    edge,
    steps,
    blockedBy: null,
  };
}

/**
 * Una sola decisión por EVENTO, no una por resultado posible.
 *
 * Este es el bug que más caro salía. Los tres resultados de un 1X2 son mutuamente
 * excluyentes: dimensionarlos por separado daba tres apuestas sobre el mismo partido
 * —medido: 20 + 11,29 + 5,48 sobre un banco de 1.000— y una de las tres ramas pierde
 * dinero con certeza. Kelly sobre resultados excluyentes es una optimización CONJUNTA,
 * no tres independientes, y hacerlo mal siempre sobreapuesta.
 *
 * La solución práctica y la que se usa: se elige UNA selección y se dimensiona esa.
 * Renuncia a la ganancia teórica de repartir entre varias, y a cambio no puede
 * construir una posición que pierde pase lo que pase.
 *
 * Y se elige por CRECIMIENTO ESPERADO, no por ventaja. Es una distinción que parece
 * cosmética y no lo es: f* = ventaja / (cuota − 1), así que una selección a cuota alta
 * puede tener más ventaja y muchísimo menos Kelly. Con estas tres —0.15, 0.131 y 0.092
 * de ventaja— el orden coincide, pero solo por casualidad: sus Kelly son 0.115, 0.045 y
 * 0.022, y bastaría una cuota más larga para que el de más ventaja fuese el de menos
 * crecimiento. Se ordena por lo que el módulo entero está maximizando.
 */
export function decideEvent(
  selections: { label: string; p: number; odds: number }[],
  base: Omit<StakeRequest, 'p' | 'odds'>,
  cfg: StakingConfig = DEFAULT_CONFIG,
  cal: CalibrationFile = readCalibration(),
  now = new Date(),
): (StakeDecision & { label: string }) | null {
  const best = bestSelection(selections, cfg);
  if (!best) return null;
  const d = decideStake({ ...base, p: best.p, odds: best.odds }, cfg, cal, now);
  return { ...d, label: best.label };
}

/**
 * Cuál de las selecciones excluyentes se elige, sin dimensionarla.
 *
 * Extraída de `decideEvent` para que el sizing de cartera pueda elegir primero y
 * dimensionar después, con todas las candidatas ya sobre la mesa. Con la regla copiada
 * en dos sitios, la lista de la cartera y la decisión individual podrían discrepar
 * sobre qué lado del mismo partido se juega, y esa clase de desacuerdo no se nota hasta
 * que el número de la pantalla y el del informe son distintos.
 */
export function bestSelection<T extends { p: number; odds: number }>(
  selections: T[],
  cfg: StakingConfig = DEFAULT_CONFIG,
): T | null {
  if (selections.length === 0) return null;
  const growth = (s: { p: number; odds: number }): number =>
    expectedLogGrowth(s.p, s.odds, fractionalKelly(s.p, s.odds, cfg.kellyFraction));
  let best = selections[0];
  for (const s of selections) {
    if (growth(s) > growth(best)) best = s;
  }
  return best;
}

/**
 * Dinero comprometido en apuestas PERSONALES todavía sin resolver, para un banco de `moneda`, en
 * unidades. Es la cota de arriba (contabilidad.ts): las pendientes sin moneda pueden ser del banco y
 * se cuentan como si lo fueran; las de otra moneda, no. Infinity si alguna tiene un importe ilegible.
 *
 * `pending` únicamente: una apuesta resuelta ya no está en riesgo, esté ganada o perdida, y contarla
 * aquí bloquearía la operativa por dinero que ya volvió.
 */
export function pendingExposure(moneda: Moneda | null = null): number {
  return exposicionPersonal(moneda).total.maximo / 100;
}

/**
 * Lo pendiente del registro personal para un banco de `moneda`, partido por día del PARTIDO y por
 * liga, en unidades y con la cota de arriba (ver `pendingExposure`). Lo que no tiene día de partido
 * conocido va en `sinDia` y cuenta en el tope de cualquier día (contabilidad.ts, R9).
 *
 * Un único total no puede gobernar tres topes distintos: 8 % repartido entre cuatro ligas y cuatro días
 * es una cartera; el mismo 8 % en una liga y un sábado es una sola apuesta disfrazada de cuatro.
 */
export function exposureBreakdown(moneda: Moneda | null = null): {
  total: number;
  byDay: Map<string, number>;
  byLeague: Map<string, number>;
  /** Lo pendiente sin día de partido conocido: cuenta en el tope de cualquier día. */
  sinDia: number;
  /** Pendientes sin moneda o con importe ilegible que se cuentan como del banco. */
  sinClasificar: number;
} {
  const e = exposicionPersonal(moneda);
  const u = (m: Map<string, { maximo: number }>) => new Map([...m].map(([k, v]) => [k, v.maximo / 100]));
  return {
    total: e.total.maximo / 100,
    byDay: u(e.porDia),
    byLeague: u(e.porLiga),
    sinDia: e.sinDia.maximo / 100,
    sinClasificar: e.incidencias.reduce((a, i) => a + i.apuestas, 0),
  };
}
