// El enlace a la página del partido (Fase 5.11), en cada tarjeta. En la propia página no sale.
import { Link, useLocation } from 'react-router';
import { rutaPartido } from '../../rutas';
import { useI18n } from '../../i18n';

export function EnlacePartido({ sport, id, clave }: { sport: string; id: string; clave?: string | null }) {
  const { pathname } = useLocation();
  const { t } = useI18n();
  if (pathname.startsWith('/partido/')) return null;
  return (
    <Link to={`${rutaPartido(sport, id)}${clave ? `?clave=${encodeURIComponent(clave)}` : ''}`} className="text-[13px] text-(--ink-soft) underline-offset-2 hover:text-(--ink-strong) hover:underline">
      {t('enlace.abrirPartido')}
    </Link>
  );
}
