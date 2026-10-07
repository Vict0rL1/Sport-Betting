// Un término del glosario con su explicación corta al pasar por encima o al enfocarlo, y un
// enlace a la larga (Fase 5.18).
import { Link } from 'react-router';
import { terminoDe } from '../../lib/glosario';

export function Termino({ clave, children }: { clave: string; children?: React.ReactNode }) {
  const t = terminoDe(clave);
  if (!t) return <>{children ?? clave}</>;
  return (
    <Link to={`/glosario#${t.clave}`} title={t.corta} className="underline decoration-dotted decoration-(--ink-faint) underline-offset-2 hover:decoration-(--ink-body)">
      {children ?? t.nombre}
    </Link>
  );
}
