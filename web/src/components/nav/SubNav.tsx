// Las subpáginas de una pestaña (Fase 6): Apuestas › Registro · Laboratorio · Líneas, y
// Confianza › Resumen · Archivo · Diagnóstico. Enlaces reales, con la página actual marcada.
import { NavLink } from 'react-router';
import { pillClass } from '../ui';

export function SubNav({ etiqueta, enlaces }: { etiqueta: string; enlaces: { ruta: string; texto: string }[] }) {
  return (
    <nav aria-label={etiqueta} className="mb-4 flex flex-wrap gap-1.5" data-testid="subnav">
      {enlaces.map((e) => (
        <NavLink key={e.ruta} to={e.ruta} end className={({ isActive }) => pillClass(isActive)}>
          {e.texto}
        </NavLink>
      ))}
    </nav>
  );
}
