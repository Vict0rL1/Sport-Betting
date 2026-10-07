// «¿Acertó?»: los partidos de los últimos días, qué dijo el modelo y qué pasó.
//
// Dos orígenes, siempre distinguibles: lo que la app registró ANTES del partido («en
// vivo», la prueba de verdad) y lo reconstruido con el modelo del backtest para todos los
// demás partidos jugados del archivo, con solo los datos anteriores a cada uno. Sin lo
// segundo la vista enseñaba 19 partidos sueltos; con lo segundo sin marcar, mezclaría
// una prueba con otra. Por eso: los dos, cada uno con su etiqueta y su recuento.
//
// Y todos los días de la ventana, también los vacíos. Un día sin partidos casi nunca es
// «no hubo partidos»: es un archivo de resultados sin actualizar, y abajo se dice cuál y
// con qué comando se arregla.

import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS } from '../lib/theme';
import { DeporteIcono, Verdict } from './icons';

export { DeporteIcono };
import { TeamCrest } from './ui';

type Origen = 'en vivo' | 'reconstruida';

interface Resultado {
  deporte: string;
  liga: string | null;
  dia: string;
  cuando: string | null;
  partido: string;
  casa: string;
  fuera: string;
  casaId: string | null;
  fueraId: string | null;
  favorito: string;
  probabilidad: number;
  ganador: string;
  acerto: boolean;
  origen: Origen;
}

export interface Resumen {
  total: number;
  aciertos: number;
  tasa: number | null;
  esperado: number | null;
  tasaEsperada: number | null;
  rangoNormal: [number, number] | null;
}

interface Archivo {
  deporte: string;
  hasta: string | null;
  sinResultado: number;
  comando: string;
  reconstruye: boolean;
}

export interface Historial {
  ventanas: number[];
  dias: number;
  resultados: Resultado[];
  resumen: Resumen;
  porOrigen: Record<Origen, Resumen>;
  porDeporte: Record<string, Resumen>;
  porDia: (Resumen & { dia: string })[];
  archivo: Archivo[];
  sinHistoria: number;
}


const CLAVE_VENTANA = 'predictor.results.window';

/** 'YYYY-MM-DD' → fecha LOCAL (new Date('2026-10-05') sería medianoche UTC). */
const fechaDe = (dia: string) => new Date(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)));
const pctTxt = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`);

function veredicto(r: Resumen): { texto: string; color: string } | null {
  if (!r.rangoNormal || r.esperado == null) return null;
  const [lo, hi] = r.rangoNormal;
  if (r.aciertos < lo) return { texto: 'por debajo de lo normal: merece mirarse', color: STATUS.critical };
  if (r.aciertos > hi) return { texto: 'por encima: buena racha, no un modelo mejor', color: STATUS.good };
  return { texto: 'dentro de lo esperado', color: 'var(--ink-soft)' };
}

/** Lo que va en la cabecera plegable del panel. */
export function lineaResumen(h: Historial | null): string {
  if (!h) return 'cargando…';
  const r = h.resumen;
  if (r.total === 0) return `sin resultados en los últimos ${h.dias} días`;
  return `${r.aciertos} de ${r.total} en ${h.dias} días · ${pctTxt(r.tasa)}` + (r.tasaEsperada != null ? ` · esperaba ${pctTxt(r.tasaEsperada)}` : '');
}

export function useHistorial(): { h: Historial | null; cargando: boolean; error: boolean; dias: number; setDias: (d: number) => void } {
  const [dias, setDiasState] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(CLAVE_VENTANA));
      return [7, 14, 30].includes(v) ? v : 7;
    } catch {
      return 7;
    }
  });
  const [h, setH] = useState<Historial | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    fetch(`/api/recent-results?dias=${dias}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Historial) => {
        if (!vivo) return;
        setH(j);
        setError(false);
      })
      .catch(() => vivo && setError(true))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [dias]);
  const setDias = (d: number) => {
    setDiasState(d);
    try {
      localStorage.setItem(CLAVE_VENTANA, String(d));
    } catch {
      // No poder recordarlo no impide aplicarlo ahora.
    }
  };
  return { h, cargando, error, dias, setDias };
}

function Chip({ activo, onClick, children, title }: { activo: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={activo}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-[13px] ring-1 transition ${
        activo ? 'bg-(--raised-2) text-(--ink-strong) ring-(--line-strong)' : 'text-(--ink-soft) ring-(--line) hover:bg-(--raised)'
      }`}
    >
      {children}
    </button>
  );
}

/** Barra apilada por día: verde los aciertos, rojo los fallos; altura según partidos. */
function FranjaDias({ porDia, max, diaSel, onDia }: { porDia: Historial['porDia']; max: number; diaSel: string | null; onDia: (d: string | null) => void }) {
  const dias = [...porDia].reverse(); // del más antiguo al de hoy, de izquierda a derecha
  // Hoy está a la derecha. Si no cabe todo (30 días en un móvil), se arranca enseñando
  // el final: lo reciente es lo que se viene a mirar.
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (caja.current) caja.current.scrollLeft = caja.current.scrollWidth;
  }, [porDia.length]);
  return (
    <div ref={caja} className="overflow-x-auto px-3 pb-1">
      <div className="flex items-end gap-1" role="list" aria-label="Aciertos por día">
        {dias.map((d) => {
          const f = fechaDe(d.dia);
          const alto = d.total === 0 ? 0 : Math.max(8, Math.round((d.total / Math.max(max, 1)) * 56));
          const okAlto = d.total === 0 ? 0 : Math.round((d.aciertos / d.total) * alto);
          const sel = diaSel === d.dia;
          return (
            // El elemento de la lista es el contenedor y el botón va dentro: un botón no puede ser
            // un «listitem» (axe, Fase 7.9).
            <div key={d.dia} role="listitem" className="flex min-w-[1.75rem] flex-1">
            <button
              onClick={() => onDia(sel ? null : d.dia)}
              disabled={d.total === 0}
              title={d.total === 0 ? `${f.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })}: sin resultados` : `${d.aciertos} de ${d.total} acertados`}
              className={`flex w-full flex-col items-center gap-1 rounded-md py-1 transition ${sel ? 'bg-(--raised-2)' : d.total ? 'hover:bg-(--raised)' : 'cursor-default'}`}
            >
              <span className="whitespace-nowrap text-[10.5px] tabular-nums text-(--ink-soft)">{d.total ? `${d.aciertos}/${d.total}` : '—'}</span>
              <span className="flex h-14 w-3.5 flex-col justify-end overflow-hidden rounded-sm bg-(--raised)">
                <span style={{ height: alto - okAlto, background: STATUS.critical, opacity: 0.75 }} />
                <span style={{ height: okAlto, background: STATUS.good }} />
              </span>
              <span className="text-[11px] leading-tight text-(--ink-muted)">
                {f.toLocaleDateString('es', { weekday: 'narrow' })}
                <br />
                <span className={sel ? 'text-(--ink-strong)' : ''}>{f.getDate()}</span>
              </span>
            </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Fila({ r }: { r: Resultado }) {
  // En la NFL se escribe «visitante @ local»; en los demás, el local primero.
  const lados = [
    { nombre: r.casa, id: r.casaId },
    { nombre: r.fuera, id: r.fueraId },
  ];
  if (r.deporte === 'NFL') lados.reverse();
  const empate = r.ganador === 'Empate';
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span title={r.deporte} className="mt-0.5">
        <DeporteIcono nombre={r.deporte} size={30} tile />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-1">
          {lados.map((l, i) => {
            const gano = l.nombre === r.ganador;
            return (
              <div key={i} className="flex min-w-0 items-center gap-2">
                <TeamCrest league={r.liga ?? ''} name={l.nombre} code={l.id} size={24} />
                <span className={`min-w-0 break-words text-[14px] leading-snug ${gano ? 'font-medium text-(--ink-strong)' : 'text-(--ink-soft)'}`}>{l.nombre}</span>
                {r.deporte === 'NFL' && i === 0 && <span className="-ml-1 text-[12px] text-(--ink-faint)">@</span>}
                {gano && <span className="shrink-0 rounded bg-(--raised) px-1.5 py-px text-[10.5px] uppercase tracking-wide text-(--ink-soft)">ganó</span>}
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-(--ink-soft)">
          <span>
            el modelo dijo <span className="text-(--ink-body)">{r.favorito}</span>{' '}
            <span className="font-semibold tabular-nums text-(--ink-strong)">{Math.round(r.probabilidad * 100)} %</span>
          </span>
          {empate && <span className="text-(--ink-body)">· acabó en empate</span>}
          {r.origen === 'reconstruida' && (
            <span
              className="rounded px-1.5 py-px text-[11px] text-(--ink-soft) ring-1 ring-(--line)"
              title="No se registró antes del partido: es la predicción del modelo del backtest, con solo los datos anteriores al partido."
            >
              reconstruida
            </span>
          )}
          {r.origen === 'en vivo' && (
            <span className="rounded px-1.5 py-px text-[11px]" style={{ color: STATUS.good, background: 'rgba(25,158,112,0.1)' }}>
              en vivo{r.cuando ? ` · ${new Date(r.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          )}
        </div>
      </div>
      {/* El veredicto lleva palabra y símbolo, nunca solo color. */}
      <span className="mt-0.5 shrink-0">
        <Verdict ok={r.acerto} />
      </span>
    </li>
  );
}

export default function RecentResults({ estado }: { estado: ReturnType<typeof useHistorial> }) {
  const { h, cargando, error, dias, setDias } = estado;
  const [deporte, setDeporte] = useState<string | null>(null);
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [diaSel, setDiaSel] = useState<string | null>(null);

  // Cambiar de ventana deja sin sentido un día elegido fuera de ella.
  useEffect(() => setDiaSel(null), [dias]);

  const filtrados = useMemo(
    () =>
      (h?.resultados ?? []).filter(
        (r) => (!deporte || r.deporte === deporte) && (!origen || r.origen === origen) && (!diaSel || r.dia === diaSel),
      ),
    [h, deporte, origen, diaSel],
  );
  const porDia = useMemo(() => {
    const m = new Map<string, Resultado[]>();
    for (const r of filtrados) m.set(r.dia, [...(m.get(r.dia) ?? []), r]);
    return [...m.entries()];
  }, [filtrados]);

  if (error && !h) return <p className="px-4 py-3 text-[13px] text-(--ink-soft)">No se pudieron leer los resultados recientes.</p>;
  if (!h) return <p className="px-4 py-3 text-[13px] text-(--ink-soft)">Calculando los resultados de los últimos {dias} días…</p>;

  const r = h.resumen;
  const v = veredicto(r);
  const maxDia = Math.max(...h.porDia.map((d) => d.total), 1);
  // Primero lo seguro (partidos que la app vio jugarse y siguen sin resultado), después
  // los archivos que llevan días sin datos nuevos (que fuera de temporada es normal).
  const avisos = h.archivo
    .filter((a) => a.sinResultado > 0 || !a.hasta || Date.now() - fechaDe(a.hasta).getTime() > 2 * 86_400_000)
    .sort((a, b) => b.sinResultado - a.sinResultado);

  return (
    <div className={cargando ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      {/* Ventana */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        <span className="mr-1 text-[12px] uppercase tracking-wide text-(--ink-muted)">Periodo</span>
        {h.ventanas.map((d) => (
          <Chip key={d} activo={dias === d} onClick={() => setDias(d)}>
            {d} días
          </Chip>
        ))}
        {cargando && <span className="text-[12px] text-(--ink-muted)">actualizando…</span>}
      </div>

      {/* Resumen */}
      <div className="mx-4 mt-3 grid grid-cols-1 gap-3 rounded-lg bg-(--tint) p-3 ring-1 ring-(--line) sm:grid-cols-[auto_1fr]">
        <div className="flex items-baseline gap-2 sm:flex-col sm:items-start sm:gap-0 sm:pr-4">
          <span className="text-[28px] font-semibold leading-none tabular-nums text-(--ink-strong)">{pctTxt(r.tasa)}</span>
          <span className="text-[13px] text-(--ink-soft)">
            {r.aciertos} de {r.total} acertados
          </span>
        </div>
        <div className="text-[13px] leading-relaxed text-(--ink-soft)">
          {r.total === 0 ? (
            <>Ningún partido con resultado en estos {h.dias} días. Abajo, por qué.</>
          ) : (
            <>
              El modelo esperaba acertar <span className="text-(--ink-strong)">{pctTxt(r.tasaEsperada)}</span> (unos{' '}
              {(r.esperado ?? 0).toFixed(1).replace('.', ',')}). Por puro azar, entre {r.rangoNormal?.[0]} y {r.rangoNormal?.[1]} aciertos es
              lo normal con {r.total} partidos: {r.aciertos} está{' '}
              <span style={{ color: v?.color }}>{v?.texto}</span>.
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip activo={origen === null} onClick={() => setOrigen(null)}>
              Todos · {r.total}
            </Chip>
            <Chip
              activo={origen === 'en vivo'}
              onClick={() => setOrigen(origen === 'en vivo' ? null : 'en vivo')}
              title="Registrados antes del partido: la prueba de verdad."
            >
              En vivo · {h.porOrigen['en vivo'].aciertos}/{h.porOrigen['en vivo'].total}
            </Chip>
            <Chip
              activo={origen === 'reconstruida'}
              onClick={() => setOrigen(origen === 'reconstruida' ? null : 'reconstruida')}
              title="El modelo del backtest, con solo los datos anteriores a cada partido."
            >
              Reconstruidos · {h.porOrigen.reconstruida.aciertos}/{h.porOrigen.reconstruida.total}
            </Chip>
          </div>
        </div>
      </div>

      {/* Por día */}
      <div className="mt-3">
        <FranjaDias porDia={h.porDia} max={maxDia} diaSel={diaSel} onDia={setDiaSel} />
      </div>

      {/* Por deporte */}
      {Object.keys(h.porDeporte).length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-1 pt-2">
          <Chip activo={deporte === null} onClick={() => setDeporte(null)}>
            Todos los deportes
          </Chip>
          {Object.entries(h.porDeporte).map(([d, s]) => (
            <Chip key={d} activo={deporte === d} onClick={() => setDeporte(deporte === d ? null : d)}>
              <DeporteIcono nombre={d} size={15} /> {s.aciertos}/{s.total} · {pctTxt(s.tasa)}
            </Chip>
          ))}
        </div>
      )}

      {/* La lista, por día */}
      <div className="mt-2 max-h-[26rem] overflow-y-auto border-t border-(--line)">
        {porDia.length === 0 && (
          <p className="px-4 py-4 text-[13px] text-(--ink-muted)">{h.resultados.length ? 'Ningún partido con estos filtros.' : 'Sin partidos resueltos en esta ventana.'}</p>
        )}
        {porDia.map(([dia, xs]) => {
          const ok = xs.filter((x) => x.acerto).length;
          return (
            <section key={dia} className="seccion-dia">
              <h4 className="sticky top-0 z-10 flex items-baseline justify-between border-b border-(--line) bg-(--surface-card)/95 px-4 py-1.5 text-[12.5px] backdrop-blur">
                <span className="font-medium capitalize text-(--ink-body)">
                  {fechaDe(dia).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })}
                </span>
                <span className="tabular-nums text-(--ink-soft)">
                  {ok} de {xs.length}
                </span>
              </h4>
              <ul className="divide-y divide-(--line)">
                {xs.map((x, i) => (
                  <Fila key={`${x.partido}|${i}`} r={x} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* Por qué faltan días */}
      {avisos.length > 0 && (
        <div className="border-t border-(--line) px-4 py-3">
          <p className="mb-1 text-[12px] uppercase tracking-wide text-(--ink-muted)">Resultados que faltan</p>
          <p className="mb-2 text-[12.5px] text-(--ink-soft)">
            Un día vacío casi nunca es que no hubo partidos: es el archivo sin actualizar. Todos de una vez, sin gastar créditos de cuotas:{' '}
            <code className="rounded bg-(--raised-2) px-1.5 py-px text-[12px] text-(--ink-strong)">npm run update-results</code>
          </p>
          <ul className="space-y-1.5 text-[12.5px] text-(--ink-soft)">
            {avisos.map((a) => (
              <li key={a.deporte} className="flex flex-wrap items-baseline gap-x-2">
                <span>
                  <DeporteIcono nombre={a.deporte} size={15} /> {a.deporte}:{' '}
                  {a.hasta ? `resultados guardados hasta el ${fechaDe(a.hasta).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'sin resultados guardados'}
                  {a.sinResultado > 0 && <span style={{ color: STATUS.warning }}> · {a.sinResultado} jugado(s) esperan resultado</span>}
                  {!a.reconstruye && ' · el archivo solo trae la fecha del torneo: no se reconstruye'}
                </span>
                <code className="rounded bg-(--raised) px-1.5 py-px text-[12px] text-(--ink-body)">{a.comando}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-(--line) px-4 py-2.5 text-[12px] leading-relaxed text-(--ink-muted)">
        <strong className="font-medium text-(--ink-soft)">En vivo</strong> es lo que la app registró antes de cada partido.{' '}
        <strong className="font-medium text-(--ink-soft)">Reconstruidos</strong> son el resto de partidos jugados del archivo, con la predicción
        del modelo del backtest calculada solo con datos anteriores a cada uno: no llevan la mezcla con el mercado ni las alineaciones del
        día, y no se usan para ajustar el modelo.
        {h.sinHistoria > 0 && ` ${h.sinHistoria} partido(s) no se reconstruyen porque algún equipo tenía muy poca historia.`} Para juzgar al
        modelo, el historial de cada pestaña (miles de partidos) pesa más que una semana.
      </p>
    </div>
  );
}
