// La insignia de confianza (Fase 5.9): nivel (ALTA / MEDIA / BAJA) y, aparte, «Sin mercado» en
// gris cuando no hay cuotas. No tener mercado no es tener confianza baja: son dos estados.
import { PROFIT_COLOR, STATUS } from '../../lib/theme';

const NIVEL: Record<'ALTA' | 'MEDIA' | 'BAJA', { color: string; fondo: string; texto: string }> = {
  ALTA: { color: PROFIT_COLOR, fondo: 'rgba(25,158,112,0.14)', texto: 'Confianza alta' },
  MEDIA: { color: STATUS.warning, fondo: 'rgba(201,133,0,0.14)', texto: 'Confianza media' },
  BAJA: { color: STATUS.critical, fondo: 'rgba(230,103,103,0.12)', texto: 'Confianza baja' },
};

export function ConfianzaBadge({ nivel, decision, motivo, compacta = false }: { nivel: 'ALTA' | 'MEDIA' | 'BAJA' | null; decision?: 'BET' | 'NO BET' | 'SIN MERCADO' | null; motivo?: string | null; compacta?: boolean }) {
  const n = nivel ? NIVEL[nivel] : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="insignia-confianza">
      {n ? (
        <span className="rounded-md px-2 py-0.5 text-[12px] font-semibold" style={{ color: n.color, background: n.fondo }} title={motivo ?? undefined}>
          {compacta ? nivel : n.texto}
        </span>
      ) : (
        <span className="rounded-md px-2 py-0.5 text-[12px] text-(--ink-muted) ring-1 ring-(--line)" title="La capa de confianza todavía no ha evaluado este partido (lo hace el ciclo pre-partido con el servidor arrancado).">
          sin evaluar
        </span>
      )}
      {decision === 'SIN MERCADO' && (
        <span className="rounded-md px-2 py-0.5 text-[12px] text-(--ink-soft) ring-1 ring-(--line-strong)" title="Sin cuotas reales para este partido: no hay con qué comparar la probabilidad. No dice nada de la calidad de la predicción.">
          Sin mercado
        </span>
      )}
    </span>
  );
}
