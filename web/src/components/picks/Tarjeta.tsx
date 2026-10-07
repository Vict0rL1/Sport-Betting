// La tarjeta de un partido en Destacados, el chip de filtro y la barra de probabilidad.
import { AWAY_COLOR, DRAW_COLOR, HOME_COLOR, PROFIT_COLOR, LOSS_COLOR, SPORT_THEMES } from '../../lib/theme';
import { DeporteIcono, StarIcon, StatusMark } from '../icons';
import { TeamCrest, EnlacePartido } from '../ui';
import { ConfianzaBadge } from '../trust/ConfianzaBadge';
import { EstrellaSeguir } from '../seguimiento';
import { type Opcion, type Pick, AMBAR, pct, num } from './tipos';

export function Chip({ activo, onClick, children, title }: { activo: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
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

export function Tarjeta({ p, puesto, elegido, onElegir }: { p: Pick; puesto: number; elegido: boolean; onElegir: () => void }) {
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
