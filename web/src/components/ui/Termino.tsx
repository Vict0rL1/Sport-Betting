// Un término del glosario con su explicación corta al pasar por encima o al enfocarlo, y un
// enlace a la larga (Fase 5.18).
import { Link } from 'react-router';
import { terminoDe, terminoEn } from '../../lib/glosario';
import { useI18n } from '../../i18n';

export function Termino({ clave, children }: { clave: string; children?: React.ReactNode }) {
  const { idioma } = useI18n();
  const t0 = terminoDe(clave);
  if (!t0) return <>{children ?? clave}</>;
  const t = terminoEn(t0, idioma);
  return (
    <Link to={`/glosario#${t.clave}`} title={t.corta} className="underline decoration-dotted decoration-(--ink-faint) underline-offset-2 hover:decoration-(--ink-body)">
      {children ?? t.nombre}
    </Link>
  );
}
