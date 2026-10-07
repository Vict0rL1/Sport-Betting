// La píldora de estado global (Fase 5.4): modo de cuotas, frescura de datos por deporte,
// última actualización de resultados y cuota restante. Una por app, no un aviso por pestaña:
// la misma información repetida cinco veces parecía cinco problemas distintos.

import { useEffect, useState } from 'react';
import { STATUS } from '../../lib/theme';
import { StatusMark } from '../icons';

interface Estado {
  generado: string;
  cuotas: { modo: 'real' | 'demo'; clave: boolean; restantes: number | null; plan: number | null; ultimaConsulta: string | null; error: string | null };
  deportes: { sport: string; datosHasta: string | null; proximos: number; ultimaCuota: string | null }[];
  resultados: { ultima: string | null; estado: string | null };
  copia: { ultima: string | null };
  errores24h: number;
  trabajosConError: number;
}

const NOMBRE: Record<string, string> = { tennis: 'Tenis', football: 'Fútbol', basketball: 'Baloncesto', baseball: 'Béisbol', nfl: 'NFL' };

function hace(iso: string | null): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min)) return 'desconocido';
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const d = (Date.now() - Date.parse(iso)) / 86_400_000;
  return Number.isFinite(d) ? Math.floor(d) : null;
}

export function useEstadoGlobal(): Estado | null {
  const [e, setE] = useState<Estado | null>(null);
  useEffect(() => {
    let vivo = true;
    const leer = () =>
      fetch('/api/estado')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: Estado) => vivo && setE(j))
        .catch(() => undefined);
    void leer();
    const t = setInterval(leer, 5 * 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);
  return e;
}

/** El resumen de una palabra y su color: lo peor que haya manda. */
export function resumenEstado(e: Estado): { texto: string; color: string; nivel: 'ok' | 'aviso' | 'error' } {
  const viejo = e.deportes.some((d) => (diasDesde(d.datosHasta) ?? 0) > 7 && d.proximos > 0);
  if (e.trabajosConError > 0 || e.cuotas.error) return { texto: e.cuotas.modo === 'demo' ? 'Demo · con errores' : 'Con errores', color: STATUS.critical, nivel: 'error' };
  if (e.cuotas.modo === 'demo') return { texto: 'Modo demo', color: STATUS.warning, nivel: 'aviso' };
  if (viejo || (e.cuotas.restantes != null && e.cuotas.restantes < 50)) return { texto: 'Cuotas reales · atención', color: STATUS.warning, nivel: 'aviso' };
  return { texto: 'Cuotas reales', color: STATUS.good, nivel: 'ok' };
}

export default function StatusPill({ compacto = false }: { compacto?: boolean }) {
  const e = useEstadoGlobal();
  const [abierto, setAbierto] = useState(false);
  if (!e) return null;
  const r = resumenEstado(e);
  return (
    <div className="relative">
      <button
        onClick={() => setAbierto((o) => !o)}
        aria-expanded={abierto}
        aria-label={`Estado: ${r.texto}`}
        data-testid="status-pill"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium text-(--ink-body) transition hover:bg-(--raised)"
        style={{ borderColor: `${r.color}66` }}
      >
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
        <span className={compacto ? 'sr-only sm:not-sr-only' : ''}>{r.texto}</span>
        {!compacto && e.cuotas.restantes != null && <span className="text-(--ink-muted)">· {e.cuotas.restantes} peticiones</span>}
      </button>
      {abierto && (
        <div role="dialog" aria-label="Estado de la app" className="absolute left-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-(--line) bg-(--surface-card) p-3 text-[12px] leading-relaxed text-(--ink-soft) shadow-xl">
          <p className="mb-1 font-semibold text-(--ink-strong)">
            <StatusMark estado={r.nivel === 'ok' ? 'ok' : r.nivel === 'aviso' ? 'aviso' : 'error'} color={r.color} />
            {r.texto}
          </p>
          <p>
            {e.cuotas.modo === 'demo'
              ? 'Sin clave de The Odds API: las cuotas son de demostración (la probabilidad del modelo con un margen) y ninguna apuesta de papel se coloca sobre ellas.'
              : `Cuotas reales de The Odds API${e.cuotas.restantes != null ? ` · ${e.cuotas.restantes}${e.cuotas.plan ? ` de ${e.cuotas.plan.toLocaleString('es')}` : ''} peticiones restantes este mes` : ''}${e.cuotas.ultimaConsulta ? ` · consultadas ${hace(e.cuotas.ultimaConsulta)}` : ''}.`}
            {e.cuotas.error && <span style={{ color: STATUS.critical }}> {e.cuotas.error}</span>}
          </p>
          <ul className="mt-2 space-y-0.5">
            {e.deportes.map((d) => {
              const dias = diasDesde(d.datosHasta);
              return (
                <li key={d.sport} className="flex justify-between gap-2">
                  <span className="text-(--ink-body)">{NOMBRE[d.sport] ?? d.sport}</span>
                  <span className="text-right">
                    {d.datosHasta ? `datos hasta ${new Date(d.datosHasta).toLocaleDateString('es')}${dias != null && dias > 7 ? ` (${dias} días)` : ''}` : 'sin archivo'} · {d.proximos} próximos
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2">
            Resultados: {e.resultados.ultima ? `${hace(e.resultados.ultima)}${e.resultados.estado && e.resultados.estado !== 'ok' ? ` (${e.resultados.estado})` : ''}` : 'sin pasada registrada'} · Copia del libro mayor: {hace(e.copia.ultima)}
            {e.errores24h > 0 && ` · ${e.errores24h} error(es) del servidor en 24 h`}
            {e.trabajosConError > 0 && ` · ${e.trabajosConError} trabajo(s) con error`}
          </p>
          <a href="/confianza/diagnostico" className="mt-2 inline-block text-(--ink-body) underline-offset-2 hover:underline">
            Ver diagnóstico
          </a>
        </div>
      )}
    </div>
  );
}
