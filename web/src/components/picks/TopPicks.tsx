// ⭐ Destacados: los partidos que vienen, de todos los deportes, ordenados por cuánto
// fiarse de la predicción y por la probabilidad del favorito. Para elegir qué partidos
// analizar o meter, con una selección propia que calcula qué pasa si se juntan.
//
// Lo que se enseña al lado de cada probabilidad es lo que hace falta para no engañarse:
//   · el nivel de confianza de la capa trust/ (y por qué),
//   · cuánto acertó el modelo en el backtest cuando dio una probabilidad parecida,
//   · la cuota real contra la cuota justa (1/p): sin eso, «más probable» se confunde con
//     «mejor apuesta», y un 85 % pagado a 1,10 pierde dinero.

import { useEffect, useMemo, useState } from 'react';
import { AWAY_COLOR, DRAW_COLOR, HOME_COLOR, PROFIT_COLOR, LOSS_COLOR, SPORT_THEMES, type SportId } from '../../lib/theme';
import { DeporteIcono, StarIcon, StatusMark, CrossIcon } from '../icons';
import { TeamCrest, EnlacePartido } from '../ui';
import { ConfianzaBadge } from '../trust/ConfianzaBadge';
import { EstrellaSeguir } from '../seguimiento';
import { useFiltrosQuery } from '../../lib/rutas';

interface Opcion {
  nombre: string;
  p: number;
  cuota: number | null;
}
interface Pick {
  deporte: string;
  sport: SportId;
  matchKey: string;
  eventoId: string;
  liga: string | null;
  cuando: string;
  partido: string;
  casa: string;
  fuera: string;
  casaId: string | null;
  fueraId: string | null;
  opciones: Opcion[];
  favorito: string;
  probabilidad: number;
  cuota: number | null;
  cuotaJusta: number;
  ventaja: number | null;
  casas: number | null;
  fiabilidad: string | null;
  confianza: {
    nivel: 'ALTA' | 'MEDIA' | 'BAJA';
    calidadDatos: number;
    estabilidad: string;
    desacuerdo: string;
    incertidumbrePp: number;
    decision: 'BET' | 'NO BET' | 'SIN MERCADO';
    motivo: string | null;
    evaluadaEn: string;
  } | null;
  historico: { franja: string; acierto: number; n: number } | null;
}
interface Combinada {
  patas: number;
  independiente: number;
  conjunta: number;
  factorCorrelacion: number;
  vinculos: { a: string; b: string; rho: number; motivo: string }[];
  incompatibles: string[];
  cuotaCombinada: number | null;
  cuotaJusta: number | null;
  ventaja: number | null;
  etiqueta: string;
}
interface Inteligencia {
  generado: string;
  ventanaHoras: number;
  eventos: number;
  steam: { eventId: string; partido: string; market: string; seleccion: string; desde: number; hasta: number; movimientoPp: number; minutos: number; casas: number }[];
  surebets: { eventId: string; partido: string; market: string; margenPct: number; patas: { seleccion: string; cuota: number; casa: string }[] }[];
  referencia: { eventId: string; partido: string; market: string; casa: string; selecciones: { seleccion: string; referencia: number; consenso: number; desviacionPp: number }[] }[];
  etiqueta: string;
}
interface Respuesta {
  horizontes: number[];
  horas: number;
  generado: string;
  partidos: Pick[];
  sinPrediccion: number;
  demo: number;
}

type Orden = 'confianza' | 'probabilidad' | 'ventaja' | 'hora';

const AMBAR = '#d9a441';
const RANGO: Record<string, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };

const pct = (x: number, d = 0) => `${(x * 100).toFixed(d).replace('.', ',')} %`;
const num = (x: number, d = 2) => x.toFixed(d).replace('.', ',');
const clave = (p: Pick) => `${p.sport}|${p.matchKey}`;
const CLAVE_SEL = 'predictor.picks.seleccion';
const CLAVE_HORAS = 'predictor.picks.horas';

function leer<T>(k: string, def: T): T {
  try {
    const v = localStorage.getItem(k);
    return v == null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
function guardar(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // No poder recordarlo no impide usarlo ahora.
  }
}

function Chip({ activo, onClick, children, title }: { activo: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={activo}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[13px] ring-1 transition ${
        activo ? 'bg-(--raised-2) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-soft) ring-(--line) hover:bg-(--raised)'
      }`}
    >
      {children}
    </button>
  );
}

/** La barra de probabilidad con los colores compartidos: local, empate, visitante. */
function Barra({ opciones, invertir = false }: { opciones: Opcion[]; invertir?: boolean }) {
  const colores = opciones.length === 3 ? [HOME_COLOR, DRAW_COLOR, AWAY_COLOR] : [HOME_COLOR, AWAY_COLOR];
  // En la NFL los nombres van «visitante @ local»: la barra sigue el mismo orden, para
  // que el tramo de la izquierda sea el equipo de arriba.
  const tramos = opciones.map((o, i) => ({ ...o, color: colores[i] }));
  if (invertir) tramos.reverse();
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-(--raised)" aria-hidden>
      {tramos.map((o) => (
        <span key={o.nombre} style={{ width: `${o.p * 100}%`, background: o.color, opacity: 0.85 }} />
      ))}
    </div>
  );
}

function Tarjeta({ p, puesto, elegido, onElegir }: { p: Pick; puesto: number; elegido: boolean; onElegir: () => void }) {
  const lados = [
    { nombre: p.casa, id: p.casaId, rol: 'local' },
    { nombre: p.fuera, id: p.fueraId, rol: 'visitante' },
  ];
  if (p.sport === 'nfl') lados.reverse();
  const fecha = new Date(p.cuando);
  const conValor = p.ventaja != null && p.ventaja > 0;
  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border p-4 transition ${
        elegido ? 'border-[#f5b544]/50 bg-[#f5b544]/[0.04]' : 'border-(--line) bg-(--tint)'
      }`}
    >
      {/* Cabecera: puesto, deporte, liga, hora y nivel de confianza */}
      <header className="flex items-center gap-2.5">
        <span className="w-6 shrink-0 text-center text-[13px] font-semibold tabular-nums text-(--ink-muted)">#{puesto}</span>
        <DeporteIcono nombre={p.sport} size={28} tile />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="break-words text-[13px] text-(--ink-body)">
            {SPORT_THEMES[p.sport].label}
            {p.liga && p.liga.toLowerCase() !== SPORT_THEMES[p.sport].label.toLowerCase() && <span className="text-(--ink-muted)"> · {p.liga.toUpperCase()}</span>}
          </div>
          <div className="text-[12px] capitalize text-(--ink-muted)">
            {fecha.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })} ·{' '}
            {fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <span className="shrink-0">
          <ConfianzaBadge nivel={p.confianza?.nivel ?? null} decision={p.confianza?.decision ?? null} motivo={p.confianza?.motivo} />
        </span>
      </header>

      {/* Equipos y probabilidad del favorito */}
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          {lados.map((l, i) => {
            const fav = l.nombre === p.favorito;
            return (
              <div key={i} className="flex min-w-0 items-center gap-2">
                <TeamCrest league={p.liga ?? ''} name={l.nombre} code={l.id} size={24} />
                <span className={`min-w-0 break-words text-[15px] leading-snug ${fav ? 'font-semibold text-(--ink-strong)' : 'text-(--ink-soft)'}`}>{l.nombre}</span>
                {p.sport === 'nfl' && i === 0 && <span className="-ml-1 text-[12px] text-(--ink-faint)">@</span>}
              </div>
            );
          })}
          {p.favorito === 'Empate' && <span className="text-[13px] font-semibold text-(--ink-strong)">Favorito: el empate</span>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[30px] font-semibold leading-none tabular-nums text-(--ink-strong)">{pct(p.probabilidad)}</div>
          <div className="mt-1 break-words text-[12px] text-(--ink-soft)" title={p.favorito}>
            gana {p.favorito === 'Empate' ? 'nadie (empate)' : p.favorito}
          </div>
        </div>
      </div>
      <Barra opciones={p.opciones} invertir={p.sport === 'nfl'} />

      {/* Lo que hace falta para no engañarse */}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-(--ink-muted)">Acierto histórico</dt>
          <dd className="text-(--ink-body)">
            {p.historico ? (
              <>
                <span className="font-semibold text-(--ink-strong)">{pct(p.historico.acierto)}</span> cuando dijo {p.historico.franja}{' '}
                <span className="text-(--ink-muted)">({p.historico.n.toLocaleString('es')} partidos)</span>
              </>
            ) : (
              <span className="text-(--ink-muted)">sin franja medida para esta probabilidad</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-(--ink-muted)">Cuota</dt>
          <dd className="text-(--ink-body)">
            {p.cuota ? (
              <>
                <span className="font-semibold text-(--ink-strong)">{num(p.cuota)}</span> · justa {num(p.cuotaJusta)} ·{' '}
                <span style={{ color: conValor ? PROFIT_COLOR : LOSS_COLOR }}>
                  {p.ventaja! >= 0 ? '+' : '−'}
                  {pct(Math.abs(p.ventaja!), 1)} {conValor ? 'de valor' : 'sin valor'}
                </span>
              </>
            ) : (
              <span className="text-(--ink-muted)">sin cuota real · justa {num(p.cuotaJusta)}</span>
            )}
          </dd>
        </div>
        {p.confianza && (
          <div className="sm:col-span-2">
            <dt className="text-[11px] uppercase tracking-wide text-(--ink-muted)">Por qué esa confianza</dt>
            <dd className="text-(--ink-soft)">
              datos {p.confianza.calidadDatos}/100 · estabilidad {p.confianza.estabilidad.toLowerCase()} · incertidumbre ±{num(p.confianza.incertidumbrePp, 1)} pp
              {p.confianza.desacuerdo !== 'SIN COMPONENTES' && ` · desacuerdo ${p.confianza.desacuerdo.toLowerCase()}`}
              {p.confianza.decision === 'BET' ? (
                <span className="block" style={{ color: PROFIT_COLOR }}>
                  <StatusMark estado="ok" color={PROFIT_COLOR} size={13} />
                  la capa de confianza lo apostaría
                </span>
              ) : p.confianza.motivo ? (
                <span className="block text-(--ink-muted)">
                  <StatusMark estado="aviso" color={AMBAR} size={13} />
                  no lo apostaría: {p.confianza.motivo}
                </span>
              ) : null}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex items-center justify-between gap-2">
        <EnlacePartido sport={p.sport} id={p.eventoId} clave={p.matchKey} />
        <EstrellaSeguir kind="partido" sport={p.sport} league={p.liga} refId={p.matchKey} label={p.partido} />
      </div>

      <button
        onClick={onElegir}
        aria-pressed={elegido}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition ${
          elegido ? 'bg-[#f5b544]/15 text-[#f5b544] hover:bg-[#f5b544]/20' : 'bg-(--raised) text-(--ink-body) hover:bg-(--raised-2)'
        }`}
      >
        <StarIcon size={15} filled={elegido} />
        {elegido ? 'En mi selección' : 'Añadir a mi selección'}
      </button>
    </article>
  );
}

/** Qué pasa si se juntan los elegidos: probabilidad de acertar todos, cuota combinada… */
/** La probabilidad conjunta con la correlación medida (POST /api/picks/parlay); si no responde, el producto. */
function useCombinada(elegidos: Pick[]): Combinada | null {
  const [c, setC] = useState<Combinada | null>(null);
  const firma = elegidos.map((p) => `${clave(p)}|${p.probabilidad}|${p.cuota ?? ''}`).join(';');
  useEffect(() => {
    if (elegidos.length === 0) {
      setC(null);
      return;
    }
    let vivo = true;
    const patas = elegidos.map((p) => ({
      sport: p.sport, matchKey: p.matchKey, liga: p.liga, cuando: p.cuando, seleccion: p.favorito,
      indice: p.opciones.findIndex((o) => o.nombre === p.favorito), resultados: p.opciones.length, p: p.probabilidad, cuota: p.cuota,
    }));
    fetch('/api/picks/parlay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patas }) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: Combinada) => vivo && setC(j))
      .catch(() => vivo && setC(null));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma]);
  return c;
}

function Seleccion({ elegidos, quitar, vaciar }: { elegidos: Pick[]; quitar: (p: Pick) => void; vaciar: () => void }) {
  const comb = useCombinada(elegidos);
  if (elegidos.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-(--ink-muted)">
        Marca partidos con <StarIcon size={13} className="inline align-[-2px]" /> para juntarlos aquí: verás la probabilidad de acertarlos todos y
        la cuota combinada.
      </p>
    );
  }
  const producto = elegidos.reduce((a, p) => a * p.probabilidad, 1);
  // Con el servidor: la conjunta descuenta la correlación medida; sin él, el producto.
  const todos = comb ? comb.conjunta : producto;
  const esperados = elegidos.reduce((a, p) => a + p.probabilidad, 0);
  const conCuota = elegidos.every((p) => p.cuota);
  const cuota = conCuota ? elegidos.reduce((a, p) => a * (p.cuota as number), 1) : null;
  const ventaja = cuota && todos > 0 ? todos * cuota - 1 : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-(--raised) p-2.5">
          <div className="text-[11px] uppercase tracking-wide text-(--ink-muted)">Acertar todos</div>
          <div className="text-[22px] font-semibold tabular-nums text-(--ink-strong)">{pct(todos, todos < 0.1 ? 1 : 0)}</div>
          {comb && comb.conjunta !== comb.independiente && comb.incompatibles.length === 0 && (
            <div className="text-[11px] text-(--ink-muted)">independientes: {pct(comb.independiente, comb.independiente < 0.1 ? 1 : 0)}</div>
          )}
        </div>
        <div className="rounded-lg bg-(--raised) p-2.5">
          <div className="text-[11px] uppercase tracking-wide text-(--ink-muted)">Aciertos esperados</div>
          <div className="text-[22px] font-semibold tabular-nums text-(--ink-strong)">
            {num(esperados, 1)} <span className="text-[13px] font-normal text-(--ink-muted)">de {elegidos.length}</span>
          </div>
        </div>
        <div className="col-span-2 rounded-lg bg-(--raised) p-2.5 text-[13px] text-(--ink-body)">
          {cuota ? (
            <>
              Cuota combinada <span className="font-semibold text-(--ink-strong)">{num(cuota)}</span> · justa {todos > 0 ? num(1 / todos) : '—'} ·{' '}
              <span style={{ color: (ventaja ?? 0) > 0 ? PROFIT_COLOR : LOSS_COLOR }}>
                {(ventaja ?? 0) >= 0 ? '+' : '−'}
                {pct(Math.abs(ventaja ?? 0), 1)}
              </span>
            </>
          ) : (
            <>Cuota justa combinada {todos > 0 ? num(1 / todos) : '—'} · alguno no tiene cuota real</>
          )}
        </div>
      </div>
      <ul className="divide-y divide-(--line) rounded-lg ring-1 ring-(--line)">
        {elegidos.map((p) => (
          <li key={clave(p)} className="flex items-center gap-2 px-2.5 py-2 text-[13px]">
            <DeporteIcono nombre={p.sport} size={15} />
            <span className="min-w-0 flex-1 break-words text-(--ink-body)" title={p.partido}>
              {p.favorito}
            </span>
            <span className="tabular-nums text-(--ink-strong)">{pct(p.probabilidad)}</span>
            <button onClick={() => quitar(p)} aria-label={`Quitar ${p.favorito}`} className="grid h-6 w-6 place-items-center rounded text-(--ink-muted) hover:bg-(--raised) hover:text-(--ink-strong)">
              <CrossIcon size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button onClick={vaciar} className="text-[12px] text-(--ink-muted) underline-offset-2 hover:text-(--ink-body) hover:underline">
        Vaciar selección
      </button>
      {comb && comb.incompatibles.length > 0 && (
        <p className="text-[12px] leading-relaxed" style={{ color: LOSS_COLOR }}>
          {comb.incompatibles.join('. ')}.
        </p>
      )}
      {comb && comb.vinculos.length > 0 && comb.incompatibles.length === 0 && (
        <p className="text-[11.5px] leading-relaxed text-(--ink-muted)">
          Correlación descontada en {comb.vinculos.length} par(es): {comb.vinculos.slice(0, 2).map((v) => `${v.a} / ${v.b} (ρ ${v.rho.toFixed(3).replace('.', ',')})`).join('; ')}
          {comb.vinculos.length > 2 ? '…' : ''}.
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-(--ink-muted)">
        {comb
          ? comb.etiqueta
          : '«Acertar todos» multiplica las probabilidades, como si los partidos fueran independientes.'}{' '}
        Son estimaciones del modelo: con cinco partidos al 75 %, acertarlos todos pasa menos de una de cada cuatro veces.
      </p>
    </div>
  );
}

/** Inteligencia de mercado (GET /api/odds/intel): steam moves, surebets y referencia afilada, como aproximación. */
function Mercado() {
  const [d, setD] = useState<Inteligencia | null | 'error'>(null);
  useEffect(() => {
    let vivo = true;
    fetch('/api/odds/intel')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: Inteligencia) => vivo && setD(j))
      .catch(() => vivo && setD('error'));
    return () => {
      vivo = false;
    };
  }, []);
  if (d === 'error') return null;
  return (
    <div className="mt-3 rounded-xl border border-(--line) p-4 text-[12px] leading-relaxed text-(--ink-muted)">
      <p className="mb-1.5 font-medium text-(--ink-soft)">Mercado (aproximación)</p>
      {!d && <p>Leyendo los precios observados…</p>}
      {d && d.eventos === 0 && <p>Sin cuotas observadas en las últimas {d.ventanaHoras} h: no hay nada que leer del mercado.</p>}
      {d && d.eventos > 0 && (
        <>
          <p>
            {d.eventos} mercado(s) con precio · {d.steam.length} movimiento(s) rápido(s) · {d.surebets.length} surebet(s) · {d.referencia.length} con referencia afilada
          </p>
          {d.steam.slice(0, 4).map((s) => (
            <p key={`${s.eventId}|${s.market}|${s.seleccion}`}>
              <StatusMark estado="aviso" color={AMBAR} />{s.partido}: {s.seleccion} {num(s.desde)} → {num(s.hasta)} en {s.minutos} min ({s.casas} casas,{' '}
              {s.movimientoPp > 0 ? '+' : '−'}{Math.abs(s.movimientoPp).toFixed(1).replace('.', ',')} pp)
            </p>
          ))}
          {d.surebets.slice(0, 3).map((s) => (
            <p key={`${s.eventId}|${s.market}`}>
              <StatusMark estado="ok" color={PROFIT_COLOR} />{s.partido}: surebet {s.margenPct.toFixed(1).replace('.', ',')} % ({s.patas.map((p) => `${p.seleccion} ${num(p.cuota)} en ${p.casa}`).join(', ')})
            </p>
          ))}
          {d.referencia.slice(0, 3).map((r) => (
            <p key={`${r.eventId}|${r.market}`}>
              {r.partido} frente a {r.casa}: {r.selecciones.map((s) => `${s.seleccion} ${s.desviacionPp > 0 ? '+' : '−'}${Math.abs(s.desviacionPp).toFixed(1).replace('.', ',')} pp`).join(' · ')}
            </p>
          ))}
          <p className="mt-1 text-(--ink-faint)">{d.etiqueta}</p>
        </>
      )}
    </div>
  );
}

export default function TopPicks() {
  // Los filtros viven en la URL (Fase 5.2): el enlace copiado abre la misma lista.
  const [q, setQ] = useFiltrosQuery();
  const horas = Number(q.get('horas')) || leer(CLAVE_HORAS, 48);
  const orden = (q.get('orden') as Orden | null) ?? 'confianza';
  const deportes = (q.get('deportes')?.split(',').filter(Boolean) ?? []) as SportId[];
  const minP = Number(q.get('min')) || 0;
  const soloAlta = q.get('alta') === '1';
  const soloCuota = q.get('cuota') === '1';
  const setOrden = (o: Orden) => setQ({ orden: o === 'confianza' ? null : o });
  const setDeportes = (d: SportId[]) => setQ({ deportes: d.length ? d.join(',') : null });
  const setMinP = (m: number) => setQ({ min: m ? String(m) : null });
  const setSoloAlta = (b: boolean) => setQ({ alta: b ? '1' : null });
  const setSoloCuota = (b: boolean) => setQ({ cuota: b ? '1' : null });
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [sel, setSel] = useState<string[]>(() => leer<string[]>(CLAVE_SEL, []));

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetch(`/api/top-picks?horas=${horas}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Respuesta) => {
        if (!vivo) return;
        setDatos(j);
        setError(false);
      })
      .catch(() => vivo && setError(true))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [horas]);

  const setHoras = (h: number) => {
    guardar(CLAVE_HORAS, h);
    setQ({ horas: String(h) });
  };
  const alternar = (p: Pick) => {
    const k = clave(p);
    const nueva = sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k];
    setSel(nueva);
    guardar(CLAVE_SEL, nueva);
  };

  const lista = useMemo(() => {
    const xs = (datos?.partidos ?? []).filter(
      (p) =>
        (deportes.length === 0 || deportes.includes(p.sport)) &&
        p.probabilidad >= minP &&
        (!soloAlta || p.confianza?.nivel === 'ALTA') &&
        (!soloCuota || p.cuota != null),
    );
    const r = (p: Pick) => (p.confianza ? RANGO[p.confianza.nivel] : 3);
    const cmp: Record<Orden, (a: Pick, b: Pick) => number> = {
      confianza: (a, b) => r(a) - r(b) || b.probabilidad - a.probabilidad,
      probabilidad: (a, b) => b.probabilidad - a.probabilidad,
      ventaja: (a, b) => (b.ventaja ?? -9) - (a.ventaja ?? -9) || b.probabilidad - a.probabilidad,
      hora: (a, b) => a.cuando.localeCompare(b.cuando),
    };
    return [...xs].sort(cmp[orden]);
  }, [datos, deportes, minP, soloAlta, soloCuota, orden]);

  const presentes = useMemo(() => [...new Set((datos?.partidos ?? []).map((p) => p.sport))], [datos]);
  const elegidos = (datos?.partidos ?? []).filter((p) => sel.includes(clave(p)));
  const vaciar = () => {
    setSel([]);
    guardar(CLAVE_SEL, []);
  };

  return (
    <div>
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ color: '#f5b544', backgroundColor: 'rgba(245,181,68,0.12)' }}>
          <StarIcon size={22} />
        </span>
        <div>
          <h2 className="text-[20px] font-semibold leading-tight text-(--ink-strong)">Destacados</h2>
          <p className="text-[13.5px] leading-snug text-(--ink-soft)">
            Los partidos que vienen, de todos los deportes, ordenados por confianza y probabilidad del favorito.
          </p>
        </div>
      </header>

      {/* Controles */}
      <div className="mb-4 space-y-2.5 rounded-xl border border-(--line) bg-(--tint) p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] uppercase tracking-wide text-(--ink-muted)">Próximas</span>
          {(datos?.horizontes ?? [24, 48, 168]).map((h) => (
            <Chip key={h} activo={horas === h} onClick={() => setHoras(h)}>
              {h === 168 ? '7 días' : `${h} h`}
            </Chip>
          ))}
          <span className="ml-2 mr-1 text-[12px] uppercase tracking-wide text-(--ink-muted)">Ordenar</span>
          {(
            [
              ['confianza', 'Confianza + probabilidad'],
              ['probabilidad', 'Probabilidad'],
              ['ventaja', 'Valor (vs cuota)'],
              ['hora', 'Hora'],
            ] as [Orden, string][]
          ).map(([o, t]) => (
            <Chip key={o} activo={orden === o} onClick={() => setOrden(o)}>
              {t}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {presentes.map((s) => (
            <Chip key={s} activo={deportes.includes(s)} onClick={() => setDeportes(deportes.includes(s) ? deportes.filter((x) => x !== s) : [...deportes, s])}>
              <DeporteIcono nombre={s} size={15} />
              {SPORT_THEMES[s].label}
            </Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-(--raised-2)" aria-hidden />
          {[0, 0.6, 0.7, 0.8].map((m) => (
            <Chip key={m} activo={minP === m} onClick={() => setMinP(m)}>
              {m === 0 ? 'Cualquier %' : `≥ ${m * 100} %`}
            </Chip>
          ))}
          <Chip activo={soloAlta} onClick={() => setSoloAlta(!soloAlta)}>
            Solo confianza alta
          </Chip>
          <Chip activo={soloCuota} onClick={() => setSoloCuota(!soloCuota)}>
            Solo con cuota real
          </Chip>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className={cargando ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {error && !datos && <p className="text-[14px] text-(--ink-soft)">No se pudo cargar la lista.</p>}
          {!datos && !error && <p className="text-[14px] text-(--ink-soft)">Cargando partidos…</p>}
          {datos && lista.length === 0 && (
            <div className="rounded-xl border border-(--line) bg-(--tint) p-5 text-[14px] leading-relaxed text-(--ink-soft)">
              {datos.partidos.length === 0 ? (
                <>
                  No hay partidos reales con predicción en las próximas {horas === 168 ? '7 días' : `${horas} h`}.
                  {datos.sinPrediccion > 0 && ` Hay ${datos.sinPrediccion} sin predicción todavía: el servidor los predice cada 15 minutos.`}
                  {datos.demo > 0 && ` Los ${datos.demo} partidos de demostración no entran: no son partidos reales.`}
                </>
              ) : (
                'Ningún partido cumple estos filtros.'
              )}
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {lista.map((p, i) => (
              <Tarjeta key={clave(p)} p={p} puesto={i + 1} elegido={sel.includes(clave(p))} onElegir={() => alternar(p)} />
            ))}
          </div>
          {datos && (datos.sinPrediccion > 0 || datos.demo > 0) && lista.length > 0 && (
            <p className="mt-3 text-[12px] text-(--ink-muted)">
              {datos.sinPrediccion > 0 && `${datos.sinPrediccion} partido(s) aún sin predicción registrada. `}
              {datos.demo > 0 && `${datos.demo} de demostración no se incluyen.`}
            </p>
          )}
        </div>

        <aside id="mi-seleccion" className="scroll-mt-24 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-(--line) bg-(--tint) p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-(--ink-strong)">
              <span style={{ color: '#f5b544' }}>
                <StarIcon size={17} filled />
              </span>
              Mi selección
              {elegidos.length > 0 && <span className="text-[13px] font-normal text-(--ink-muted)">· {elegidos.length}</span>}
            </h3>
            <Seleccion elegidos={elegidos} quitar={alternar} vaciar={vaciar} />
          </div>
          <div className="mt-3 rounded-xl border border-(--line) p-4 text-[12px] leading-relaxed text-(--ink-muted)">
            <p className="mb-1.5 font-medium text-(--ink-soft)">Cómo leer la lista</p>
            <p>
              El orden pone primero la <strong className="font-medium text-(--ink-soft)">confianza</strong> (datos completos, predicción estable,
              componentes de acuerdo) y después la <strong className="font-medium text-(--ink-soft)">probabilidad</strong>.{' '}
              <strong className="font-medium text-(--ink-soft)">Acierto histórico</strong> es lo que acertó el modelo en el backtest cuando dio una
              probabilidad de esa franja. Más probable no es mejor apuesta: si la cuota ofrecida está por debajo de la{' '}
              <strong className="font-medium text-(--ink-soft)">justa</strong> (1/p), a la larga pierde aunque gane a menudo. Es una estimación
              estadística, no una recomendación.
            </p>
          </div>
          <Mercado />
        </aside>
      </div>

      {/* En el móvil el panel queda debajo de toda la lista: una barra fija con el
          resumen, y un toque lleva hasta él. */}
      {elegidos.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-(--line) bg-(--surface-card)/95 px-4 pb-3 pt-3 backdrop-blur lg:hidden">
          <a href="#mi-seleccion" className="flex items-center justify-between gap-3 text-[14px]">
            <span className="flex items-center gap-2 text-(--ink-strong)">
              <span style={{ color: '#f5b544' }}>
                <StarIcon size={17} filled />
              </span>
              {elegidos.length} en mi selección
            </span>
            <span className="text-(--ink-soft)">
              acertar todos <span className="font-semibold text-(--ink-strong)">{pct(elegidos.reduce((a, p) => a * p.probabilidad, 1))}</span> ›
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
