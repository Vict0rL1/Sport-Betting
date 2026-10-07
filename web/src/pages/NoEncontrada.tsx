import { Link } from 'react-router';

export default function NoEncontrada() {
  return (
    <div className="rounded-xl border border-(--line) p-6 text-[14px] text-(--ink-soft)">
      <p className="text-[16px] font-semibold text-(--ink-strong)">Esta página no existe.</p>
      <p className="mt-1">Puede que el enlace sea viejo o esté mal copiado.</p>
      <Link to="/destacados" className="mt-3 inline-block text-(--ink-body) underline-offset-2 hover:underline">
        Ir a Destacados
      </Link>
    </div>
  );
}
