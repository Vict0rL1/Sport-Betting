// Una fila del explorador (rediseño de noviembre): hora, los dos participantes con la probabilidad
// del modelo al lado de cada uno (y el empate debajo en el fútbol), y el control de seguir. Una sola
// acción principal: toda la fila abre el partido; la campana va aparte.
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { rutaPartido } from '../../rutas';
import { TeamCrest } from '../ui';
import { EstrellaSeguir } from '../seguimiento';
import { useI18n } from '../../i18n';
import { diaEn, favorito, type FilaPartido as Fila } from '../../lib/explorador';
import type { Densidad } from '../../lib/densidad';
import { porcentajes } from '../../lib/mercado';
import { num } from '../../lib/formato';

/** HH:MM en la zona elegida. */
export function horaEn(iso: string, zona: string, locale: string): string {
  try {
    return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: zona });
  } catch {
    return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
}

/** «hace 5 min», «hace 3 h» o la fecha: lo justo para juzgar la frescura sin abrir nada. */
function haceCuantoCorto(iso: string, ahora: number, t: ReturnType<typeof useI18n>['t']): string {
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60_000));
  if (min < 1) return t('partidos.prov.ahora');
  if (min < 60) return t('partidos.prov.haceMin', { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return t('partidos.prov.haceH', { n: h });
  return t('partidos.prov.haceD', { n: Math.round(h / 24) });
}

export default function FilaPartido({ f, zona, locale, densidad = 'comoda', onAbrir }: { f: Fila; zona: string; locale: string; densidad?: Densidad; onAbrir?: (f: Fila) => boolean }) {
  const compacta = densidad === 'compacta';
  const { t } = useI18n();
  const [abierta, setAbierta] = useState(false);
  const idDetalle = useId();
  const ahora = Date.now();
  const nombre = `${f.local.nombre} – ${f.visitante.nombre}`;
  const fav = favorito(f);
  const ps = f.prediccion ? porcentajes(f.prediccion.probs, 1) : null;
  const tres = f.mercado.resultados.length === 3;
  // [local, visitante] y, si lo hay, el empate: el índice de cada uno en las probabilidades.
  const iLocal = 0;
  const iFuera = tres ? 2 : 1;
  const ligaCrest = f.liga?.id ?? f.sport;

  const linea = (participante: Fila['local'], i: number) => (
    <span className="flex min-w-0 items-center gap-2">
      {!compacta && <TeamCrest league={ligaCrest} name={participante.nombre} code={participante.id} size={22} className="max-sm:hidden" />}
      {/* Fase D: el nombre se parte en líneas en vez de cortarse (a 320 px, «Edmonton Oi…» solo se leía
          con el ratón encima, y en un móvil no hay). */}
      <span className={`nombre min-w-0 flex-1 break-words ${fav?.indice === i ? 'font-semibold text-(--ink-strong)' : 'text-(--ink-body)'}`}>
        {participante.nombre}
      </span>
      {ps && <Prob v={ps[i]} fuerte={fav?.indice === i} />}
    </span>
  );

  return (
    <li data-densidad={densidad} className={`relative grid grid-cols-[2.75rem_minmax(0,1fr)_2rem] items-center gap-x-2 border-b border-(--line) px-1 last:border-b-0 sm:grid-cols-[4rem_minmax(0,1fr)_2.5rem] sm:gap-x-3 sm:px-2 ${compacta ? 'py-1.5' : 'py-2.5'}`}>
      <span className="self-start pt-0.5 text-[14px] leading-tight text-(--ink-body)">
        <span className="block tabular-nums">{horaEn(f.cuando, zona, locale)}</span>
        {f.empezado && <span className="mt-0.5 block text-[12px] text-(--status-warning)">{t('partidos.empezado')}</span>}
      </span>
      <Link
        to={rutaPartido(f.sport, f.id) + (f.matchKey ? `?clave=${encodeURIComponent(f.matchKey)}` : '')}
        aria-label={t('partidos.abrir', { partido: nombre })}
        onClick={(e) => {
          // En pantallas anchas se abre en el panel lateral (D2); con Ctrl/⌘/Mayús, como un enlace.
          if (!onAbrir || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if (onAbrir(f)) e.preventDefault();
        }}
        className="flex min-w-0 max-w-[38rem] items-center gap-2 rounded-md text-[15px] leading-snug outline-offset-4 after:absolute after:inset-0 after:content-[''] hover:[&_.nombre]:underline"
      >
        {/* Fase D: los números junto a los nombres (sin estirarse a todo el ancho) y una marca visible de
            que la fila se abre. */}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
        {linea(f.local, iLocal)}
        {linea(f.visitante, iFuera)}
        {tres && ps && (
          <span className="flex items-center gap-2 text-[13px] text-(--ink-muted)">
            {!compacta && <span aria-hidden className="w-[22px] shrink-0 max-sm:hidden" />}
            <span className="flex-1">{t('partidos.empate')}</span>
            <Prob v={ps[1]} fuerte={fav?.indice === 1} pequeno />
          </span>
        )}
        {(!f.prediccion || f.origen === 'demo') && (
          <span className="flex flex-wrap items-center gap-2 text-[12px] sm:pl-[30px]">
            {f.origen === 'demo' && <span className="rounded border border-(--line-strong) px-1.5 py-px text-(--status-warning)">{t('partidos.demo')}</span>}
            {!f.prediccion && <span className="text-(--ink-muted)">{f.sinPrediccion === 'invalida' ? t('partidos.estimacionInvalida') : f.sinPrediccion === 'demo' ? t('partidos.sinEstimarDemo') : t('partidos.sinEstimar')}</span>}
          </span>
        )}
        </span>
        <span data-abrir aria-hidden className="shrink-0 text-[20px] leading-none text-(--ink-faint)">›</span>
      </Link>
      {/* Seguir va por encima del enlace de la fila (z-10): es otra acción. */}
      <span className="relative z-10 grid place-items-center self-start">
        {f.matchKey ? <EstrellaSeguir kind="partido" sport={f.sport} league={f.liga?.id ?? null} refId={f.matchKey} label={nombre} size={18} /> : null}
      </span>
      {/* Procedencia (B5): de cuándo es la estimación, siempre a la vista; versión, de dónde sale el
          partido y de dónde y de cuándo son las cuotas, a un toque. Por encima del enlace (z-10). */}
      <div className={`relative z-10 col-start-2 col-end-4 text-[12px] text-(--ink-muted) ${compacta ? 'mt-0.5' : 'mt-1'}`}>
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {f.prediccion && !compacta && (
            <span className="tabular-nums">
              {diaEn(f.prediccion.capturadaEn, zona) === diaEn(new Date(ahora), zona)
                ? t('partidos.capturada', { hora: horaEn(f.prediccion.capturadaEn, zona, locale) })
                : t('partidos.capturadaDia', { dia: fechaCorta(f.prediccion.capturadaEn, zona, locale), hora: horaEn(f.prediccion.capturadaEn, zona, locale) })}
            </span>
          )}
          <button
            type="button"
            aria-expanded={abierta}
            aria-controls={idDetalle}
            onClick={() => setAbierta((v) => !v)}
            className="toque inline-flex min-h-6 items-center underline underline-offset-2 [--toque-y:8px] hover:text-(--ink-body)"
          >
            {t('partidos.procedencia')}
            <span className="sr-only"> · {nombre}</span>
          </button>
        </span>
        {abierta && (
          <dl id={idDetalle} className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md bg-(--raised) px-2 py-1.5 text-(--ink-soft)">
            <dt>{t('partidos.prov.estimacion')}</dt>
            <dd className="tabular-nums text-(--ink-body)">
              {f.prediccion
                ? `${fechaCorta(f.prediccion.capturadaEn, zona, locale)} ${horaEn(f.prediccion.capturadaEn, zona, locale)} · ${t(f.prediccion.fuente === 'instantanea' ? 'partidos.prov.instantanea' : 'partidos.prov.registro')}`
                : t('partidos.prov.sinEstimacion')}
            </dd>
            <dt>{t('partidos.prov.version')}</dt>
            <dd className="text-(--ink-body)">{f.prediccion?.version ?? t('partido.desconocido')}</dd>
            <dt>{t('partidos.prov.partido')}</dt>
            <dd className="text-(--ink-body)">
              {f.fuenteCalendario === 'casa' ? t('partidos.prov.casa') : f.fuenteCalendario === 'calendario' ? t('partidos.prov.calendario') : f.fuenteCalendario === 'demo' ? t('partidos.prov.demo') : t('partido.desconocido')}
            </dd>
            <dt>{t('partidos.prov.cuotas')}</dt>
            <dd className="text-(--ink-body)">
              {!f.cuotas
                ? t('partidos.prov.sinCuotas')
                : f.cuotas.origen === 'demo'
                  ? t('partidos.prov.demo')
                  : [
                      t('partidos.prov.casa'),
                      f.cuotas.casas != null ? t('partidos.prov.casas', { n: f.cuotas.casas }) : null,
                      f.cuotas.recibidasEn ? t('partidos.prov.recibidas', { cuando: haceCuantoCorto(f.cuotas.recibidasEn, ahora, t) }) : t('partidos.prov.recibidasDesconocido'),
                      f.cuotas.antiguas ? t('partidos.prov.antiguas') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
            </dd>
          </dl>
        )}
      </div>
    </li>
  );
}

/** «20 nov» en la zona elegida. */
function fechaCorta(iso: string, zona: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: zona });
  } catch {
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  }
}

function Prob({ v, fuerte, pequeno = false }: { v: number; fuerte: boolean; pequeno?: boolean }) {
  return (
    // Fase D: la probabilidad del favorito, la cifra más visible de la fila (antes, del tamaño de los nombres).
    <span className={`w-[3.75rem] shrink-0 text-right tabular-nums sm:w-[4.25rem] ${pequeno ? 'text-[13px]' : fuerte ? 'text-[18px]' : 'text-[15px]'} ${fuerte ? 'font-semibold text-(--ink-strong)' : 'text-(--ink-soft)'}`}>
      {num(v, 1)} %
    </span>
  );
}
