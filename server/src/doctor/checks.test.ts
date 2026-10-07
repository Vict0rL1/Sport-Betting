import { test } from 'node:test';
import assert from 'node:assert/strict';
import './../test/setup.ts';

const {
  comprobarConfiguracion,
  interpretarApi,
  comprobarDeportes,
  comprobarBaseDeDatos,
  comprobarFrescura,
  comprobarServidor,
  resultado,
  enmascarar,
} = await import('./checks.ts');
const { outcomeError, outcomeOk, OddsApiError } = await import('../oddsApi.ts');

const CLAVE = '0123456789abcdef0123456789abcdef';
const base = {
  envPath: '/proyecto/.env',
  envExiste: true,
  envCrudo: `ODDS_API_KEY=${CLAVE}\n`,
  otrosEnv: [] as string[],
  valoresFichero: { ODDS_API_KEY: CLAVE } as Record<string, string>,
  valoresProceso: { ODDS_API_KEY: CLAVE } as Record<string, string | undefined>,
  clave: { value: CLAVE, name: 'ODDS_API_KEY' as string | null },
  regiones: 'eu',
  zonaHoraria: 'Europe/Madrid',
  offsetMin: 120,
};
const niveles = (hs: { nivel: string }[]) => hs.map((x) => x.nivel);
const buscar = <T extends { texto: string }>(hs: T[], re: RegExp): T | undefined => hs.find((x) => re.test(x.texto));

test('configuración correcta: sin errores, y la clave nunca se imprime entera', () => {
  const hs = comprobarConfiguracion(base);
  assert.ok(!niveles(hs).includes('error'));
  assert.ok(buscar(hs, /API key detectada/));
  assert.ok(!JSON.stringify(hs).includes(CLAVE), 'la clave completa no puede aparecer en la salida');
  assert.equal(enmascarar(CLAVE), '••••cdef');
});

test('sin clave: error con la acción exacta', () => {
  const hs = comprobarConfiguracion({ ...base, envCrudo: '', valoresFichero: {}, valoresProceso: {}, clave: { value: '', name: null } });
  const e = buscar(hs, /ODDS_API_KEY no encontrada/);
  assert.equal(e?.nivel, 'error');
  assert.match(e!.accion!.join(' '), /ODDS_API_KEY=/);
});

test('el alias THE_ODDS_API_KEY se reconoce y se dice de dónde salió', () => {
  const hs = comprobarConfiguracion({
    ...base,
    envCrudo: `THE_ODDS_API_KEY=${CLAVE}\n`,
    valoresFichero: { THE_ODDS_API_KEY: CLAVE },
    valoresProceso: { THE_ODDS_API_KEY: CLAVE },
    clave: { value: CLAVE, name: 'THE_ODDS_API_KEY' },
  });
  assert.match(buscar(hs, /API key detectada/)!.texto, /THE_ODDS_API_KEY/);
});

// TEST NEGATIVO: el caso invisible. La terminal tiene la variable con otro valor y
// dotenv no la pisa, así que la app usa la de la terminal.
test('la terminal con OTRA clave pisa al .env: se detecta como error', () => {
  const hs = comprobarConfiguracion({ ...base, valoresProceso: { ODDS_API_KEY: '' } });
  const e = buscar(hs, /La terminal tiene ODDS_API_KEY/);
  assert.equal(e?.nivel, 'error');
  assert.match(e!.accion!.join(' '), /unset ODDS_API_KEY/);
});

test('clave sin nombre delante, comillas y saltos de Windows', () => {
  assert.ok(buscar(comprobarConfiguracion({ ...base, envCrudo: `${CLAVE}\n`, clave: { value: '', name: null } }), /sin `ODDS_API_KEY=` delante/));
  assert.ok(buscar(comprobarConfiguracion({ ...base, envCrudo: `ODDS_API_KEY="${CLAVE}"\n` }), /entre comillas/));
  assert.equal(buscar(comprobarConfiguracion({ ...base, envCrudo: `ODDS_API_KEY=${CLAVE}\r\n` }), /Windows/)?.nivel, 'error');
});

test('región inválida es un error (la API respondería 422)', () => {
  assert.equal(buscar(comprobarConfiguracion({ ...base, regiones: 'europe' }), /ODDS_REGIONS/)?.nivel, 'error');
  assert.equal(buscar(comprobarConfiguracion({ ...base, regiones: 'eu,uk' }), /Regiones/)?.nivel, 'ok');
});

// ---------------------------------------------------------------------------
const listadoOk = {
  status: 200, cuerpo: '', restantes: 463, usados: 37, ms: 120, errorRed: null,
  deportes: [{ key: 'basketball_nba', active: true }, { key: 'baseball_mlb', active: false }],
};
const apiBase = { hayClave: true, sinRed: false, listado: listadoOk, plan: 500, ritmo: { ok: true } as const, gastoPorCiclo: 5, minutosEntreCiclos: 720 };

test('API sana: clave válida, responde, créditos y presupuesto', () => {
  const hs = interpretarApi(apiBase);
  assert.deepEqual(niveles(hs).filter((n) => n !== 'info'), ['ok', 'ok', 'ok', 'ok']);
  assert.ok(buscar(hs, /Créditos restantes: 463/));
  assert.ok(buscar(hs, /~10\/día/));
});

test('401 de clave y 401 de créditos son errores distintos con acciones distintas', () => {
  const clave = interpretarApi({ ...apiBase, listado: { ...listadoOk, status: 401, cuerpo: '{"error_code":"INVALID_KEY"}' } });
  const creditos = interpretarApi({ ...apiBase, listado: { ...listadoOk, status: 401, cuerpo: '{"error_code":"OUT_OF_USAGE_CREDITS"}' } });
  assert.match(clave[0].accion![0], /no es válida/);
  assert.match(creditos[0].accion![0], /sin créditos/);
});

test('sin red y créditos agotados', () => {
  assert.equal(interpretarApi({ ...apiBase, listado: { ...listadoOk, status: null, errorRed: 'ENOTFOUND' } })[0].nivel, 'error');
  assert.equal(buscar(interpretarApi({ ...apiBase, listado: { ...listadoOk, restantes: 0 } }), /Créditos restantes/)?.nivel, 'error');
});

test('el freno de ritmo se enseña como advertencia, con la salida manual', () => {
  const hs = interpretarApi({ ...apiBase, ritmo: { ok: false, reason: 'vas por delante' } });
  assert.match(buscar(hs, /freno de ritmo/)!.accion![0], /npm run odds/);
});

// ---------------------------------------------------------------------------
test('deportes: con cuotas, parcial, sin partidos y con fallo', () => {
  const ok = (key: string, n: number, cp: number) =>
    ({ ...outcomeOk(key, { events: [], credits: 1, fetchedAt: 'x', malformed: 0 }), eventos: n, conPrecio: cp, casas: cp ? 4 : 0 });
  const hs = comprobarDeportes(
    [
      { nombre: 'NBA', claves: ['basketball_nba'], ultimas: [ok('basketball_nba', 8, 8)] },
      { nombre: 'Tenis', claves: ['basketball_nba'], ultimas: [ok('basketball_nba', 19, 6)] },
      { nombre: 'MLB', claves: ['baseball_mlb'], ultimas: [] },
      { nombre: 'NFL', claves: ['basketball_nba'], ultimas: [outcomeError('basketball_nba', new OddsApiError('sin_creditos', 'créditos agotados', 401))] },
    ],
    listadoOk.deportes,
  );
  assert.match(hs[0].texto, /8 eventos \/ 8 con cuotas/);
  assert.equal(hs[0].nivel, 'ok');
  assert.equal(hs[1].nivel, 'aviso');
  assert.match(hs[1].detalle!.join(), /13 evento\(s\) sin ninguna casa/);
  assert.match(hs[2].texto, /ninguna competición en juego/);
  assert.equal(hs[3].nivel, 'error');
  assert.match(hs[3].accion!.join(), /sin créditos/);
});

test('base de datos: totales, demo y sin cuotas', () => {
  const hs = comprobarBaseDeDatos('/x.db', true, [
    { nombre: 'Fútbol', total: 47, reales: 41, demo: 0, sinCuotas: 6 },
    { nombre: 'NFL', total: 12, reales: 12, demo: 0, sinCuotas: 0 },
  ], true);
  assert.ok(buscar(hs, /59 próximos eventos/));
  assert.ok(buscar(hs, /53 con cuotas reales/));
  assert.equal(buscar(hs, /6 sin cuotas/)?.nivel, 'aviso');
  assert.equal(comprobarBaseDeDatos('/x.db', false, [], true)[0].nivel, 'error');
});

test('frescura: cuotas de más de 6 h avisan; solo demo no da ✓', () => {
  const ahora = new Date('2026-10-01T12:00:00Z');
  const viejas = comprobarFrescura([{ nombre: 'NBA', ultimoRefresco: '2026-10-01T11:56:00Z', precioMasNuevo: '2026-10-01T02:00:00Z' }], ahora, true);
  assert.match(viejas[0].texto, /hace 4 min/);
  assert.equal(buscar(viejas, /puede que ya no valgan/)?.nivel, 'aviso');
  const demo = comprobarFrescura([{ nombre: 'NBA', ultimoRefresco: '2026-10-01T11:56:00Z', precioMasNuevo: null }], ahora, true);
  assert.equal(demo[0].nivel, 'aviso');
});

test('servidor: apagado es advertencia con `npm run dev`; encendido cuenta lo visible', () => {
  const apagado = comprobarServidor({ puertoApi: 7374, puertoWeb: 7373, api: { ok: false, error: 'no está arrancado' }, web: null, hoy: null });
  assert.equal(apagado[0].nivel, 'aviso');
  assert.deepEqual(apagado[0].accion, ['npm run dev']);
  const encendido = comprobarServidor({ puertoApi: 7374, puertoWeb: 7373, api: { ok: true }, web: { ok: true }, hoy: { partidos: 20, conPrecio: 15 } });
  assert.ok(buscar(encendido, /20 partidos visibles/));
  assert.ok(buscar(encendido, /15 con cuotas reales en pantalla/));
});

test('resultado: error manda, luego avisos; y la misma acción se dice una vez', () => {
  const r = resultado([
    { seccion: 'DEPORTES', nivel: 'aviso', texto: 'Fútbol', accion: ['npm run odds'] },
    { seccion: 'DEPORTES', nivel: 'aviso', texto: 'NBA', accion: ['npm run odds'] },
  ]);
  assert.equal(r.nivel, 'aviso');
  assert.equal(r.acciones.length, 1);
  assert.match(r.acciones[0].texto, /y 1 más: NBA/);
  assert.equal(resultado([{ seccion: 'BASE DE DATOS', nivel: 'ok', texto: 'x' }]).nivel, 'ok');
  assert.equal(resultado([{ seccion: 'BASE DE DATOS', nivel: 'error', texto: 'x' }]).nivel, 'error');
});

// ---------------------------------------------------------------------------
// CONFIANZA
// ---------------------------------------------------------------------------
const { comprobarConfianza, CICLO_MAX_MIN } = await import('./checks.ts');
const AHORA = new Date('2026-10-06T12:00:00Z');
const minAtras = (m: number) => new Date(AHORA.getTime() - m * 60_000).toISOString();
const estado = (over: Partial<Parameters<typeof comprobarConfianza>[0]> = {}): Parameters<typeof comprobarConfianza>[0] => ({
  ultimoCiclo: minAtras(10),
  conCuotaPorEmpezar: 12,
  sinCongelarTrasCiclo: 0,
  pendientesDeCongelar: 0,
  congeladas: 40,
  evaluaciones24h: { BET: 2, 'NO BET': 8, 'SIN MERCADO': 2 },
  motivos24h: [{ familia: 'sin ventaja mínima', tuberia: false, n: 7 }, { familia: 'calidad de datos', tuberia: false, n: 2 }],
  banco7d: { total: 0, familias: [] },
  alertas24h: { importante: 0, aviso: 0, info: 0 },
  deriva7d: null,
  ...over,
});

test('confianza: ciclo al día y abstenciones por decisión del modelo → sin avisos', () => {
  const hs = comprobarConfianza(estado(), AHORA);
  assert.deepEqual(niveles(hs).filter((n) => n === 'aviso' || n === 'error'), []);
  assert.ok(buscar(hs, /Ciclo pre-partido: último hace 10 min · 12 partido/));
  const r = buscar(hs, /Últimas 24 h: 12 partido\(s\) evaluado\(s\)/)!;
  assert.match(r.detalle![0], /88 % de las NO BET: sin ventaja mínima$/, 'sin la marca de «operación»');
});

test('confianza: ciclo parado con partidos con cuota → aviso y npm run dev; sin partidos, solo informa', () => {
  const parado = comprobarConfianza(estado({ ultimoCiclo: minAtras(CICLO_MAX_MIN + 30) }), AHORA);
  const a = buscar(parado, /Último ciclo pre-partido hace 75 min/)!;
  assert.equal(a.nivel, 'aviso');
  assert.deepEqual(a.accion, ['npm run dev']);
  assert.equal(buscar(comprobarConfianza(estado({ ultimoCiclo: null }), AHORA), /nunca ha corrido/)?.nivel, 'aviso');
  // Sin nada que evaluar, que el ciclo no corra no es un problema.
  const vacio = comprobarConfianza(estado({ ultimoCiclo: minAtras(600), conCuotaPorEmpezar: 0 }), AHORA);
  assert.equal(buscar(vacio, /Ciclo pre-partido/)?.nivel, 'info');
  assert.ok(!niveles(vacio).includes('aviso'));
});

test('confianza: empezado ANTES del último ciclo y sin congelar es un error; después, pendiente', () => {
  const mal = comprobarConfianza(estado({ sinCongelarTrasCiclo: 3 }), AHORA);
  assert.equal(buscar(mal, /3 partido\(s\) empezados antes del último ciclo/)?.nivel, 'error');
  const pendiente = comprobarConfianza(estado({ pendientesDeCongelar: 2 }), AHORA);
  assert.match(buscar(pendiente, /congelada/)!.texto, /2 empezado\(s\) se congelarán en el próximo ciclo/);
  assert.ok(!niveles(pendiente).includes('error'));
});

test('confianza: si la mayoría de abstenciones son de operación (precio viejo), avisa con qué hacer', () => {
  const hs = comprobarConfianza(estado({ motivos24h: [{ familia: 'precio viejo', tuberia: true, n: 6 }, { familia: 'sin ventaja mínima', tuberia: false, n: 2 }] }), AHORA);
  const a = buscar(hs, /75 % de las abstenciones son por «precio viejo»/)!;
  assert.equal(a.nivel, 'aviso');
  assert.equal(a.accion![0], 'npm run odds');
  assert.match(buscar(hs, /Últimas 24 h/)!.detalle![0], /\(operación, no el partido\)/);
});

// TEST NEGATIVO: abstenerse mucho por falta de ventaja es la política funcionando. Si esto
// avisara, el doctor enseñaría a ignorar sus avisos.
test('confianza: el 100 % de NO BET por falta de ventaja NO es un aviso; 3 abstenciones no son un patrón', () => {
  const todo = comprobarConfianza(estado({ evaluaciones24h: { BET: 0, 'NO BET': 30, 'SIN MERCADO': 0 }, motivos24h: [{ familia: 'sin ventaja mínima', tuberia: false, n: 30 }] }), AHORA);
  assert.ok(!niveles(todo).includes('aviso'));
  const pocas = comprobarConfianza(estado({ evaluaciones24h: { BET: 0, 'NO BET': 3, 'SIN MERCADO': 0 }, motivos24h: [{ familia: 'precio viejo', tuberia: true, n: 3 }] }), AHORA);
  assert.ok(!niveles(pocas).includes('aviso'), 'por debajo de MIN_PATRON no se habla de «la mayoría»');
});

test('confianza: el banco descartando por evaluación desfasada es un aviso; por calidad de datos, información', () => {
  const ciego = comprobarConfianza(estado({ banco7d: { total: 6, familias: [{ familia: 'evaluación anterior a las cuotas', tuberia: true, n: 5 }, { familia: 'calidad de datos', tuberia: false, n: 1 }] } }), AHORA);
  const a = buscar(ciego, /El banco descartó 5 de 6 partido/)!;
  assert.equal(a.nivel, 'aviso');
  assert.ok(a.accion!.some((l) => l.startsWith('npm run paper')));
  const prudente = comprobarConfianza(estado({ banco7d: { total: 6, familias: [{ familia: 'calidad de datos', tuberia: false, n: 6 }] } }), AHORA);
  assert.equal(buscar(prudente, /El banco descartó 6 partido/)?.nivel, 'info');
});

test('confianza: una deriva reciente se avisa y remite al informe del modelo', () => {
  const hs = comprobarConfianza(estado({ deriva7d: 'tennis: log loss 0.640 en vivo contra 0.610', alertas24h: { importante: 1, aviso: 2, info: 0 } }), AHORA);
  const d = buscar(hs, /Deriva reciente del modelo: tennis/)!;
  assert.equal(d.nivel, 'aviso');
  assert.deepEqual(d.accion, ['npm run model:report']);
  assert.ok(buscar(hs, /Alertas internas \(24 h\): 1 importante/));
});

// ---------------------------------------------------------------------------
// SEGURIDAD
// ---------------------------------------------------------------------------
const { comprobarSeguridad } = await import('./checks.ts');
const seguro = (over: Partial<Parameters<typeof comprobarSeguridad>[0]> = {}): Parameters<typeof comprobarSeguridad>[0] => ({
  produccion: true, modo: 'auto', authActiva: true, passwordLongitud: 24, totp: true, sesionesActivas: 2,
  cabeceras: true, errorLog: true, corsOrigenes: [], envIgnorado: true, hookInstalado: true,
  escaner: { ficheros: 600, hallazgos: [] }, gitleaks: false, errores24h: 0, ...over,
});

test('seguridad: todo en orden → ni avisos ni errores, y el doctor lo dice en positivo', () => {
  const hs = comprobarSeguridad(seguro());
  assert.deepEqual(niveles(hs).filter((n) => n === 'aviso' || n === 'error'), []);
  assert.ok(buscar(hs, /Contraseña activa .*con segundo factor TOTP .*2 sesión/));
  assert.ok(buscar(hs, /CORS cerrado/));
  assert.ok(buscar(hs, /sin secretos/));
  assert.ok(buscar(hs, /Hook de pre-commit activo/));
});

test('seguridad: contraseña corta en producción es error; auth apagada en producción, error; en local, solo informa', () => {
  assert.equal(buscar(comprobarSeguridad(seguro({ passwordLongitud: 5 })), /APP_PASSWORD tiene 5/)?.nivel, 'error');
  assert.equal(buscar(comprobarSeguridad(seguro({ authActiva: false, modo: 'off' })), /apagada en producción/)?.nivel, 'error');
  const local = comprobarSeguridad(seguro({ produccion: false, authActiva: false, modo: 'auto' }));
  assert.equal(buscar(local, /Sin contraseña/)?.nivel, 'info');
  assert.ok(!niveles(local).includes('error'));
});

test('seguridad: un secreto en ficheros rastreados o un .env sin ignorar son errores con qué hacer', () => {
  const sec = comprobarSeguridad(seguro({ escaner: { ficheros: 600, hallazgos: [{ fichero: 'server/src/x.ts', linea: 9, patron: 'The Odds API' }] } }));
  const e = buscar(sec, /1 posible\(s\) secreto/)!;
  assert.equal(e.nivel, 'error');
  assert.match(e.detalle![0], /server\/src\/x\.ts:9/);
  assert.match(e.accion![0], /ROTA la clave/);
  assert.equal(buscar(comprobarSeguridad(seguro({ envIgnorado: false })), /\.env NO está ignorado/)?.nivel, 'error');
  assert.equal(buscar(comprobarSeguridad(seguro({ hookInstalado: false })), /hook de pre-commit .*no está activado/)?.nivel, 'aviso');
  assert.equal(buscar(comprobarSeguridad(seguro({ errores24h: 3 })), /3 error\(es\) de servidor/)?.nivel, 'aviso');
});

// ---- ANALÍTICA E INTERFAZ (Fases 4 y 5) ----
const { comprobarAnalitica } = await import('./checks.ts');

test('comprobarAnalitica: deriva avisa; serie vieja avisa; sin datos solo informa; anulaciones y seguimiento se dicen', () => {
  const ahora = new Date('2026-10-07T10:00:00Z');
  const base = { monitorizacion: [], ultimaSerie: null, predichasConResultado: 0, simulacion: { ultimoDia: null, ligas: 0 }, calendarioPendiente: 0, fiabilidadBacktest: 0, anulaciones: [], seguidos: 0 };
  const vacio = comprobarAnalitica(base, ahora);
  assert.ok(vacio.every((x) => x.nivel === 'info' || x.nivel === 'ok'), 'sin estado no hay avisos');
  const deriva = comprobarAnalitica({ ...base, monitorizacion: [{ deporte: 'nfl', n: 150, deriva: true, motivos: ['PSI 0,31 > 0,25'] }] }, ahora);
  assert.ok(deriva.some((x) => x.nivel === 'aviso' && /Deriva en nfl: PSI/.test(x.texto)));
  const sinSerie = comprobarAnalitica({ ...base, predichasConResultado: 40 }, ahora);
  assert.ok(sinSerie.some((x) => x.nivel === 'aviso' && /nunca se ha guardado/.test(x.texto)));
  const vieja = comprobarAnalitica({ ...base, ultimaSerie: '2026-09-30', simulacion: { ultimoDia: '2026-09-30', ligas: 3 } }, ahora);
  assert.equal(vieja.filter((x) => x.nivel === 'aviso').length, 2, 'serie y simulación de hace una semana');
  const ui = comprobarAnalitica({ ...base, anulaciones: ['api.docs'], seguidos: 2, calendarioPendiente: 300, fiabilidadBacktest: 5 }, ahora);
  assert.ok(ui.some((x) => /api\.docs/.test(x.texto)));
  assert.ok(ui.some((x) => /Seguimiento: 2/.test(x.texto)));
  assert.ok(ui.some((x) => x.nivel === 'ok' && /300 partidos/.test(x.texto)));
});

// ---- PRODUCTO (Fase 6) ----
test('producto: laboratorio quieto con cuotas reales avisa; sin histórico es información', async () => {
  const { comprobarProducto } = await import('./checks.ts');
  const ahora = new Date('2026-10-07T12:00:00Z');
  const base = { estrategias: { activas: 2, archivadas: 1, apuestas: 0, pendientes: 0, ultimaApuesta: null, laboratorio: true }, historicos: [{ sport: 'nfl', partidos: 0, generado: null }], hayCuotasReales: true };
  const a = comprobarProducto(base, ahora);
  assert.equal(a.find((x) => x.texto.startsWith('Laboratorio'))?.nivel, 'aviso');
  assert.equal(a.find((x) => x.texto.includes('sin histórico'))?.nivel, 'info');
  const b = comprobarProducto({ ...base, estrategias: { ...base.estrategias, apuestas: 3, ultimaApuesta: '2026-10-06T10:00:00Z' }, historicos: [{ sport: 'nfl', partidos: 3780, generado: 'x' }] }, ahora);
  assert.equal(b.find((x) => x.texto.startsWith('Laboratorio'))?.nivel, 'ok');
  assert.match(b.find((x) => x.texto.includes('habría pasado'))!.texto, /nfl 3\.?780 partidos/);
  const c = comprobarProducto({ ...base, hayCuotasReales: false }, ahora);
  assert.equal(c.find((x) => x.texto.startsWith('Laboratorio'))?.nivel, 'ok', 'sin cuotas reales no se puede apostar: no es avería');
});
