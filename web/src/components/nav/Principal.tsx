// Los tres destinos principales (rediseño de noviembre, D1): Partidos, Rendimiento y Mis apuestas.
// Enlaces con aria-current, no pestañas: cada uno es una página.
import { Link } from 'react-router';
import { RUTA_DE_PESTANA, RUTA_PARTIDOS } from '../../rutas';
import { SportIcon } from '../icons';
import { useI18n, type Clave } from '../../i18n';
import type { SportId } from '../../lib/theme';
import { ListaIcono } from './iconos';
import { destinoPrincipal } from './destinos';

export const PRINCIPALES: { ruta: string; etiqueta: Clave; icono: SportId | 'partidos' }[] = [
  { ruta: RUTA_PARTIDOS, etiqueta: 'nav.partidos', icono: 'partidos' },
  { ruta: RUTA_DE_PESTANA.trust, etiqueta: 'nav.rendimiento', icono: 'trust' },
  { ruta: RUTA_DE_PESTANA.bets, etiqueta: 'nav.misApuestas', icono: 'bets' },
];

export default function NavPrincipal({ pathname }: { pathname: string }) {
  const { t } = useI18n();
  const actual = destinoPrincipal(pathname);
  return (
    <nav aria-label={t('nav.principal')} className="flex flex-col gap-0.5 px-2">
      {PRINCIPALES.map((d) => {
        const on = actual === d.ruta;
        return (
          <Link key={d.ruta} to={d.ruta} aria-current={on ? 'page' : undefined} className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] font-medium transition ${on ? 'bg-(--raised-2) text-(--ink-strong)' : 'text-(--ink-soft) hover:bg-(--raised) hover:text-(--ink-body)'}`}>
            <span aria-hidden className="absolute inset-y-1.5 left-0 w-[3px] rounded-full" style={{ backgroundColor: on ? 'var(--accent)' : 'transparent' }} />
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ color: on ? 'var(--accent)' : 'currentColor' }}>
              {d.icono === 'partidos' ? <ListaIcono /> : <SportIcon sport={d.icono} size={18} />}
            </span>
            {t(d.etiqueta)}
          </Link>
        );
      })}
    </nav>
  );
}
