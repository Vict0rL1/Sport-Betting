// Una fila del explorador (rediseño de noviembre): hora, los dos participantes con la probabilidad
// del modelo al lado de cada uno (y el empate debajo en el fútbol), y el control de seguir. Una sola
// acción principal: toda la fila abre el partido; la campana va aparte.
import { Link } from 'react-router';
import { rutaPartido } from '../../rutas';
import { TeamCrest } from '../ui';
import { EstrellaSeguir } from '../seguimiento';
import { useI18n } from '../../i18n';
import { favorito, type FilaPartido as Fila } from '../../lib/explorador';
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

export default function FilaPartido({ f, zona, locale }: { f: Fila; zona: string; locale: string }) {
  const { t } = useI18n();
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
      <TeamCrest league={ligaCrest} name={participante.nombre} code={participante.id} size={22} className="max-sm:hidden" />
      <span className={`min-w-0 flex-1 truncate ${fav?.indice === i ? 'font-semibold text-(--ink-strong)' : 'text-(--ink-body)'}`} title={participante.nombre}>
        {participante.nombre}
      </span>
      {ps && <Prob v={ps[i]} fuerte={fav?.indice === i} />}
    </span>
  );

  return (
    <li className="relative grid grid-cols-[2.75rem_minmax(0,1fr)_2rem] items-center gap-x-2 border-b border-(--line) px-1 py-2.5 last:border-b-0 sm:grid-cols-[4rem_minmax(0,1fr)_2.5rem] sm:gap-x-3 sm:px-2">
      <span className="self-start pt-0.5 text-[14px] leading-tight text-(--ink-body)">
        <span className="block tabular-nums">{horaEn(f.cuando, zona, locale)}</span>
        {f.empezado && <span className="mt-0.5 block text-[12px] text-(--status-warning)">{t('partidos.empezado')}</span>}
      </span>
      <Link
        to={rutaPartido(f.sport, f.id) + (f.matchKey ? `?clave=${encodeURIComponent(f.matchKey)}` : '')}
        aria-label={t('partidos.abrir', { partido: nombre })}
        className="flex min-w-0 flex-col gap-1 rounded-md text-[15px] leading-snug outline-offset-4 after:absolute after:inset-0 after:content-[''] hover:[&_.nombre]:underline"
      >
        {linea(f.local, iLocal)}
        {linea(f.visitante, iFuera)}
        {tres && ps && (
          <span className="flex items-center gap-2 text-[13px] text-(--ink-muted)">
            <span aria-hidden className="w-[22px] shrink-0 max-sm:hidden" />
            <span className="flex-1">{t('partidos.empate')}</span>
            <Prob v={ps[1]} fuerte={fav?.indice === 1} pequeno />
          </span>
        )}
        {(!f.prediccion || f.origen === 'demo') && (
          <span className="flex flex-wrap items-center gap-2 text-[12px] sm:pl-[30px]">
            {f.origen === 'demo' && <span className="rounded border border-(--line-strong) px-1.5 py-px text-(--status-warning)">{t('partidos.demo')}</span>}
            {!f.prediccion && <span className="text-(--ink-muted)">{f.sinPrediccion === 'invalida' ? t('partidos.estimacionInvalida') : t('partidos.sinEstimar')}</span>}
          </span>
        )}
      </Link>
      {/* Seguir va por encima del enlace de la fila (z-10): es otra acción. */}
      <span className="relative z-10 grid place-items-center self-start">
        {f.matchKey ? <EstrellaSeguir kind="partido" sport={f.sport} league={f.liga?.id ?? null} refId={f.matchKey} label={nombre} size={18} /> : null}
      </span>
    </li>
  );
}

function Prob({ v, fuerte, pequeno = false }: { v: number; fuerte: boolean; pequeno?: boolean }) {
  return (
    <span className={`w-[3.75rem] shrink-0 text-right tabular-nums sm:w-[4.25rem] ${pequeno ? 'text-[13px]' : 'text-[15px]'} ${fuerte ? 'font-semibold text-(--ink-strong)' : 'text-(--ink-soft)'}`}>
      {num(v, 1)} %
    </span>
  );
}
